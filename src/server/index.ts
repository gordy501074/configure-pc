// Confi SQLite backend API (Express + better-sqlite3).
//
// This is the single server-side data store. The SPA client talks to these
// endpoints (via the Vite /api proxy) for the catalog, user data and auth.

import express from "express";
import cors from "cors";
import { createCatalogRepository, type CreatePartInput } from "./repository/catalog.ts";
import { createUserRepository } from "./repository/user-data.ts";
import { createSellerRepository } from "./repository/seller.ts";
import { createVendorRepository } from "./repository/vendor.ts";
import { createAppStateRepository } from "./repository/app-state.ts";
import { createAnalyticsRepository, type AnalyticsEvent } from "./repository/analytics.ts";
import { openDb } from "./db.ts";
import type { SaveConfigInput, SaveOrderInput, SaveReviewInput } from "./repository/user-data.ts";
import type { ComponentCategory, PartCompat, SpecItem, UserRole } from "./repository/types.ts";
import { components } from "../data/mock.ts";

const app = express();
app.use(cors());
app.use(express.json());

const db = openDb();
const catalog = createCatalogRepository(db);
const userData = createUserRepository(db);
const sellerRepo = createSellerRepository(db);
const vendorRepo = createVendorRepository(db);
const appState = createAppStateRepository(db);
const analytics = createAnalyticsRepository(db);

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

// ---- Catalog ----
app.get("/api/parts", (req, res) => {
  const category =
    typeof req.query.category === "string" ? req.query.category : undefined;
  res.json(
    category
      ? catalog.listParts(category as never)
      : catalog.listParts(),
  );
});

app.get("/api/parts/:id", (req, res) => {
  const part = catalog.getPart(req.params.id);
  if (!part) return res.status(404).json({ error: "part not found" });
  res.json(part);
});

app.get("/api/ready", (_req, res) => {
  res.json(catalog.listReadyPcs());
});

app.get("/api/ready/:id", (req, res) => {
  const pc = catalog.getReadyPc(req.params.id);
  if (!pc) return res.status(404).json({ error: "ready pc not found" });
  res.json(pc);
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

app.delete("/api/users/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const ok = userData.deleteUser(req.params.id);
  if (!ok) return res.status(404).json({ error: "user not found" });
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
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) return "invalid_price";
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
    priceKopecks: Math.round(Number(body.price) * 100),
    tdpWatt: Math.round(Number(body.tdp ?? 0)),
    compat,
    specs,
    imageUrl: typeof body.image === "string" ? body.image : null,
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
    priceKopecks?: number;
    tdpWatt?: number;
    compat?: PartCompat;
    specs?: SpecItem[];
    imageUrl?: string | null;
  } = {};
  const brand = typeof body.brand === "string" ? body.brand.trim() : undefined;
  if (brand !== undefined) patch.brand = brand;
  if (vendorId !== undefined) patch.vendorId = vendorId;
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "invalid_price" });
    }
    patch.priceKopecks = Math.round(price * 100);
  }
  if (body.tdp !== undefined) {
    const tdp = Number(body.tdp);
    if (!Number.isFinite(tdp) || tdp < 0 || tdp > 65355) {
      return res.status(400).json({ error: "invalid_tdp" });
    }
    patch.tdpWatt = Math.round(tdp);
  }
  if (body.compat !== undefined) patch.compat = body.compat as PartCompat;
  if (body.specs !== undefined) patch.specs = body.specs as SpecItem[];

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

  const updated = catalog.updatePart(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "part not found" });
  res.json(updated);
});

app.post("/api/components/:id/deactivate", (req, res) => {
  if (!requireSellerOrAdmin(req, res)) return;
  const ok = catalog.deactivatePart(req.params.id);
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
        priceKopecks: Math.round(p.price * 100),
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

app.put("/api/orders/:id", (req, res) => {
  const actor = requireCustomer(req, res);
  if (!actor) return;
  const input = req.body as Omit<SaveOrderInput, "user_id" | "id">;
  const order = userData.saveOrder({
    id: req.params.id,
    user_id: actor.userId,
    ...input,
  });
  res.json(order);
});

app.delete("/api/orders/:id", (req, res) => {
  if (!requireCustomer(req, res)) return;
  const ok = userData.deleteOrder(req.params.id);
  if (!ok) return res.status(404).json({ error: "order not found" });
  res.status(204).end();
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