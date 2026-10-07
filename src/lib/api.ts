// Client API layer — the single source of truth for the frontend.
// All reads/mutations go through the Express + SQLite backend (via Vite proxy /api).
// Domain types (src/types) are used; JSON DTOs from the server are mapped here.

import type {
  AnalyticsPeriod,
  AppSettings,
  ComponentCategory,
  Config,
  Order,
  Part,
  PartCompat,
  PriceList,
  PriceListItem,
  ReadyPc,
  Review,
  SalesAnalytics,
  SellerBrand,
  SellerSummary,
  SpecItem,
  User,
  Vendor,
} from "../types";

const BASE = "/api";

async function req<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: string;
        details?: { message?: string };
      };
      // Prefer a human-readable detail; fall back to the machine error code.
      if (body.details?.message) message = body.details.message;
      else if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Catalog (parts & ready PCs) ----

export interface PartApi {
  id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  vendorId?: string;
  available?: boolean;
  price?: number;
  priceSet?: boolean;
  tdp: number;
  specs: SpecItem[];
  image?: string;
  description?: string;
  compat: PartCompat;
}

function mapPart(p: PartApi): Part {
  const { id, category, name, brand, vendorId, available, price, priceSet, tdp, specs, image, description, compat } = p;
  return {
    id,
    category,
    name,
    brand,
    vendorId,
    available,
    price,
    priceSet,
    tdp,
    specs,
    image,
    description,
    compat,
  };
}

export async function fetchParts(
  category?: ComponentCategory,
  includeInactive?: boolean,
  sellerId?: string,
): Promise<Part[]> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (includeInactive) params.set("includeInactive", "1");
  if (sellerId) params.set("sellerId", sellerId);
  const q = params.toString() ? `?${params.toString()}` : "";
  const rows = await req<PartApi[]>(`/parts${q}`);
  return rows.map(mapPart);
}

/** Fetch full catalog grouped by category (Uses parallel part requests). */
export async function fetchCatalog(sellerId?: string): Promise<Record<ComponentCategory, Part[]>> {
  const cats: ComponentCategory[] = [
    "cpu",
    "gpu",
    "motherboard",
    "ram",
    "storage",
    "case",
    "psu",
    "cooler",
  ];
  const entries = await Promise.all(cats.map((c) => fetchParts(c, undefined, sellerId).then((p) => [c, p] as const)));
  return Object.fromEntries(entries) as Record<ComponentCategory, Part[]>;
}

interface ReadyPcApi {
  id: string;
  name: string;
  brand: string;
  usage: ReadyPc["usage"];
  price: number;
  tdp: number;
  summary: string;
  specs: { label: string; value: string }[];
  image?: string;
  inStock: boolean;
  rating: number;
  reviewCount: number;
  valid: boolean;
  sellerId?: string | null;
  archived?: boolean;
  parts: ConfigPartApi[];
}

interface ConfigPartApi {
  category: ComponentCategory;
  part: PartApi | null;
  price?: number;
  currentPrice?: number;
  unavailableReason?: "deactivated" | "missing" | "no_price";
}

function mapConfigPart(
  c: ConfigPartApi,
): { category: ComponentCategory; part: Part | null; price?: number; currentPrice?: number; unavailableReason?: "deactivated" | "missing" | "no_price" } {
  return {
    category: c.category,
    part: c.part ? mapPart(c.part) : null,
    price: c.price,
    currentPrice: c.currentPrice,
    unavailableReason: c.unavailableReason,
  };
}

function mapReady(p: ReadyPcApi): ReadyPc {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    usage: p.usage,
    price: p.price,
    tdp: p.tdp,
    summary: p.summary,
    specs: p.specs,
    image: p.image,
    inStock: p.inStock,
    rating: p.rating,
    reviewCount: p.reviewCount,
    valid: p.valid,
    sellerId: p.sellerId ?? undefined,
    archived: p.archived,
    parts: p.parts.map(mapConfigPart),
  };
}

