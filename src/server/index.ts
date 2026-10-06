// Confi SQLite backend API (Express + better-sqlite3).
//
// This is the single server-side data store. The SPA client talks to these
// endpoints (via the Vite /api proxy) for the catalog, user data and auth.

import express from "express";
import cors from "cors";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogRepository, type CreatePartInput } from "./repository/catalog.ts";
import { createUserRepository } from "./repository/user-data.ts";
import { createSellerRepository } from "./repository/seller.ts";
import { createVendorRepository } from "./repository/vendor.ts";
import { createAppStateRepository } from "./repository/app-state.ts";
import { createAnalyticsRepository, type AnalyticsEvent } from "./repository/analytics.ts";
import { createSalesAnalyticsRepository, type SalesAnalyticsScope } from "./repository/analytics-sales.ts";
import { createPriceListRepository } from "./repository/price-list.ts";
import { openDb } from "./db.ts";
import type { SaveConfigInput, SaveOrderInput, SaveReviewInput, UserDependencies } from "./repository/user-data.ts";
import { UserHasDependenciesError } from "./repository/user-data.ts";
import type { CatalogRepository } from "./repository/catalog.ts";
import type { ComponentCategory, OrderStatus, PartCompat, PartDto, SpecItem, Usage, UserRole } from "./repository/types.ts";
import { isPartOrderable, deriveBuildSpecs } from "./repository/types.ts";
import { SELLER_ORDER_TRANSITIONS } from "../lib/orderStatus.ts";
import { IMAGE_MIME_EXT, MAX_IMAGE_BYTES } from "../lib/imageUpload.ts";
import { components } from "../data/mock.ts";

const app = express();
app.use(cors());

// Image uploads live in a repo-root `uploads/` dir (override for tests), served
// read-only under /api/uploads/<file> so the Vite /api proxy covers it in dev.
const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(serverRoot, "uploads");
mkdirSync(UPLOADS_DIR, { recursive: true });
// Base64 of a 5 MB image is ~6.7 MB, so this route needs a larger body limit.
// It is mounted before the global parser (which then skips the already-parsed
// body), keeping the default 100kb limit on every other endpoint.
app.use("/api/uploads", express.json({ limit: "8mb" }));
app.use(express.json());
app.use(
  "/api/uploads",
  express.static(UPLOADS_DIR, { fallthrough: true, maxAge: "1h" }),
);

const db = openDb();
const catalog = createCatalogRepository(db);
const userData = createUserRepository(db);
const sellerRepo = createSellerRepository(db);
const vendorRepo = createVendorRepository(db);
const appState = createAppStateRepository(db);
const analytics = createAnalyticsRepository(db);
const salesAnalytics = createSalesAnalyticsRepository(db);
const priceLists = createPriceListRepository(db);

const VALID_ROLES: UserRole[] = ["customer", "seller", "admin"];

/** Resolve the acting user id: explicit body/query user or surrogate session. */
function actorId(req: express.Request): string {
  const fromBody = (req.body as { userId?: string } | undefined)?.userId;
  const fromQuery =
    typeof req.query.userId === "string" ? req.query.userId : undefined;
  return (fromBody ?? fromQuery ?? "usr-localstorage-import") as string;
}

