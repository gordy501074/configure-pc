// Confi SQLite backend API (Express + better-sqlite3).
//
// This is the single server-side data store. The SPA client talks to these
// endpoints (via the Vite /api proxy) for the catalog, user data and auth.

import express from "express";
import cors from "cors";
import { createCatalogRepository } from "./repository/catalog.ts";
import { createUserRepository } from "./repository/user-data.ts";
import { createAppStateRepository } from "./repository/app-state.ts";
import { createAnalyticsRepository, type AnalyticsEvent } from "./repository/analytics.ts";
import { openDb } from "./db.ts";
import type { SaveConfigInput, SaveOrderInput, SaveReviewInput } from "./repository/user-data.ts";

const app = express();
app.use(cors());
app.use(express.json());

const db = openDb();
const catalog = createCatalogRepository(db);
const userData = createUserRepository(db);
const appState = createAppStateRepository(db);
const analytics = createAnalyticsRepository(db);

/** Resolve the acting user id: explicit body/query user or surrogate session. */
function actorId(req: express.Request): string {
  const fromBody = (req.body as { userId?: string } | undefined)?.userId;
  const fromQuery =
    typeof req.query.userId === "string" ? req.query.userId : undefined;
  return (fromBody ?? fromQuery ?? "usr-localstorage-import") as string;
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
    role?: "customer" | "guest";
    createdAt?: number;
  };
  const user = userData.upsertUser({
    id: body.id,
    name: body.name ?? "Гость",
    email: body.email,
    phone: body.phone,
    role: body.role ?? "customer",
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
  const input = req.body as Omit<SaveConfigInput, "user_id" | "id">;
  const cfg = userData.saveConfig({
    id: req.params.id,
    user_id: actorId(req),
    ...input,
  });
  res.json(cfg);
});

app.delete("/api/configs/:id", (req, res) => {
  const ok = userData.deleteConfig(req.params.id);
  if (!ok) return res.status(404).json({ error: "config not found" });
  res.status(204).end();
});

// ---- Orders ----
app.get("/api/orders", (req, res) => {
  res.json(userData.listOrders(actorId(req)));
});

app.put("/api/orders/:id", (req, res) => {
  const input = req.body as Omit<SaveOrderInput, "user_id" | "id">;
  const order = userData.saveOrder({
    id: req.params.id,
    user_id: actorId(req),
    ...input,
  });
  res.json(order);
});

app.delete("/api/orders/:id", (req, res) => {
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