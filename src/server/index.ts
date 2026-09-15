// Confi SQLite backend API (Express + better-sqlite3).
//
// Feature flag: DB_USE=sqlite selects this SQLite server backend. The client
// still ships a localStorage fallback (DB_USE unset) so the SPA remains
// usable standalone. This module exposes the catalog and user-data endpoints.

import express from "express";
import cors from "cors";
import { createCatalogRepository } from "./repository/catalog.ts";
import { createUserRepository } from "./repository/user-data.ts";
import { openDb } from "./db.ts";
import type { SaveConfigInput, SaveOrderInput, SaveReviewInput } from "./repository/user-data.ts";

const app = express();
app.use(cors());
app.use(express.json());

const db = openDb();
const catalog = createCatalogRepository(db);
const userData = createUserRepository(db);

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
    id: body.id ?? "usr-localstorage-import",
    name: body.name ?? "Гость",
    email: body.email,
    phone: body.phone,
    role: body.role ?? "customer",
    createdAt: body.createdAt,
  });
  res.json(user);
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

// ---- Health ----
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: "sqlite" });
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[confi] SQLite API on http://localhost:${PORT}`);
});