/** Read the client session id from the confi_session cookie, or body.sessionId. */
function sessionIdOf(req: express.Request): string | null {
  const header = req.headers.cookie;
  if (header) {
    const m = header.match(/(?:^|;\s*)confi_session=([^;]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  const body = req.body as { sessionId?: string } | undefined;
  return body?.sessionId ?? null;
}

/** Resolve the acting user's role from the session; null if none/invalid. */
function actorRole(req: express.Request): { userId: string; role: UserRole } | null {
  const sid = sessionIdOf(req);
  if (!sid) return null;
  const userId = appState.getSessionUser(sid);
  if (!userId) return null;
  const user = userData.getUser(userId);
  if (!user) return null;
  return { userId: user.id, role: user.role };
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
): { userId: string; role: UserRole } | null {
  const actor = actorRole(req);
  if (!actor) {
    res.status(403).json({ error: "unauthorized" });
    return null;
  }
  if (actor.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return actor;
}

/** Require the acting session to belong to a `customer` (no purchases/saves for admin/seller). */
function requireCustomer(
  req: express.Request,
  res: express.Response,
): { userId: string; role: UserRole } | null {
  const actor = actorRole(req);
  if (!actor) {
    res.status(403).json({ error: "unauthorized" });
    return null;
  }
  if (actor.role !== "customer") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return actor;
}

/** Require the acting role to be `seller` or `admin` (catalog management). */
function requireSellerOrAdmin(
  req: express.Request,
  res: express.Response,
): { userId: string; role: UserRole } | null {
  const actor = actorRole(req);
  if (!actor) {
    res.status(403).json({ error: "unauthorized" });
    return null;
  }
  if (actor.role !== "seller" && actor.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return actor;
}

// ---- Uploads (component images) ----

const UPLOAD_MIME_EXT = IMAGE_MIME_EXT;
const UPLOAD_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Verify magic bytes for an allowlisted raster format (SVG deliberately excluded). */
function matchesMagic(buf: Buffer, ext: string): boolean {
  if (buf.length < 12) return false;
  switch (ext) {
    case "png":
      return (
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
      );
    case "jpg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "gif":
      return buf.toString("latin1", 0, 6) === "GIF87a" || buf.toString("latin1", 0, 6) === "GIF89a";
    case "webp":
      return (
        buf.toString("latin1", 0, 4) === "RIFF" &&
        buf.toString("latin1", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}

/** Decode a `data:image/...;base64,...` URL, validating MIME and magic bytes. */
function decodeImageDataUrl(
  dataUrl: string,
): { buffer: Buffer; ext: string } | { error: string } {
  const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) return { error: "invalid_file" };
  const mime = m[1].toLowerCase();
  const ext = UPLOAD_MIME_EXT[mime];
  if (!ext) return { error: "invalid_file_type" };
  let buffer: Buffer;
  try {
    buffer = Buffer.from(m[2], "base64");
  } catch {
    return { error: "invalid_file" };
  }
  if (buffer.length === 0) return { error: "invalid_file" };
  if (buffer.length > MAX_IMAGE_BYTES) return { error: "file_too_large" };
  if (!matchesMagic(buffer, ext)) return { error: "invalid_file" };
  return { buffer, ext };
}

/** Resolve a client-supplied upload file name to a safe on-disk path, or null. */
function safeUploadPath(file: string): { name: string; path: string } | null {
  if (!file || file !== basename(file) || file.includes("..")) return null;
  const ext = extname(file).slice(1).toLowerCase();
  if (!UPLOAD_EXT_MIME[ext]) return null;
  const full = join(UPLOADS_DIR, file);
  if (dirname(full) !== UPLOADS_DIR) return null;
  return { name: file, path: full };
}

/** Best-effort delete of an upload referenced by a stored `/api/uploads/<file>` URL. */
function deleteUploadByUrl(url: string | null): void {
  if (!url || !url.startsWith("/api/uploads/")) return;
  const name = url.slice("/api/uploads/".length);
  const safe = safeUploadPath(name);
  if (!safe) return;
  try {
    if (existsSync(safe.path)) unlinkSync(safe.path);
  } catch {
    /* best-effort: ignore races/permission errors */
  }
}

app.post("/api/uploads", (req, res) => {
  if (!requireSellerOrAdmin(req, res)) return;
  const body = (req.body ?? {}) as { dataUrl?: unknown };
  if (typeof body.dataUrl !== "string") {
    return res.status(400).json({ error: "invalid_file" });
  }
  const decoded = decodeImageDataUrl(body.dataUrl);
  if ("error" in decoded) {
    return res.status(400).json({ error: decoded.error });
  }
  const file = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${decoded.ext}`;
  try {
    writeFileSync(join(UPLOADS_DIR, file), decoded.buffer);
  } catch {
    return res.status(500).json({ error: "upload_failed" });
  }
  res.status(201).json({ url: `/api/uploads/${file}` });
});

// ---- Catalog ----
app.get("/api/parts", (req, res) => {
  const category =
    typeof req.query.category === "string" ? req.query.category : undefined;
  // Only sellers/admins may list deactivated parts (catalog management view).
  const includeInactive = req.query.includeInactive === "1";
  if (includeInactive && !actorRole(req)) {
    return res.status(403).json({ error: "unauthorized" });
  }
  if (includeInactive && actorRole(req)!.role !== "seller" && actorRole(req)!.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }
  const sellerId =
    typeof req.query.sellerId === "string" ? req.query.sellerId : undefined;
  res.json(
    category
      ? catalog.listParts(category as never, includeInactive, sellerId)
      : catalog.listParts(undefined, includeInactive, sellerId),
  );
});

app.get("/api/parts/:id", (req, res) => {
  const sellerId =
    typeof req.query.sellerId === "string" ? req.query.sellerId : undefined;
  const part = catalog.getPart(req.params.id, sellerId);
  if (!part) return res.status(404).json({ error: "part not found" });
  res.json(part);
});

app.get("/api/ready", (req, res) => {
  const sellerId =
    typeof req.query.sellerId === "string" ? req.query.sellerId : undefined;
  const onlyValid = req.query.valid === "1";
  const list = catalog.listReadyPcs(sellerId);
  res.json(onlyValid ? list.filter((pc) => pc.valid) : list);
});

app.get("/api/ready/:id", (req, res) => {
  const sellerId =
    typeof req.query.sellerId === "string" ? req.query.sellerId : undefined;
  const pc = catalog.getReadyPc(req.params.id, sellerId);
  if (!pc) return res.status(404).json({ error: "ready pc not found" });
  res.json(pc);
});

// ---- Sellers (for the catalog seller selector) ----
app.get("/api/sellers", (_req, res) => {
  const sellers = userData
    .listUsers()
    .filter((u) => u.role === "seller")
    .map((u) => ({ id: u.id, name: u.name, company: u.company }));
  res.json(sellers);
});

// ---- Price lists (owner or admin) ----
function priceListActor(
  req: express.Request,
  res: express.Response,
): { actor: { userId: string; role: UserRole }; sellerId: string } | null {
  const actor = actorRole(req);
  if (!actor) {
    res.status(403).json({ error: "unauthorized" });
    return null;
  }
  if (actor.role !== "admin" && actor.userId !== req.params.id) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return { actor, sellerId: String(req.params.id) };
}

app.get("/api/seller/:id/price-lists", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  res.json(priceLists.listPriceLists(ctx.sellerId));
});

app.post("/api/seller/:id/price-lists", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  const name = String((req.body as { name?: unknown })?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const created = priceLists.createPriceList(ctx.sellerId, name);
  res.status(201).json(created);
});

app.patch("/api/seller/:id/price-lists/:listId", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  const name = String((req.body as { name?: unknown })?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const updated = priceLists.renamePriceList(String(req.params.listId), name);
  if (!updated) return res.status(404).json({ error: "price list not found" });
  res.json(updated);
});

app.delete("/api/seller/:id/price-lists/:listId", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  const ok = priceLists.deletePriceList(String(req.params.listId));
  if (!ok) return res.status(404).json({ error: "price list not found" });
  res.status(204).end();
});

app.post("/api/seller/:id/price-lists/:listId/activate", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  const updated = priceLists.setActivePriceList(String(req.params.listId));
  if (!updated) return res.status(404).json({ error: "price list not found" });
  res.json(updated);
});

app.put("/api/seller/:id/price-lists/:listId/items/:partId", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  const price = Number((req.body as { price?: unknown })?.price);
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: "invalid_price" });
  }
  const updated = priceLists.upsertItem(
    String(req.params.listId),
    String(req.params.partId),
    price,
  );
  if (!updated) return res.status(404).json({ error: "price list not found" });
  res.json(updated);
});

app.delete("/api/seller/:id/price-lists/:listId/items/:partId", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  const ok = priceLists.deleteItem(
    String(req.params.listId),
    String(req.params.partId),
  );
  if (!ok) return res.status(404).json({ error: "item not found" });
  res.status(204).end();
});

app.get("/api/seller/:id/price-lists/:listId/items/missing", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  const includeInactive = req.query.includeInactive === "1";
  res.json(
    priceLists.listMissingItems(
      ctx.sellerId,
      String(req.params.listId),
      includeInactive,
    ),
  );
});

app.post("/api/seller/:id/price-lists/:listId/items/bulk", (req, res) => {
  const ctx = priceListActor(req, res);
  if (!ctx) return;
  const partIds = (req.body as { partIds?: unknown })?.partIds;
  const ids = Array.isArray(partIds)
    ? (partIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const result = priceLists.addItems(String(req.params.listId), ids);
  res.json(result);
});

// ---- User / session ----
app.post("/api/session", (req, res) => {
  const body = req.body as {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
    createdAt?: number;
  };
  if (body.role !== undefined && !VALID_ROLES.includes(body.role as UserRole)) {
    return res.status(400).json({ error: "invalid role" });
  }
  const user = userData.upsertUser({
    id: body.id,
    name: body.name ?? "Гость",
    email: body.email,
    phone: body.phone,
    role: (body.role as UserRole | undefined) ?? "customer",
    createdAt: body.createdAt,
  });
  const sessionId = appState.createSession(user.id);
  res.json({ user, sessionId });
});

app.post("/api/session/logout", (req, res) => {
  const body = req.body as { sessionId?: string };
  if (body.sessionId) appState.deleteSession(body.sessionId);
  res.status(204).end();
});

app.get("/api/session/:id", (req, res) => {
  const userId = appState.getSessionUser(req.params.id);
  if (!userId) return res.status(404).json({ error: "session not found" });
  const user = userData.getUser(userId);
  if (!user) return res.status(404).json({ error: "user not found" });
  res.json({ user, sessionId: req.params.id });
});

app.get("/api/user/:id", (req, res) => {
  const user = userData.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "user not found" });
  res.json(user);
});

// ---- Profile (self-service: client/seller) ----
app.patch("/api/profile", (req, res) => {
  const actor = actorRole(req);
  if (!actor) return res.status(403).json({ error: "unauthorized" });
  if (actor.role === "admin") return res.status(403).json({ error: "forbidden" });

  const body = (req.body ?? {}) as { name?: string; company?: string };
  const user = userData.updateProfile(actor.userId, {
    name: body.name,
    company: body.company,
  });
  if (!user) return res.status(404).json({ error: "user not found" });
  res.json(user);
});

// ---- Admin: user management ----
app.get("/api/users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(userData.listUsers());
});

app.post("/api/users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
    company?: string;
  };
  const role = (body.role ?? "customer") as UserRole;
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "invalid role" });
  }
  if (!body.name || !String(body.name).trim()) {
    return res.status(400).json({ error: "name required" });
  }
  let user;
  try {
    user = userData.createUser({
      name: String(body.name).trim(),
      email: body.email,
      phone: body.phone,
      role,
      company: body.company,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "email_exists") {
      return res.status(409).json({ error: "email_exists" });
    }
    return res.status(400).json({ error: "invalid user" });
  }
  res.json(user);
});

/** Build a human-readable Russian reason from non-zero dependency counts. */
function describeDependencies(deps: UserDependencies): string {
  const parts: string[] = [];
  const add = (n: number, one: string, few: string, many: string) => {
    if (n <= 0) return;
    const mod10 = n % 10;
    const mod100 = n % 100;
    let word = many;
    if (mod10 === 1 && mod100 !== 11) word = one;
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = few;
    parts.push(`${n} ${word}`);
  };
  add(deps.orders, "заказ", "заказа", "заказов");
  add(deps.configs + deps.sellerConfigs, "сборка", "сборки", "сборок");
  add(deps.readyPcs, "готовая сборка", "готовые сборки", "готовых сборок");
  add(deps.priceLists, "прайс-лист", "прайс-листа", "прайс-листов");
  add(deps.brands, "бренд", "бренда", "брендов");
  add(deps.orderLines, "позиция заказа", "позиции заказов", "позиций заказов");
  return (
    `Нельзя удалить пользователя: за ним закреплены ${parts.join(", ")}. ` +
    `Сначала удалите или передайте связанные записи другому продавцу.`
  );
}

app.delete("/api/users/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const user = userData.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "user not found" });
  try {
    const ok = userData.deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "user not found" });
  } catch (err) {
    if (err instanceof UserHasDependenciesError) {
      return res.status(409).json({
        error: "user_has_dependencies",
        details: {
          dependencies: err.dependencies,
          message: describeDependencies(err.dependencies),
        },
      });
    }
    throw err;
  }
  res.status(204).end();
});

app.patch("/api/users/:id/role", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = req.body as { role?: string };
  const role = body.role as UserRole | undefined;
  if (!role || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "invalid role" });
  }
  const user = userData.setUserRole(req.params.id, role);
  if (!user) return res.status(404).json({ error: "user not found" });
  res.json(user);
});

// ---- Seller: brands (owner or admin) ----
function sellerBrandActor(
  req: express.Request,
  res: express.Response,
): { actor: { userId: string; role: UserRole }; sellerId: string } | null {
  const actor = actorRole(req);
  if (!actor) {
    res.status(403).json({ error: "unauthorized" });
    return null;
  }
  if (actor.role !== "admin" && actor.userId !== req.params.id) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return { actor, sellerId: String(req.params.id) };
}

app.get("/api/seller/:id/brands", (req, res) => {
  const ctx = sellerBrandActor(req, res);
  if (!ctx) return;
  res.json(sellerRepo.listSellerBrands(ctx.sellerId));
});

app.put("/api/seller/:id/brands", (req, res) => {
  const ctx = sellerBrandActor(req, res);
  if (!ctx) return;
  const body = req.body as { brand?: string; description?: string };
  const brand = String(body.brand ?? "").trim();
  if (!brand) return res.status(400).json({ error: "brand required" });
  const existing = sellerRepo.listSellerBrands(ctx.sellerId).find((b) => b.brand === brand);
  if (existing) return res.status(409).json({ error: "brand_exists" });
  const created = sellerRepo.addBrand(
    ctx.sellerId,
    brand,
    typeof body.description === "string" ? body.description : undefined,
  );
  res.status(201).json(created);
});

app.patch("/api/seller/:id/brands/:brand", (req, res) => {
  const ctx = sellerBrandActor(req, res);
  if (!ctx) return;
  const body = req.body as { brand?: string; description?: string };
  const patch: { brand?: string; description?: string } = {};
  const nextBrand = typeof body.brand === "string" ? body.brand.trim() : undefined;
  if (nextBrand !== undefined && !nextBrand) {
    return res.status(400).json({ error: "brand required" });
  }
  if (nextBrand !== undefined) patch.brand = nextBrand;
  if (typeof body.description === "string") patch.description = body.description;
  const updated = sellerRepo.updateBrand(ctx.sellerId, String(req.params.brand), patch);
  if (!updated) return res.status(404).json({ error: "brand not found" });
  res.json(updated);
});

app.delete("/api/seller/:id/brands/:brand", (req, res) => {
  const ctx = sellerBrandActor(req, res);
  if (!ctx) return;
  const ok = sellerRepo.deleteBrand(ctx.sellerId, String(req.params.brand));
  if (!ok) return res.status(404).json({ error: "brand not found" });
  res.status(204).end();
});

// ---- Ready builds (owner or admin, via a ComponentPicker-like tool) ----

interface PartRef {
  category: ComponentCategory;
  partId: string;
}

function readyBuildActor(
  req: express.Request,
  res: express.Response,
): { actor: { userId: string; role: UserRole }; sellerId: string } | null {
  const actor = actorRole(req);
  if (!actor) {
    res.status(403).json({ error: "unauthorized" });
    return null;
  }
  if (actor.role !== "admin" && actor.userId !== req.params.id) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return { actor, sellerId: String(req.params.id) };
}

/** Parse { brand, model, parts: PartRef[] } from a request body (loose). */
function parseReadyBuildBody(
  body: Record<string, unknown>,
): { brand: string; model: string; parts: PartRef[] } | { error: string } {
  const brand = String(body.brand ?? "").trim();
  const model = String(body.model ?? "").trim();
  if (!brand) return { error: "brand required" };
  if (!model) return { error: "model required" };
  const rawParts = body.parts;
  if (!Array.isArray(rawParts)) return { error: "invalid_build" };
  const parts: PartRef[] = [];
  for (const raw of rawParts) {
    const r = raw as { category?: unknown; partId?: unknown };
    if (typeof r?.category !== "string" || typeof r?.partId !== "string") {
      return { error: "invalid_build" };
    }
    parts.push({ category: r.category as ComponentCategory, partId: r.partId });
  }
  return { brand, model, parts };
}

/** Sum of active-list prices for a build composition (rubles). */
function buildPrice(
  sellerId: string,
  parts: PartRef[],
): { price: number; tdp: number } {
  let price = 0;
  let tdp = 0;
  for (const ref of parts) {
    const part = catalog.getPart(ref.partId, sellerId);
    if (part?.price !== undefined) price += part.price;
    if (part) tdp += part.tdp;
  }
  return { price, tdp };
}

/** Derive showcase spec rows (Процессор/Видеокарта/Память/…) from a build composition. */
function buildSpecs(sellerId: string, parts: PartRef[]): SpecItem[] {
  return deriveBuildSpecs(
    parts.map((p) => ({ category: p.category, part: catalog.getPart(p.partId, sellerId) })),
  );
}

app.get("/api/seller/:id/ready", (req, res) => {
  const ctx = readyBuildActor(req, res);
  if (!ctx) return;
  res.json(catalog.listReadyPcsIncludeInactive(ctx.sellerId));
});

app.get("/api/seller/:id/ready/:buildId", (req, res) => {
  const ctx = readyBuildActor(req, res);
  if (!ctx) return;
  const pc = catalog.getReadyPcAny(req.params.buildId, ctx.sellerId);
  if (!pc) return res.status(404).json({ error: "build not found" });
  res.json(pc);
});

app.post("/api/seller/:id/ready", (req, res) => {
  const ctx = readyBuildActor(req, res);
  if (!ctx) return;
  const parsed = parseReadyBuildBody((req.body ?? {}) as Record<string, unknown>);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  const { brand, model, parts } = parsed;

  const brandOwned = sellerRepo.listSellerBrands(ctx.sellerId).some((b) => b.brand === brand);
  if (!brandOwned) return res.status(400).json({ error: "invalid_brand" });

  const buildErr = validateBuildParts(catalog, ctx.sellerId, parts);
  if (buildErr) return res.status(400).json({ error: buildErr });

  const name = composeBuildName(brand, model);
  if (catalog.readyModelExists(ctx.sellerId, brand, model)) {
    return res.status(409).json({ error: "model_exists" });
  }

  const { price, tdp } = buildPrice(ctx.sellerId, parts);
  const created = catalog.createReadyBuild({
    name,
    brand,
    usage: "universal",
    tdp,
    price,
    summary: `Готовая конфигурация ${name}`,
    specs: buildSpecs(ctx.sellerId, parts),
    sellerId: ctx.sellerId,
    parts,
  });
  res.status(201).json(created);
});

app.put("/api/seller/:id/ready/:buildId", (req, res) => {
  const ctx = readyBuildActor(req, res);
  if (!ctx) return;
  const existing = catalog.getReadyPcAny(req.params.buildId, ctx.sellerId);
  if (!existing) return res.status(404).json({ error: "build not found" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const brand = typeof body.brand === "string" ? body.brand.trim() : undefined;
  const model = typeof body.model === "string" ? body.model.trim() : undefined;
  const rawParts = Array.isArray(body.parts) ? body.parts : undefined;
  const parts = rawParts
    ? (rawParts as { category?: unknown; partId?: unknown }[])
        .filter((r) => typeof r?.category === "string" && typeof r?.partId === "string")
        .map((r) => ({ category: r.category as ComponentCategory, partId: r.partId as string }))
    : undefined;

  if (brand !== undefined) {
    const brandOwned = sellerRepo.listSellerBrands(ctx.sellerId).some((b) => b.brand === brand);
    if (!brandOwned) return res.status(400).json({ error: "invalid_brand" });
  }

  const nextBrand = brand ?? existing.brand;
  const nextModel = model !== undefined ? model : modelFromBuildName(existing.name, existing.brand);
  if (!nextModel) return res.status(400).json({ error: "model required" });

  if (parts) {
    if (parts.length !== 8) return res.status(400).json({ error: "invalid_build" });
    const buildErr = validateBuildParts(catalog, ctx.sellerId, parts);
    if (buildErr) return res.status(400).json({ error: buildErr });
  }

  const resultBrand = nextBrand;
  const resultName = composeBuildName(resultBrand, nextModel);
  // Uniqueness against other active builds (exclude self), by model only.
  if (catalog.readyModelExists(ctx.sellerId, resultBrand, nextModel, existing.id)) {
    return res.status(409).json({ error: "model_exists" });
  }

  const effectiveParts = parts ?? existing.parts
    .filter((cp): cp is { category: ComponentCategory; part: NonNullable<typeof cp.part> } => !!cp.part)
    .map((cp) => ({ category: cp.category, partId: cp.part!.id }));

  // Only recompute price/tdp when the composition changes; a rename/brand-only
  // update preserves the stored values (some slots may be temporarily unpriced).
  const priceTdp = parts ? buildPrice(ctx.sellerId, effectiveParts) : undefined;

  const updated = catalog.updateReadyBuild(existing.id, {
    name: resultName,
    brand: resultBrand,
    ...(priceTdp ? { price: priceTdp.price, tdp: priceTdp.tdp } : {}),
    summary: `Готовая конфигурация ${resultName}`,
    ...(parts ? { specs: buildSpecs(ctx.sellerId, effectiveParts) } : {}),
    parts: parts ? effectiveParts : undefined,
  });
  if (!updated) return res.status(404).json({ error: "build not found" });
  res.json(updated);
});

app.delete("/api/seller/:id/ready/:buildId", (req, res) => {
  const ctx = readyBuildActor(req, res);
  if (!ctx) return;
  const existing = catalog.getReadyPcAny(req.params.buildId, ctx.sellerId);
  if (!existing) return res.status(404).json({ error: "build not found" });
  catalog.deactivateReadyPc(existing.id);
  res.status(204).end();
});

app.post("/api/seller/:id/ready/:buildId/reactivate", (req, res) => {
  const ctx = readyBuildActor(req, res);
  if (!ctx) return;
  const existing = catalog.getReadyPcAny(req.params.buildId, ctx.sellerId);
  if (!existing) return res.status(404).json({ error: "build not found" });
  const model = modelFromBuildName(existing.name, existing.brand);
  if (catalog.readyModelExists(ctx.sellerId, existing.brand, model, existing.id)) {
    return res.status(409).json({ error: "model_exists" });
  }
  catalog.reactivateReadyPc(existing.id);
  res.json(catalog.getReadyPcAny(existing.id, ctx.sellerId));
});

// ---- Vendors & components (seller/admin) ----

const CATEGORIES: ComponentCategory[] = [
  "cpu",
  "gpu",
  "motherboard",
  "ram",
  "storage",
  "case",
  "psu",
  "cooler",
];

app.get("/api/vendors", (_req, res) => {
  res.json(vendorRepo.listVendors());
});

/**
 * Validate a create-part body against the category's required compat fields.
 * Returns an error string or null when valid.
 */
function validatePartBody(body: Record<string, unknown>): string | null {
  const category = body.category as ComponentCategory | undefined;
  if (!category || !CATEGORIES.includes(category)) return "invalid_category";
  const brand = String(body.brand ?? "").trim();
  if (!brand) return "brand_required";
  const vendor = String(body.vendor ?? "").trim();
  if (!vendor) return "vendor_required";
  const tdp = Number(body.tdp ?? 0);
  if (!Number.isFinite(tdp) || tdp < 0 || tdp > 65355) return "invalid_tdp";

  const compat = (body.compat ?? {}) as Record<string, unknown>;
  // Required/relevant per category.
  if (category === "cpu" && !compat.socket) return "socket_required";
  if (category === "motherboard" && (!compat.socket || !compat.ramType || !compat.formFactor))
    return "motherboard_compat_required";
  if (category === "ram" && !compat.ramType) return "ram_type_required";
  if (category === "psu" && !compat.power) return "psu_power_required";
  return null;
}

/** Compose the full display name from a trademark and a model, e.g. "Intel Core i5-13400F". */
function composePartName(vendorName: string, brand: string): string {
  const v = String(vendorName ?? "").trim();
  const b = String(brand ?? "").trim();
  if (v && b) return `${v} ${b}`;
  return v || b;
}

/** Return the first whitespace token, used to derive a vendor hint from an existing name. */
function firstToken(s: string): string {
  return String(s ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Strip a leading trademark from a full name, returning the model/line name. */
function modelFromName(name: string, vendorName: string): string {
  const n = String(name ?? "").trim();
  const v = String(vendorName ?? "").trim();
  if (!v) return n;
  if (n.toLowerCase().startsWith(v.toLowerCase())) {
    return n.slice(v.length).trim();
  }
  return n;
}

/** Compose a ready build's full name from a seller brand and a model, e.g. "Confi Gaming 1440p". */
function composeBuildName(brand: string, model: string): string {
  const b = String(brand ?? "").trim();
  const m = String(model ?? "").trim();
  if (b && m) return `${b} ${m}`;
  return b || m;
}

/** Recover the model suffix from a full build name and its brand: "Confi Gaming 1440p" -> "Gaming 1440p". */
function modelFromBuildName(name: string, brand: string): string {
  const n = String(name ?? "").trim();
  const b = String(brand ?? "").trim();
  if (!b) return n;
  if (n.toLowerCase().startsWith(b.toLowerCase())) {
    return n.slice(b.length).trim();
  }
  return n;
}

/** True when the slot is orderable (active part with a positive price in the active list). */
function activePriceOk(part: PartDto | undefined | null): boolean {
  return isPartOrderable(part);
}

const VALID_BUILD_CATEGORIES: ComponentCategory[] = [
  "cpu",
  "gpu",
  "motherboard",
  "ram",
  "storage",
  "case",
  "psu",
  "cooler",
];

/** Validate a PartRef[] build composition: exactly all 8 categories with orderable parts in the active price list. */
function validateBuildParts(catalog: CatalogRepository, sellerId: string, parts: PartRef[]): string | null {
  const cats = new Set(parts.map((p) => p.category));
  if (parts.length !== 8 || cats.size !== 8) return "invalid_build";
  for (const cat of VALID_BUILD_CATEGORIES) {
    if (!cats.has(cat)) return "invalid_build";
  }
  for (const ref of parts) {
    const part = catalog.getPart(ref.partId, sellerId);
    if (!activePriceOk(part)) return "invalid_build";
    if (part!.category !== ref.category) return "invalid_build";
  }
  return null;
}

app.post("/api/components", (req, res) => {
  if (!requireSellerOrAdmin(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const err = validatePartBody(body);
  if (err) return res.status(400).json({ error: err });

  const vendor = vendorRepo.getOrCreateVendor(String(body.vendor));
  const id = String(body.id ?? `part-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const compat = (body.compat ?? {}) as PartCompat;
  const specs = Array.isArray(body.specs) ? (body.specs as SpecItem[]) : [];
  const brand = String(body.brand ?? "").trim();
  const part = catalog.createPart({
    id,
    category: body.category as ComponentCategory,
    name: composePartName(vendor.name, brand),
    brand,
    vendorId: vendor.id,
    tdpWatt: Math.round(Number(body.tdp ?? 0)),
    compat,
    specs,
    imageUrl: typeof body.image === "string" && body.image.trim() ? body.image.trim() : null,
  });
  res.status(201).json(part);
});

app.patch("/api/components/:id", (req, res) => {
  if (!requireSellerOrAdmin(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;

  // vendor (optional) -> resolve/create and set vendorId.
  let vendorId: string | undefined;
  if (typeof body.vendor === "string" && body.vendor.trim()) {
    vendorId = vendorRepo.getOrCreateVendor(body.vendor).id;
  }

  const patch: {
    name?: string;
    brand?: string;
    vendorId?: string;
    tdpWatt?: number;
    compat?: PartCompat;
    specs?: SpecItem[];
    imageUrl?: string | null;
  } = {};
  const brand = typeof body.brand === "string" ? body.brand.trim() : undefined;
  if (brand !== undefined) patch.brand = brand;
  if (vendorId !== undefined) patch.vendorId = vendorId;
  if (body.tdp !== undefined) {
    const tdp = Number(body.tdp);
    if (!Number.isFinite(tdp) || tdp < 0 || tdp > 65355) {
      return res.status(400).json({ error: "invalid_tdp" });
    }
    patch.tdpWatt = Math.round(tdp);
  }
  if (body.compat !== undefined) patch.compat = body.compat as PartCompat;
  if (body.specs !== undefined) patch.specs = body.specs as SpecItem[];

  // Image: "" / null clears it; a non-empty string sets it. undefined = unchanged.
  if (body.image !== undefined) {
    patch.imageUrl =
      typeof body.image === "string" && body.image.trim() ? body.image.trim() : null;
  }

  // Recompute the full display name from vendor + brand when either changes.
  if (brand !== undefined || vendorId !== undefined) {
    const existing = catalog.getPartAny(req.params.id);
    if (!existing) return res.status(404).json({ error: "part not found" });
    const nextBrand = brand ?? existing.brand;
    const nextVendorName =
      vendorId !== undefined
        ? (vendorRepo.getVendor(vendorId)?.name ?? "")
        : (vendorRepo.getVendor(existing.vendorId ?? "")?.name ?? firstToken(existing.name));
    patch.name = composePartName(nextVendorName, nextBrand);
  }

  const previousImage =
    patch.imageUrl !== undefined ? catalog.getPartAny(req.params.id)?.image ?? null : null;
  const updated = catalog.updatePart(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "part not found" });
  // Best-effort: drop the replaced/cleared file so uploads don't accumulate, but
  // only when no other part still references the same shared upload.
  if (patch.imageUrl !== undefined && previousImage !== patch.imageUrl) {
    const stillUsed = db
      .prepare(`SELECT 1 FROM part WHERE image_url = ? AND part_id <> ? LIMIT 1`)
      .get(previousImage, req.params.id);
    if (!stillUsed) deleteUploadByUrl(previousImage);
  }
  res.json(updated);
});

app.post("/api/components/:id/deactivate", (req, res) => {
  if (!requireSellerOrAdmin(req, res)) return;
  const ok = catalog.deactivatePart(req.params.id);
  if (!ok) return res.status(404).json({ error: "part not found" });
  res.json({ ok: true });
});

app.post("/api/components/:id/reactivate", (req, res) => {
  if (!requireSellerOrAdmin(req, res)) return;
  const ok = catalog.reactivatePart(req.params.id);
  if (!ok) return res.status(404).json({ error: "part not found" });
  res.json({ ok: true });
});

app.post("/api/catalog/initialize", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const input: CreatePartInput[] = [];
  for (const cat of CATEGORIES) {
    for (const p of components[cat]) {
      // vendor = торговая марка (trademark from mock, e.g. "Cooler Master"),
      // model = название минус префикс-торговая марка.
      const vendor = vendorRepo.getOrCreateVendor(p.brand);
      const brand = modelFromName(p.name, p.brand);
      input.push({
        id: p.id,
        category: p.category,
        name: composePartName(vendor.name, brand),
        brand,
        vendorId: vendor.id,
        tdpWatt: Math.round(p.tdp),
        compat: p.compat,
        specs: p.specs,
        imageUrl: p.image ?? null,
      });
    }
  }
  const result = catalog.initializeCatalog(input);
  res.json({ ok: true, ...result });
});

// ---- Admin: uploaded component photos ----

interface UploadEntry {
  file: string;
  url: string;
  size: number;
  modifiedAt: number;
  used: boolean;
  partId?: string;
  partName?: string;
}

/** Map of `/api/uploads/<file>` URL -> first referencing part (id/name). */
function uploadReferences(): Map<string, { partId: string; partName: string }> {
  const rows = db
    .prepare(
      `SELECT part_id, name, image_url FROM part WHERE image_url LIKE '/api/uploads/%'`,
    )
    .all() as { part_id: string; name: string; image_url: string }[];
  const map = new Map<string, { partId: string; partName: string }>();
  for (const r of rows) {
    if (!map.has(r.image_url)) map.set(r.image_url, { partId: r.part_id, partName: r.name });
  }
  return map;
}

/** List files currently present in UPLOADS_DIR with usage info. */
function listUploads(): UploadEntry[] {
  const refs = uploadReferences();
  const entries: UploadEntry[] = [];
  for (const file of readdirSync(UPLOADS_DIR)) {
    const full = join(UPLOADS_DIR, file);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const url = `/api/uploads/${file}`;
    const ref = refs.get(url);
    entries.push({
      file,
      url,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      used: !!ref,
      partId: ref?.partId,
      partName: ref?.partName,
    });
  }
  return entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

app.get("/api/admin/uploads", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(listUploads());
});

app.delete("/api/admin/uploads/:file", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const safe = safeUploadPath(String(req.params.file));
  if (!safe) return res.status(400).json({ error: "invalid_file" });
  if (!existsSync(safe.path)) return res.status(404).json({ error: "file_not_found" });
  const ref = uploadReferences().get(`/api/uploads/${safe.name}`);
  if (ref) return res.status(409).json({ error: "file_in_use" });
  try {
    unlinkSync(safe.path);
  } catch {
    /* best-effort */
  }
  res.status(204).end();
});

app.post("/api/admin/uploads/prune", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const refs = new Set(uploadReferences().keys());
  let deleted = 0;
  let freedBytes = 0;
  for (const file of readdirSync(UPLOADS_DIR)) {
    const full = join(UPLOADS_DIR, file);
    if (refs.has(`/api/uploads/${file}`)) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    try {
      unlinkSync(full);
      deleted += 1;
      freedBytes += stat.size;
    } catch {
      /* best-effort: ignore races */
    }
  }
  res.json({ deleted, freedBytes });
});

// ---- Configs ----
app.get("/api/configs", (req, res) => {
  res.json(userData.listConfigs(actorId(req)));
});

app.get("/api/configs/:id", (req, res) => {
  const cfg = userData.getConfig(req.params.id);
  if (!cfg) return res.status(404).json({ error: "config not found" });
  res.json(cfg);
});

app.put("/api/configs/:id", (req, res) => {
  const actor = requireCustomer(req, res);
  if (!actor) return;
  const input = req.body as Omit<SaveConfigInput, "user_id" | "id">;
  const cfg = userData.saveConfig({
    id: req.params.id,
    user_id: actor.userId,
    ...input,
  });
  res.json(cfg);
});

app.delete("/api/configs/:id", (req, res) => {
  if (!requireCustomer(req, res)) return;
  const ok = userData.deleteConfig(req.params.id);
  if (!ok) return res.status(404).json({ error: "config not found" });
  res.status(204).end();
});

// ---- Orders ----
app.get("/api/orders", (req, res) => {
  res.json(userData.listOrders(actorId(req)));
});

/**
 * Reject when `orderId` exists but belongs to another user.
 * Returns true when the caller may proceed (owner or a brand-new order id).
 */
function assertOrderOwner(
  orderId: string,
  actorId: string,
  res: express.Response,
): boolean {
  const owner = userData.getOrderOwner(orderId);
  if (owner !== null && owner !== actorId) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

app.put("/api/orders/:id", (req, res) => {
  const actor = requireCustomer(req, res);
  if (!actor) return;
  if (!assertOrderOwner(req.params.id, actor.userId, res)) return;
  const input = req.body as Omit<SaveOrderInput, "user_id" | "id">;
  // A customer may create an order as 'new' (or 'alpha' via the installment
  // form) but must not mutate an existing order's lifecycle status through PUT:
  // transitions go through the dedicated seller/admin/buy-own endpoints. For an
  // existing order the stored status wins; for a new order only 'new'/'alpha'
  // are accepted (any other body status is coerced to 'new').
  const existingStatus = userData.getOrderStatus(req.params.id);
  const createdStatus: OrderStatus = input.status === "alpha" ? "alpha" : "new";
  const order = userData.saveOrder({
    id: req.params.id,
    user_id: actor.userId,
    ...input,
    status: existingStatus ?? createdStatus,
  });
  res.json(order);
});

/** Soft-cancel: keep the order, set status='cancelled'. */
function cancelOrderHandler(req: express.Request, res: express.Response): void {
  const actor = requireCustomer(req, res);
  if (!actor) return;
  const orderId = String(req.params.id);
  const owner = userData.getOrderOwner(orderId);
  if (owner === null) return void res.status(404).json({ error: "order not found" });
  if (owner !== actor.userId) {
    return void res.status(403).json({ error: "forbidden" });
  }
  const ok = userData.cancelOrder(orderId);
  if (!ok) return void res.status(404).json({ error: "order not found" });
  res.status(204).end();
}

app.post("/api/orders/:id/cancel", cancelOrderHandler);

// Deprecated alias: DELETE now performs a soft-cancel (kept for client compatibility).
app.delete("/api/orders/:id", cancelOrderHandler);

// ---- Seller / admin: customer orders ----

/** Orders in which the seller has at least one line (or, for admin, all orders). */
function customerOrdersActor(
  req: express.Request,
  res: express.Response,
): { actor: { userId: string; role: UserRole }; sellerId: string } | null {
  const actor = actorRole(req);
  if (!actor) {
    res.status(403).json({ error: "unauthorized" });
    return null;
  }
  if (actor.role !== "admin" && actor.userId !== req.params.id) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return { actor, sellerId: String(req.params.id) };
}

/** Allowed whole-order status transitions performed by a seller.

(Canonical map lives in src/lib/orderStatus.ts, shared with the client so the UI
never offers a transition the server would reject.) */

app.get("/api/seller/:id/orders", (req, res) => {
  const ctx = customerOrdersActor(req, res);
  if (!ctx) return;
  res.json(userData.listOrdersForSeller(ctx.sellerId));
});

app.post("/api/seller/:id/orders/:orderId/status", (req, res) => {
  const ctx = customerOrdersActor(req, res);
  if (!ctx) return;
  const orderId = String(req.params.orderId);
  const status = (req.body as { status?: string })?.status as OrderStatus | undefined;
  if (!status) return res.status(400).json({ error: "status_required" });
  const current = userData.getOrderStatus(orderId);
  if (current === null) return res.status(404).json({ error: "order not found" });
  const isAdmin = ctx.actor.role === "admin";
  if (!isAdmin && !userData.orderHasSeller(orderId, ctx.sellerId)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const allowed = SELLER_ORDER_TRANSITIONS[current] ?? [];
  if (!allowed.includes(status)) {
    return res.status(409).json({ error: "invalid_transition" });
  }
  userData.setOrderStatus(orderId, status);
  res.json(userData.listOrdersForSeller(ctx.sellerId).find((o) => o.id === orderId) ?? null);
});

// ---- Admin: installment (Alpha-Bank) requests ----

app.get("/api/admin/orders", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const status = (typeof req.query.status === "string" ? req.query.status : "alpha") as OrderStatus;
  res.json(userData.listOrdersByStatus(status));
});

function installmentDecision(
  req: express.Request,
  res: express.Response,
  next: OrderStatus,
): void {
  if (!requireAdmin(req, res)) return;
  const orderId = String(req.params.orderId);
  const current = userData.getOrderStatus(orderId);
  if (current === null) return void res.status(404).json({ error: "order not found" });
  if (current !== "alpha") {
    return void res.status(409).json({ error: "invalid_transition" });
  }
  userData.setOrderStatus(orderId, next);
  userData.setInstallmentDecision(orderId, next === "confirmed" ? "approved" : "rejected");
  res.json(userData.listOrdersByStatus(next).find((o) => o.id === orderId) ?? null);
}

app.post("/api/admin/orders/:orderId/approve-installment", (req, res) => {
  installmentDecision(req, res, "confirmed");
});

app.post("/api/admin/orders/:orderId/reject-installment", (req, res) => {
  installmentDecision(req, res, "alpha_rejected");
});

// ---- Customer: buy at own expense after an installment rejection ----

app.post("/api/orders/:id/buy-own", (req, res) => {
  const actor = requireCustomer(req, res);
  if (!actor) return;
  const orderId = String(req.params.id);
  const owner = userData.getOrderOwner(orderId);
  if (owner === null) return void res.status(404).json({ error: "order not found" });
  if (owner !== actor.userId) return void res.status(403).json({ error: "forbidden" });
  const current = userData.getOrderStatus(orderId);
  if (current !== "alpha_rejected") {
    return void res.status(409).json({ error: "invalid_transition" });
  }
  userData.setOrderStatus(orderId, "confirmed");
  userData.setOrderPaymentMethod(orderId, "full");
  res.json(userData.listOrders(actor.userId).find((o) => o.id === orderId) ?? null);
});

// ---- Sales analytics (seller + admin) ----

type AnalyticsPeriod = "7d" | "30d" | "90d" | "all";

const PERIOD_DAYS: Record<Exclude<AnalyticsPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Resolve a period preset into an ISO `{ from, to }` range (UTC, `to = now`). */
function periodRange(period: AnalyticsPeriod): { from: string | null; to: string } {
  const to = new Date().toISOString();
  if (period === "all") return { from: null, to };
  const days = PERIOD_DAYS[period];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

function parsePeriod(raw: unknown): AnalyticsPeriod {
  return raw === "7d" || raw === "90d" || raw === "all" ? raw : "30d";
}

/** Build the API-facing sales-analytics DTO (rubles, klepecks -> /100). */
function buildSalesAnalyticsDto(
  preset: AnalyticsPeriod,
  sellerId: string | null,
  includeInstallment: boolean,
) {
  const range = periodRange(preset);
  const scope: SalesAnalyticsScope = { sellerId, from: range.from, to: range.to };
  const kpi = salesAnalytics.kpi(scope);
  const inst = includeInstallment ? salesAnalytics.installment(scope) : null;
  const dto: Record<string, unknown> = {
    period: { preset, from: range.from, to: range.to },
    sellerId,
    kpi: {
      revenue: kpi.revenueKopecks / 100,
      orders: kpi.orders,
      units: kpi.units,
      avgOrder: kpi.avgOrderKopecks / 100,
      cancelledOrders: kpi.cancelledOrders,
      cancelledRate: kpi.cancelledRate,
    },
    revenueByDay: salesAnalytics.revenueByDay(scope).map((r) => ({
      date: r.date,
      revenue: r.revenueKopecks / 100,
      orders: r.orders,
    })),
    funnel: salesAnalytics.funnel(scope).map((r) => ({
      status: r.status,
      orders: r.orders,
      revenue: r.revenueKopecks / 100,
    })),
    topBuilds: salesAnalytics.topBuilds(scope, 10).map((r) => ({
      kind: r.kind,
      refId: r.refId,
      name: r.name,
      units: r.units,
      revenue: r.revenueKopecks / 100,
    })),
    topParts: salesAnalytics.topParts(scope, 10).map((r) => ({
      refId: r.refId,
      name: r.name,
      category: r.category,
      units: r.units,
      revenue: r.revenueKopecks / 100,
    })),
    orderValueBuckets: salesAnalytics.orderValueBuckets(scope),
    catalogCoverage: salesAnalytics.catalogCoverage(scope),
  };
  if (inst) {
    dto.installment = {
      approved: inst.approved,
      rejected: inst.rejected,
      pending: inst.pending,
      withInstallment: inst.withInstallment,
      withoutInstallment: inst.withoutInstallment,
      installmentShare: inst.installmentShare,
      avgInstallmentOrder: inst.avgInstallmentOrderKopecks / 100,
      avgFullOrder: inst.avgFullOrderKopecks / 100,
    };
  }
  return dto;
}

app.get("/api/seller/:id/analytics", (req, res) => {
  const ctx = customerOrdersActor(req, res);
  if (!ctx) return;
  const preset = parsePeriod(req.query.period);
  res.json(buildSalesAnalyticsDto(preset, ctx.sellerId, false));
});

app.get("/api/admin/analytics", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const preset = parsePeriod(req.query.period);
  res.json(buildSalesAnalyticsDto(preset, null, true));
});

// ---- Reviews ----
app.get("/api/reviews", (req, res) => {
  if (typeof req.query.entityId === "string") {
    return res.json(userData.listReviewsFor(req.query.entityId));
  }
  res.json(userData.listReviews());
});

app.put("/api/reviews/:id", (req, res) => {
  if (!requireCustomer(req, res)) return;
  const input = req.body as Omit<SaveReviewInput, "id">;
  const review = userData.saveReview({ id: req.params.id, ...input });
  res.json(review);
});

// ---- Settings ----
app.get("/api/settings", (req, res) => {
  res.json(userData.getSettings(actorId(req)));
});

app.patch("/api/settings", (req, res) => {
  const body = req.body as { theme?: "light" | "dark"; notifications?: boolean };
  const s = userData.setSettings(actorId(req), {
    theme: body.theme,
    notifications: body.notifications,
  });
  res.json(s);
});

// ---- Onboarding ----
app.get("/api/onboarding", (_req, res) => {
  res.json({ onboarded: appState.isOnboarded() });
});

app.post("/api/onboarding", (req, res) => {
  const body = req.body as { onboarded?: boolean };
  appState.setOnboarded(body.onboarded !== false);
  res.json({ onboarded: appState.isOnboarded() });
});

// ---- Auth (mock phone/SMS) ----
app.post("/api/auth/request-code", (req, res) => {
  const body = req.body as { phone?: string };
  const phone = String(body.phone ?? "");
  if (!phone) return res.status(400).json({ error: "phone required" });
  const code = String(Math.floor(1000 + Math.random() * 9000));
  appState.setPendingAuth({
    phone,
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  res.json({ ok: true, demoCode: code, expiresIn: 5 * 60 });
});

app.post("/api/auth/verify", (req, res) => {
  const body = req.body as { phone?: string; code?: string };
  const phone = String(body.phone ?? "");
  const code = String(body.code ?? "");
  const pending = appState.getPendingAuth(phone);
  if (!pending || Date.now() > pending.expiresAt) {
    return res.status(400).json({ error: "code_expired" });
  }
  if (pending.code !== code) {
    return res.status(400).json({ error: "code_wrong" });
  }
  appState.clearPendingAuth(phone);
  res.json({ ok: true });
});

// ---- Health ----
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: "sqlite", analyticsEvents: analytics.count() });
});

// ---- Analytics ----
// Ingests anonymized client events. Client is responsible for redaction,
// batching and offline queueing; server applies a light size guard.
app.post("/api/analytics", (req, res) => {
  const body = req.body as { events?: AnalyticsEvent[] };
  const events = Array.isArray(body?.events) ? body.events : [];
  if (events.length === 0) return res.json({ ok: true, stored: 0 });
  const maxPayloadBytes = 64 * 1024;
  const clean = events.map((e) => ({
    ...e,
    payload:
      e.payload && JSON.stringify(e.payload).length <= maxPayloadBytes
        ? e.payload
        : { truncated: true } as Record<string, unknown>,
  }));
  const stored = analytics.append(clean);
  res.json({ ok: true, stored });
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[confi] SQLite API on http://localhost:${PORT}`);
});