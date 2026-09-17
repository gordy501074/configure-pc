// Client API layer — the single source of truth for the frontend.
// All reads/mutations go through the Express + SQLite backend (via Vite proxy /api).
// Domain types (src/types) are used; JSON DTOs from the server are mapped here.

import type {
  AppSettings,
  ComponentCategory,
  Config,
  Order,
  Part,
  ReadyPc,
  Review,
  SellerBrand,
  User,
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
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
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
  price: number;
  tdp: number;
  specs: { label: string; value: string }[];
  image?: string;
  compat: Part["compat"];
}

function mapPart(p: PartApi): Part {
  const { id, category, name, brand, price, tdp, specs, image, compat } = p;
  return {
    id,
    category,
    name,
    brand,
    price,
    tdp,
    specs,
    image,
    compat,
  };
}

export async function fetchParts(
  category?: ComponentCategory,
): Promise<Part[]> {
  const q = category ? `?category=${encodeURIComponent(category)}` : "";
  const rows = await req<PartApi[]>(`/parts${q}`);
  return rows.map(mapPart);
}

/** Fetch full catalog grouped by category (Uses parallel part requests). */
export async function fetchCatalog(): Promise<Record<ComponentCategory, Part[]>> {
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
  const entries = await Promise.all(cats.map((c) => fetchParts(c).then((p) => [c, p] as const)));
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
  parts: { category: ComponentCategory; part: PartApi }[];
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
    parts: p.parts.map(({ category, part }) => ({ category, part: mapPart(part) })),
  };
}

export async function fetchReadyPcs(): Promise<ReadyPc[]> {
  const rows = await req<ReadyPcApi[]>("/ready");
  return rows.map(mapReady);
}

export async function fetchReadyPc(id: string): Promise<ReadyPc | null> {
  try {
    const row = await req<ReadyPcApi>(`/ready/${encodeURIComponent(id)}`);
    return mapReady(row);
  } catch {
    return null;
  }
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

interface ConfigPartApi {
  category: ComponentCategory;
  part: PartApi;
}

interface ConfigApi {
  id: string;
  name: string;
  source: Config["source"];
  usage?: Config["usage"];
  createdAt: number;
  updatedAt: number;
  parts: ConfigPartApi[];
}

function mapConfig(c: ConfigApi): Config {
  return {
    id: c.id,
    name: c.name,
    source: c.source,
    usage: c.usage,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    parts: c.parts.map(({ category, part }) => ({ category, part: mapPart(part) })),
  };
}

function configToApi(c: Config): ConfigApi {
  return {
    id: c.id,
    name: c.name,
    source: c.source,
    usage: c.usage,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    parts: c.parts.map(({ category, part }) => ({ category, part: part as PartApi })),
  };
}

export async function fetchConfigs(userId: string): Promise<Config[]> {
  const rows = await req<ConfigApi[]>(`/configs?userId=${encodeURIComponent(userId)}`);
  return rows.map(mapConfig);
}

export async function saveConfigRemote(config: Config, userId: string): Promise<Config> {
  const body = { ...configToApi(config), parts: configToApi(config).parts.map(({ category, part }) => ({ category, part_id: part.id })) };
  return mapConfig(await req<ConfigApi>(`/configs/${encodeURIComponent(config.id)}?userId=${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: body.name,
      source: body.source,
      usage: body.usage,
      parts: body.parts,
    }),
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
      address: order.address,
      userName: order.userName,
      items: order.items,
    }),
  });
}

export async function deleteOrderRemote(id: string): Promise<void> {
  await req<void>(`/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
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