export async function fetchReadyPcs(sellerId?: string, onlyValid?: boolean): Promise<ReadyPc[]> {
  const params = new URLSearchParams();
  if (sellerId) params.set("sellerId", sellerId);
  if (onlyValid) params.set("valid", "1");
  const q = params.toString() ? `?${params.toString()}` : "";
  const rows = await req<ReadyPcApi[]>(`/ready${q}`);
  return rows.map(mapReady);
}

export async function fetchReadyPc(id: string, sellerId?: string): Promise<ReadyPc | null> {
  try {
    const params = new URLSearchParams();
    if (sellerId) params.set("sellerId", sellerId);
    const q = params.toString() ? `?${params.toString()}` : "";
    const row = await req<ReadyPcApi>(`/ready/${encodeURIComponent(id)}${q}`);
    return mapReady(row);
  } catch {
    return null;
  }
}

// ---- Seller ready builds (owner or admin) ----

export interface ReadyBuildPartRef {
  category: ComponentCategory;
  partId: string;
}

export interface ReadyBuildInput {
  brand: string;
  model: string;
  parts: ReadyBuildPartRef[];
}

export async function fetchSellerReadyBuilds(sellerId: string): Promise<ReadyPc[]> {
  const rows = await req<ReadyPcApi[]>(`/seller/${encodeURIComponent(sellerId)}/ready`);
  return rows.map(mapReady);
}

export async function fetchSellerReadyBuild(sellerId: string, buildId: string): Promise<ReadyPc | null> {
  try {
    const row = await req<ReadyPcApi>(`/seller/${encodeURIComponent(sellerId)}/ready/${encodeURIComponent(buildId)}`);
    return mapReady(row);
  } catch {
    return null;
  }
}

export async function createSellerReadyBuild(
  sellerId: string,
  input: ReadyBuildInput,
): Promise<ReadyPc> {
  return mapReady(await req<ReadyPcApi>(`/seller/${encodeURIComponent(sellerId)}/ready`, {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function updateSellerReadyBuild(
  sellerId: string,
  buildId: string,
  input: Partial<ReadyBuildInput>,
): Promise<ReadyPc> {
  return mapReady(await req<ReadyPcApi>(`/seller/${encodeURIComponent(sellerId)}/ready/${encodeURIComponent(buildId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }));
}

export async function deleteSellerReadyBuild(sellerId: string, buildId: string): Promise<void> {
  await req<void>(`/seller/${encodeURIComponent(sellerId)}/ready/${encodeURIComponent(buildId)}`, {
    method: "DELETE",
  });
}

export async function reactivateSellerReadyBuild(sellerId: string, buildId: string): Promise<ReadyPc> {
  return mapReady(await req<ReadyPcApi>(`/seller/${encodeURIComponent(sellerId)}/ready/${encodeURIComponent(buildId)}/reactivate`, {
    method: "POST",
  }));
}

// ---- Onboarding ----

export async function getOnboarded(): Promise<boolean> {
  const r = await req<{ onboarded: boolean }>("/onboarding");
  return r.onboarded;
}

export async function setOnboarded(v: boolean): Promise<void> {
  await req("/onboarding", { method: "POST", body: JSON.stringify({ onboarded: v }) });
}

// ---- Auth / session ----

export async function requestCode(phone: string): Promise<string> {
  const r = await req<{ demoCode: string }>("/auth/request-code", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  return r.demoCode;
}

export async function verifyCode(phone: string, code: string): Promise<void> {
  await req("/auth/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
}

export interface SessionResult {
  user: User;
  sessionId: string;
}

export async function signIn(
  user: Partial<User> & { name: string },
): Promise<SessionResult> {
  const r = await req<{ user: User; sessionId: string }>("/session", {
    method: "POST",
    body: JSON.stringify(user),
  });
  return r;
}

export async function signOut(sessionId: string): Promise<void> {
  await req("/session/logout", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export async function getSession(sessionId: string): Promise<SessionResult | null> {
  try {
    return await req<SessionResult>(`/session/${encodeURIComponent(sessionId)}`);
  } catch {
    return null;
  }
}

// ---- Configs ----

interface ConfigApi {
  id: string;
  name: string;
  source: Config["source"];
  usage?: Config["usage"];
  sellerId?: string;
  readyPcId?: string;
  createdAt: number;
  updatedAt: number;
  buildInvalid?: boolean;
  parts: ConfigPartApi[];
}

function mapConfig(c: ConfigApi): Config {
  return {
    id: c.id,
    name: c.name,
    source: c.source,
    usage: c.usage,
    sellerId: c.sellerId,
    readyPcId: c.readyPcId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    buildInvalid: c.buildInvalid,
    parts: c.parts.map(mapConfigPart),
  };
}

function configToApi(c: Config): ConfigApi {
  return {
    id: c.id,
    name: c.name,
    source: c.source,
    usage: c.usage,
    sellerId: c.sellerId,
    readyPcId: c.readyPcId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    buildInvalid: c.buildInvalid,
    parts: c.parts.map(({ category, part, price, currentPrice, unavailableReason }) => ({
      category,
      part: (part ? part : null) as PartApi | null,
      price,
      currentPrice,
      unavailableReason: unavailableReason as ConfigPartApi["unavailableReason"],
    })),
  };
}

export async function fetchConfigs(userId: string): Promise<Config[]> {
  const rows = await req<ConfigApi[]>(`/configs?userId=${encodeURIComponent(userId)}`);
  return rows.map(mapConfig);
}

export async function saveConfigRemote(config: Config, userId: string): Promise<Config> {
  const api = configToApi(config);
  const body = {
    name: api.name,
    source: api.source,
    usage: api.usage,
    seller_id: api.sellerId,
    ready_pc_id: api.readyPcId,
    parts: api.parts.filter((p) => p.part).map(({ category, part, price }) => ({
      category,
      part_id: part!.id,
      price,
    })),
  };
  return mapConfig(await req<ConfigApi>(`/configs/${encodeURIComponent(config.id)}?userId=${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }));
}

export async function deleteConfigRemote(id: string): Promise<void> {
  await req<void>(`/configs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- Orders ----

export async function fetchOrders(userId: string): Promise<Order[]> {
  return req<Order[]>(`/orders?userId=${encodeURIComponent(userId)}`);
}

export async function saveOrderRemote(order: Order, userId: string): Promise<Order> {
  return req<Order>(`/orders/${encodeURIComponent(order.id)}?userId=${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({
      status: order.status,
      paymentMethod: order.paymentMethod,
      address: order.address,
      userName: order.userName,
      items: order.items,
    }),
  });
}

export async function cancelOrderRemote(id: string): Promise<void> {
  await req<void>(`/orders/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

/** Customer buys at their own expense after an installment rejection (alpha_rejected -> confirmed). */
export async function buyOwnOrder(orderId: string): Promise<Order> {
  return req<Order>(`/orders/${encodeURIComponent(orderId)}/buy-own`, { method: "POST" });
}

// ---- Seller / admin: customer orders ----

export async function fetchSellerOrders(sellerId: string): Promise<Order[]> {
  return req<Order[]>(`/seller/${encodeURIComponent(sellerId)}/orders`);
}

export async function updateSellerOrderStatus(
  sellerId: string,
  orderId: string,
  status: Order["status"],
): Promise<Order | null> {
  return req<Order | null>(
    `/seller/${encodeURIComponent(sellerId)}/orders/${encodeURIComponent(orderId)}/status`,
    { method: "POST", body: JSON.stringify({ status }) },
  );
}

export async function fetchAlphaOrders(): Promise<Order[]> {
  return req<Order[]>("/admin/orders?status=alpha");
}

export async function approveInstallment(orderId: string): Promise<Order | null> {
  return req<Order | null>(
    `/admin/orders/${encodeURIComponent(orderId)}/approve-installment`,
    { method: "POST" },
  );
}

export async function rejectInstallment(orderId: string): Promise<Order | null> {
  return req<Order | null>(
    `/admin/orders/${encodeURIComponent(orderId)}/reject-installment`,
    { method: "POST" },
  );
}

// ---- Reviews ----

export async function fetchReviews(entityId: string): Promise<Review[]> {
  return req<Review[]>(`/reviews?entityId=${encodeURIComponent(entityId)}`);
}

export async function fetchAllReviews(): Promise<Review[]> {
  return req<Review[]>("/reviews");
}

export async function submitReviewRemote(
  entityId: string,
  author: string,
  rating: number,
  text: string,
  id: string,
): Promise<Review> {
  return req<Review>(`/reviews/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ entityId, author, rating, text }),
  });
}

// ---- Settings ----

export async function fetchSettings(userId: string): Promise<AppSettings> {
  try {
    return await req<AppSettings>(`/settings?userId=${encodeURIComponent(userId)}`);
  } catch {
    return { theme: "light", notifications: true };
  }
}

export async function saveSettingsRemote(
  userId: string,
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  return req<AppSettings>(`/settings?userId=${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ---- Profile (self-service) ----

export async function updateProfile(
  patch: { name?: string; company?: string },
): Promise<User> {
  return req<User>("/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ---- Admin (protected) ----

export async function fetchUsers(): Promise<User[]> {
  return req<User[]>("/users");
}

export async function createUser(input: {
  name: string;
  email?: string;
  phone?: string;
  role: User["role"];
  company?: string;
}): Promise<User> {
  return req<User>("/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteUser(id: string): Promise<void> {
  await req<void>(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function setUserRole(id: string, role: User["role"]): Promise<User> {
  return req<User>(`/users/${encodeURIComponent(id)}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

// ---- Seller ----

export async function fetchSellerBrands(sellerId: string): Promise<SellerBrand[]> {
  return req<SellerBrand[]>(`/seller/${encodeURIComponent(sellerId)}/brands`);
}

export async function addSellerBrand(
  sellerId: string,
  brand: string,
  description?: string,
): Promise<SellerBrand> {
  return req<SellerBrand>(`/seller/${encodeURIComponent(sellerId)}/brands`, {
    method: "PUT",
    body: JSON.stringify({ brand, ...(description !== undefined ? { description } : {}) }),
  });
}

export async function updateSellerBrand(
  sellerId: string,
  brand: string,
  patch: { brand?: string; description?: string },
): Promise<SellerBrand> {
  return req<SellerBrand>(`/seller/${encodeURIComponent(sellerId)}/brands/${encodeURIComponent(brand)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteSellerBrand(
  sellerId: string,
  brand: string,
): Promise<void> {
  await req<void>(`/seller/${encodeURIComponent(sellerId)}/brands/${encodeURIComponent(brand)}`, {
    method: "DELETE",
  });
}

// ---- Sellers (catalog selector) ----

export async function fetchSellerSummaries(): Promise<SellerSummary[]> {
  return req<SellerSummary[]>("/sellers");
}

// ---- Sales analytics ----

export async function fetchSellerSalesAnalytics(
  sellerId: string,
  period: AnalyticsPeriod,
): Promise<SalesAnalytics> {
  return req<SalesAnalytics>(
    `/seller/${encodeURIComponent(sellerId)}/analytics?period=${encodeURIComponent(period)}`,
  );
}

export async function fetchAdminSalesAnalytics(
  period: AnalyticsPeriod,
): Promise<SalesAnalytics> {
  return req<SalesAnalytics>(`/admin/analytics?period=${encodeURIComponent(period)}`);
}

// ---- Price lists (seller/admin) ----

interface PriceListApi extends PriceList {}

function mapPriceList(p: PriceListApi): PriceList {
  return { ...p, items: (p.items ?? []) as PriceListItem[] };
}

export async function fetchPriceLists(sellerId: string): Promise<PriceList[]> {
  return (await req<PriceListApi[]>(`/seller/${encodeURIComponent(sellerId)}/price-lists`)).map(mapPriceList);
}

export async function createPriceList(
  sellerId: string,
  name: string,
): Promise<PriceList> {
  return mapPriceList(await req<PriceListApi>(`/seller/${encodeURIComponent(sellerId)}/price-lists`, {
    method: "POST",
    body: JSON.stringify({ name }),
  }));
}

export async function renamePriceList(
  sellerId: string,
  priceListId: string,
  name: string,
): Promise<PriceList> {
  return mapPriceList(await req<PriceListApi>(`/seller/${encodeURIComponent(sellerId)}/price-lists/${encodeURIComponent(priceListId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  }));
}

export async function deletePriceList(
  sellerId: string,
  priceListId: string,
): Promise<void> {
  await req<void>(`/seller/${encodeURIComponent(sellerId)}/price-lists/${encodeURIComponent(priceListId)}`, {
    method: "DELETE",
  });
}

export async function setActivePriceList(
  sellerId: string,
  priceListId: string,
): Promise<PriceList> {
  return mapPriceList(await req<PriceListApi>(`/seller/${encodeURIComponent(sellerId)}/price-lists/${encodeURIComponent(priceListId)}/activate`, {
    method: "POST",
  }));
}

export async function upsertPriceListItem(
  sellerId: string,
  priceListId: string,
  partId: string,
  price: number,
): Promise<PriceList> {
  return mapPriceList(await req<PriceListApi>(`/seller/${encodeURIComponent(sellerId)}/price-lists/${encodeURIComponent(priceListId)}/items/${encodeURIComponent(partId)}`, {
    method: "PUT",
    body: JSON.stringify({ price }),
  }));
}

export async function deletePriceListItem(
  sellerId: string,
  priceListId: string,
  partId: string,
): Promise<void> {
  await req<void>(`/seller/${encodeURIComponent(sellerId)}/price-lists/${encodeURIComponent(priceListId)}/items/${encodeURIComponent(partId)}`, {
    method: "DELETE",
  });
}

export async function fetchPriceListMissing(
  sellerId: string,
  priceListId: string,
  includeInactive?: boolean,
): Promise<Part[]> {
  const params = new URLSearchParams();
  if (includeInactive) params.set("includeInactive", "1");
  const q = params.toString() ? `?${params.toString()}` : "";
  const rows = await req<PartApi[]>(`/seller/${encodeURIComponent(sellerId)}/price-lists/${encodeURIComponent(priceListId)}/items/missing${q}`);
  return rows.map(mapPart);
}

export async function addPriceListItems(
  sellerId: string,
  priceListId: string,
  partIds: string[],
): Promise<{ added: number }> {
  return req<{ added: number }>(`/seller/${encodeURIComponent(sellerId)}/price-lists/${encodeURIComponent(priceListId)}/items/bulk`, {
    method: "POST",
    body: JSON.stringify({ partIds }),
  });
}

// ---- Vendors & components (seller/admin) ----

export async function fetchVendors(): Promise<Vendor[]> {
  return req<Vendor[]>("/vendors");
}

export interface CreatePartInput {
  category: ComponentCategory;
  brand: string;
  vendor: string;
  tdp: number;
  compat: PartCompat;
  specs: SpecItem[];
  image?: string;
  description?: string;
}

export async function createPart(input: CreatePartInput): Promise<Part> {
  return mapPart(await req<PartApi>("/components", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export interface UpdatePartInput {
  brand?: string;
  vendor?: string;
  tdp?: number;
  compat?: PartCompat;
  specs?: SpecItem[];
  image?: string;
  description?: string;
}

export async function updatePart(id: string, patch: UpdatePartInput): Promise<Part> {
  return mapPart(await req<PartApi>(`/components/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }));
}

export async function deactivatePart(id: string): Promise<void> {
  await req<void>(`/components/${encodeURIComponent(id)}/deactivate`, {
    method: "POST",
  });
}

export async function reactivatePart(id: string): Promise<void> {
  await req<void>(`/components/${encodeURIComponent(id)}/reactivate`, {
    method: "POST",
  });
}

export async function initializeCatalog(): Promise<{ inserted: number; deleted: number }> {
  return req<{ inserted: number; deleted: number }>("/catalog/initialize", {
    method: "POST",
  });
}

// ---- Uploads (component images) ----

/** Upload a data-URL image; returns the served `/api/uploads/<file>` URL. */
export async function uploadPartImage(dataUrl: string): Promise<string> {
  const r = await req<{ url: string }>("/uploads", {
    method: "POST",
    body: JSON.stringify({ dataUrl }),
  });
  return r.url;
}

export interface UploadEntry {
  file: string;
  url: string;
  size: number;
  modifiedAt: number;
  used: boolean;
  partId?: string;
  partName?: string;
}

export async function fetchUploads(): Promise<UploadEntry[]> {
  return req<UploadEntry[]>("/admin/uploads");
}

export async function deleteUpload(file: string): Promise<void> {
  await req<void>(`/admin/uploads/${encodeURIComponent(file)}`, {
    method: "DELETE",
  });
}

export async function pruneUploads(): Promise<{ deleted: number; freedBytes: number }> {
  return req<{ deleted: number; freedBytes: number }>("/admin/uploads/prune", {
    method: "POST",
  });
}

// ---- AI (OpenRouter): component description & photo search (seller/admin) ----

export interface ComponentAiInput {
  category?: string;
  name?: string;
  brand?: string;
  specs?: string;
}

/**
 * Ask the model to write a short RU description. Throws with the server error
 * code (`ai_not_configured` / `ai_failed`) on failure.
 */
export async function generateComponentDescription(
  input: ComponentAiInput,
): Promise<string> {
  const r = await req<{ description: string }>("/ai/component-description", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return r.description;
}

/**
 * Progress event streamed (NDJSON) by `POST /ai/component-image`.
 */
export type ImageStreamEvent =
  | { event: "start"; deadlineMs: number }
  | { event: "phase"; phase: "search_pages" | "download"; pages?: number }
  | { event: "candidate"; url: string; index: number }
  | { event: "done"; urls: string[] }
  | { event: "error"; error: string };

export interface StreamComponentImagesOptions {
  signal?: AbortSignal;
  onEvent?: (ev: ImageStreamEvent) => void;
}

/**
 * Ask the model to find component photos (web search) and download candidate
 * images. Reads the NDJSON progress stream, invoking `onEvent` per event, and
 * resolves with the candidate `/api/uploads/<file>` URLs from the final `done`
 * event (or the ones collected before an abort). Throws with the server error
 * code (`ai_not_configured` / `ai_failed`) when the stream fails to start or
 * emits an `error` event.
 */
export async function streamComponentImages(
  input: ComponentAiInput,
  opts: StreamComponentImagesOptions = {},
): Promise<string[]> {
  const res = await fetch(`${BASE}/ai/component-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: opts.signal,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore non-JSON errors */
    }
    throw new Error(message);
  }
  if (!res.body) throw new Error("ai_failed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const candidates: string[] = [];
  let errorMessage: string | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line) continue;
        let ev: ImageStreamEvent;
        try {
          ev = JSON.parse(line) as ImageStreamEvent;
        } catch {
          continue; // ignore malformed lines
        }
        opts.onEvent?.(ev);
        if (ev.event === "candidate") {
          candidates.push(ev.url);
        } else if (ev.event === "done") {
          candidates.length = 0;
          candidates.push(...ev.urls);
        } else if (ev.event === "error") {
          errorMessage = ev.error;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (errorMessage) throw new Error(errorMessage);
  return candidates;
}

/**
 * Best-effort cleanup of unselected AI candidates: deletes each
 * `/api/uploads/<file>` unless a part still references it. Never throws.
 */
export async function discardComponentImages(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  try {
    await req<{ ok: boolean }>("/ai/component-image/discard", {
      method: "POST",
      body: JSON.stringify({ urls }),
    });
  } catch {
    /* best-effort cleanup only */
  }
}