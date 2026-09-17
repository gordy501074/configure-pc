// User-data DAO: sessions/users, configs (with parts), orders, reviews, settings.

import type { Database } from "better-sqlite3";
import type {
  AppSettingsDto,
  ConfigDto,
  ConfigPartDto,
  ConfigRow,
  ConfigSource,
  OrderDto,
  OrderItemDto,
  OrderItemRow,
  OrderRow,
  OrderStatus,
  PartRow,
  ReadyPcRow,
  ReviewDto,
  ReviewRow,
  Usage,
  UserDto,
  UserRow,
  UserRole,
} from "./types.ts";
import { configToDto, orderToDto, partToDto, reviewToDto, userToDto } from "./types.ts";

export interface SaveConfigInput {
  id: string;
  user_id: string;
  name: string;
  source: ConfigSource;
  usage?: Usage;
  parts: { category: string; part_id: string }[];
}

export interface SaveOrderInput {
  id: string;
  user_id: string;
  status: OrderStatus;
  address: string;
  userName: string;
  items: OrderItemDto[];
}

export interface SaveReviewInput {
  id: string;
  entityId: string;
  author: string;
  rating: number;
  text: string;
}

/** Self-service profile edit (client/seller). Role always preserved. */
export interface UpdateProfileInput {
  name?: string;
  company?: string;
}

export interface CreateUserInput {
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  company?: string;
}

export interface UserDataRepository {
  // users / session
  getUser(id: string): UserDto | null;
  upsertUser(user: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    role?: UserRole;
    createdAt?: number;
  }): UserDto;
  listUsers(): UserDto[];
  createUser(input: CreateUserInput): UserDto;
  deleteUser(id: string): boolean;
  setUserRole(id: string, role: UserRole): UserDto | null;
  updateProfile(userId: string, patch: UpdateProfileInput): UserDto | null;

  // configs
  listConfigs(userId: string): ConfigDto[];
  getConfig(id: string): ConfigDto | null;
  saveConfig(input: SaveConfigInput): ConfigDto;
  deleteConfig(id: string): boolean;

  // orders
  listOrders(userId: string): OrderDto[];
  saveOrder(input: SaveOrderInput): OrderDto;
  deleteOrder(id: string): boolean;

  // reviews
  listReviews(): ReviewDto[];
  listReviewsFor(entityId: string): ReviewDto[];
  saveReview(input: SaveReviewInput): ReviewDto;

  // settings
  getSettings(userId: string): AppSettingsDto;
  setSettings(userId: string, patch: Partial<AppSettingsDto>): AppSettingsDto;
}

export function createUserRepository(db: Database): UserDataRepository {
  // --- users ---
  const getUserStmt = db.prepare(
    `SELECT * FROM user_account WHERE user_id = ?`,
  );
  const getUserByEmailStmt = db.prepare(
    `SELECT * FROM user_account WHERE email = ?`,
  );
  const getUserByPhoneStmt = db.prepare(
    `SELECT * FROM user_account WHERE phone = ?`,
  );
  const listUsersStmt = db.prepare(
    `SELECT * FROM user_account ORDER BY created_at ASC, user_id ASC`,
  );
  const upsertUserStmt = db.prepare(
    `INSERT INTO user_account (user_id, name, email, phone, role, company, created_at)
     VALUES (@id, @name, @email, @phone, @role, @company, @created_at)
     ON CONFLICT(user_id) DO UPDATE SET
       name=excluded.name, email=excluded.email, phone=excluded.phone,
       role=excluded.role, company=excluded.company`,
  );
  const updateUserContactsStmt = db.prepare(`
    UPDATE user_account SET name=?, email=?, phone=? WHERE user_id=?
  `);
  const updateProfileNameStmt = db.prepare(`
    UPDATE user_account SET name=? WHERE user_id=?
  `);
  const updateProfileCompanyStmt = db.prepare(`
    UPDATE user_account SET company=? WHERE user_id=?
  `);
  const deleteUserStmt = db.prepare(`DELETE FROM user_account WHERE user_id = ?`);
  const setUserRoleStmt = db.prepare(`
    UPDATE user_account SET role=?, phone=? WHERE user_id=?
  `);

  // --- configs ---
  const listConfigsStmt = db.prepare(
    `SELECT * FROM config WHERE user_id = ? ORDER BY updated_at DESC`,
  );
  const getConfigStmt = db.prepare(`SELECT * FROM config WHERE config_id = ?`);
  const upsertConfigStmt = db.prepare(
    `INSERT INTO config (config_id, user_id, name, source, usage, created_at, updated_at)
     VALUES (@id, @user_id, @name, @source, @usage,
             @created_at, @updated_at)
     ON CONFLICT(config_id) DO UPDATE SET
       user_id=excluded.user_id, name=excluded.name, source=excluded.source,
       usage=excluded.usage, updated_at=excluded.updated_at`,
  );
  const delConfigStmt = db.prepare(`DELETE FROM config WHERE config_id = ?`);
  const configPartIdsStmt = db.prepare(
    `SELECT part_id, category FROM config_part WHERE config_id = ? ORDER BY category`,
  );
  const insertConfigPartStmt = db.prepare(
    `INSERT INTO config_part (config_id, category, part_id) VALUES (?, ?, ?)
     ON CONFLICT(config_id, category) DO UPDATE SET part_id=excluded.part_id`,
  );
  const delConfigPartsStmt = db.prepare(
    `DELETE FROM config_part WHERE config_id = ?`,
  );

  // --- orders ---
  const listOrdersStmt = db.prepare(
    `SELECT * FROM order_header WHERE user_id = ? ORDER BY created_at DESC`,
  );
  const getOrderStmt = db.prepare(
    `SELECT * FROM order_header WHERE order_id = ?`,
  );
  const upsertOrderStmt = db.prepare(
    `INSERT INTO order_header (order_id, user_id, total_kopecks, status, address, user_name, created_at)
     VALUES (@id, @user_id, @total_kopecks, @status, @address, @user_name, @created_at)
     ON CONFLICT(order_id) DO UPDATE SET
       user_id=excluded.user_id, total_kopecks=excluded.total_kopecks, status=excluded.status,
       address=excluded.address, user_name=excluded.user_name`,
  );
  const delOrderStmt = db.prepare(`DELETE FROM order_header WHERE order_id = ?`);
  const orderItemsStmt = db.prepare(
    `SELECT * FROM order_item WHERE order_id = ? ORDER BY position`,
  );
  const insertOrderItemStmt = db.prepare(
    `INSERT INTO order_item (order_id, position, kind, ref_id, name, price_kopecks, count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const delOrderItemsStmt = db.prepare(
    `DELETE FROM order_item WHERE order_id = ?`,
  );

  // --- reviews ---
  const listReviewsStmt = db.prepare(`SELECT * FROM review ORDER BY created_at DESC`);
  const listReviewsForStmt = db.prepare(
    `SELECT * FROM review
     WHERE (ready_pc_id = ?1 ) OR (entity_slug = ?1)
     ORDER BY created_at DESC`,
  );
  const listReviewsByReadyStmt = db.prepare(
    `SELECT * FROM review WHERE ready_pc_id = ? ORDER BY created_at DESC`,
  );
  const listReviewsBySlugStmt = db.prepare(
    `SELECT * FROM review WHERE entity_slug = ? ORDER BY created_at DESC`,
  );
  const upsertReviewStmt = db.prepare(
    `INSERT INTO review (review_id, ready_pc_id, entity_slug, author, rating, body, created_at)
     VALUES (@id, @ready_pc_id, @entity_slug, @author, @rating, @body, @created_at)
     ON CONFLICT(review_id) DO UPDATE SET
       ready_pc_id=excluded.ready_pc_id, entity_slug=excluded.entity_slug,
       author=excluded.author, rating=excluded.rating, body=excluded.body`,
  );

  // --- settings ---
  const getSettingStmt = db.prepare(
    `SELECT setting_value FROM app_setting WHERE setting_id = ?`,
  );
  const upsertSettingStmt = db.prepare(
    `INSERT INTO app_setting (setting_id, user_id, setting_key, setting_value)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, setting_key) DO UPDATE SET
       setting_id=excluded.setting_id,
       setting_value=excluded.setting_value,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
  const ensureUserStmt = db.prepare(
    `INSERT OR IGNORE INTO user_account (user_id, name, role) VALUES (?, ?, 'customer')`,
  );

  const now = (): string => new Date().toISOString();

  function configPartsFor(configId: string): ConfigPartDto[] {
    const links = configPartIdsStmt.all(configId) as {
      part_id: string | null;
      category: string;
    }[];
    const resolved = links
      .map((l) =>
        l.part_id
          ? (db.prepare(`SELECT * FROM part WHERE part_id = ?`).get(l.part_id) as
              | PartRow
              | undefined)
          : undefined,
      )
      .filter((r): r is PartRow => !!r);
    const byId = new Map(resolved.map((r) => [r.part_id, partToDto(r)]));
    return links.map((l) => {
      const category = l.category as ConfigPartDto["category"];
      if (!l.part_id) {
        return { category, part: null, unavailableReason: "missing" };
      }
      const part = byId.get(l.part_id);
      if (!part || !part.available) {
        return { category, part: null, unavailableReason: "deactivated" };
      }
      return { category, part };
    });
  }

  return {
    getUser(id) {
      const row = getUserStmt.get(id) as UserRow | undefined;
      return row ? userToDto(row) : null;
    },

    upsertUser(input) {
      // Resolve existing account by id / email / phone. If found, reuse its
      // user_id AND existing role (requested role ignored). This makes email
      // login stable for admin/seller and keeps customer data on re-login.
      const nowIso = now();
      let row: UserRow | undefined;

      if (input.id) {
        row = getUserStmt.get(input.id) as UserRow | undefined;
      }
      if (!row && input.email) {
        row = getUserByEmailStmt.get(input.email) as UserRow | undefined;
      }
      if (!row && input.phone) {
        row = getUserByPhoneStmt.get(input.phone) as UserRow | undefined;
      }

      if (row) {
        // Reuse the existing account: update name + contacts, keep role/company.
        updateUserContactsStmt.run(
          input.name ?? row.name,
          input.email ?? row.email,
          input.phone ?? row.phone,
          row.user_id,
        );
        return userToDto(getUserStmt.get(row.user_id) as UserRow);
      }

      // New account -> always a customer (demo policy).
      const id =
        input.id ?? `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const created_at = input.createdAt ? new Date(input.createdAt).toISOString() : nowIso;
      upsertUserStmt.run({
        id,
        name: input.name ?? "Клиент",
        email: input.email ?? null,
        phone: input.phone ?? null,
        role: "customer",
        company: null,
        created_at,
      });
      return userToDto(getUserStmt.get(id) as UserRow);
    },

    listUsers() {
      const rows = listUsersStmt.all() as UserRow[];
      return rows.map(userToDto);
    },

    createUser(input) {
      if (input.email) {
        const existing = getUserByEmailStmt.get(input.email) as UserRow | undefined;
        if (existing) throw new Error("email_exists");
      }
      const id = `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const phone =
        input.role === "seller" || input.role === "admin" ? null : (input.phone ?? null);
      upsertUserStmt.run({
        id,
        name: input.name,
        email: input.email ?? null,
        phone,
        role: input.role,
        company: input.role === "seller" ? (input.company ?? null) : null,
        created_at: now(),
      });
      return userToDto(getUserStmt.get(id) as UserRow);
    },

    deleteUser(id) {
      const info = deleteUserStmt.run(id);
      return info.changes > 0;
    },

    setUserRole(id, role) {
      const row = getUserStmt.get(id) as UserRow | undefined;
      if (!row) return null;
      // Policy: only customers carry a phone, so switching roles clears it.
      // `company` only applies to sellers; admins/customers get NULL.
      const company = role === "seller" ? row.company : null;
      setUserRoleStmt.run(role, null, id);
      db.prepare(`UPDATE user_account SET company=? WHERE user_id=?`).run(company, id);
      return userToDto(getUserStmt.get(id) as UserRow);
    },

    updateProfile(userId, patch) {
      const row = getUserStmt.get(userId) as UserRow | undefined;
      if (!row) return null;
      if (typeof patch.name === "string" && patch.name.trim()) {
        updateProfileNameStmt.run(patch.name.trim(), userId);
      }
      // Only sellers may set "company".
      if (row.role === "seller" && patch.company !== undefined) {
        updateProfileCompanyStmt.run(patch.company?.trim() || null, userId);
      }
      return userToDto(getUserStmt.get(userId) as UserRow);
    },

    listConfigs(userId) {
      const rows = listConfigsStmt.all(userId) as ConfigRow[];
      return rows.map((r) => configToDto(r, configPartsFor(r.config_id)));
    },

    getConfig(id) {
      const row = getConfigStmt.get(id) as ConfigRow | undefined;
      return row ? configToDto(row, configPartsFor(id)) : null;
    },

    saveConfig(input) {
      const created_at = now();
      upsertConfigStmt.run({
        id: input.id,
        user_id: input.user_id,
        name: input.name,
        source: input.source,
        usage: input.usage ?? null,
        created_at,
        updated_at: created_at,
      });
      const del = db.transaction(() => {
        delConfigPartsStmt.run(input.id);
        for (const p of input.parts) {
          insertConfigPartStmt.run(input.id, p.category, p.part_id);
        }
      });
      del();
      return this.getConfig(input.id)!;
    },

    deleteConfig(id) {
      const info = delConfigStmt.run(id);
      return info.changes > 0;
    },

    listOrders(userId) {
      const rows = listOrdersStmt.all(userId) as OrderRow[];
      return rows.map((r) => {
        const items = (orderItemsStmt.all(r.order_id) as OrderItemRow[]).map(
          (i): OrderItemDto => ({
            kind: i.kind,
            refId: i.ref_id,
            name: i.name,
            price: i.price_kopecks / 100,
            count: i.count,
          }),
        );
        return orderToDto(r, items);
      });
    },

    saveOrder(input) {
      const total = input.items.reduce(
        (s, it) => s + Math.round(it.price * 100) * it.count,
        0,
      );
      const existing = getOrderStmt.get(input.id) as OrderRow | undefined;
      const transaction = db.transaction(() => {
        upsertOrderStmt.run({
          id: input.id,
          user_id: input.user_id,
          total_kopecks: total,
          status: input.status,
          address: input.address,
          user_name: input.userName,
          created_at: existing?.created_at ?? now(),
        });
        delOrderItemsStmt.run(input.id);
        input.items.forEach((it, pos) => {
          insertOrderItemStmt.run(
            input.id,
            pos,
            it.kind,
            it.refId,
            it.name,
            Math.round(it.price * 100),
            it.count,
          );
        });
      });
      transaction();
      const items = (orderItemsStmt.all(input.id) as OrderItemRow[]).map(
        (i): OrderItemDto => ({
          kind: i.kind,
          refId: i.ref_id,
          name: i.name,
          price: i.price_kopecks / 100,
          count: i.count,
        }),
      );
      return orderToDto(getOrderStmt.get(input.id) as OrderRow, items);
    },

    deleteOrder(id) {
      const info = delOrderStmt.run(id);
      return info.changes > 0;
    },

    listReviews() {
      const rows = listReviewsStmt.all() as ReviewRow[];
      return rows.map(reviewToDto);
    },

    listReviewsFor(entityId) {
      const ready = /^ready-/.test(entityId);
      const rows = (ready
        ? listReviewsByReadyStmt.all(entityId)
        : listReviewsBySlugStmt.all("custom-config")) as ReviewRow[];
      return rows.map(reviewToDto);
    },

    saveReview(input) {
      const readyPcId = /^ready-/.test(input.entityId) ? input.entityId : null;
      const entitySlug = readyPcId ? null : "custom-config";
      upsertReviewStmt.run({
        id: input.id,
        ready_pc_id: readyPcId,
        entity_slug: entitySlug,
        author: input.author,
        rating: input.rating,
        body: input.text,
        created_at: now(),
      });
      const row = db
        .prepare(`SELECT * FROM review WHERE review_id = ?`)
        .get(input.id) as ReviewRow;
      return reviewToDto(row);
    },

    getSettings(userId) {
      const theme = readSetting(userId, "theme", "light") as
        | "light"
        | "dark";
      const notifications = readSetting(userId, "notifications", "true") === "true";
      return { theme, notifications };
    },

    setSettings(userId, patch) {
      ensureUserStmt.run(userId, "Гость");
      const key = (s: "theme" | "notifications") => `user-${userId}:${s}`;
      if (patch.theme !== undefined) {
        upsertSettingStmt.run(key("theme"), userId, "theme", patch.theme);
      }
      if (patch.notifications !== undefined) {
        upsertSettingStmt.run(
          key("notifications"),
          userId,
          "notifications",
          patch.notifications ? "true" : "false",
        );
      }
      return this.getSettings(userId);
    },
  };

  // --- helpers ---
  function readSetting(userId: string, keyName: string, fallback: string): string {
    const id = `user-${userId}:${keyName}`;
    const row = getSettingStmt.get(id) as { setting_value: string } | undefined;
    return row?.setting_value ?? fallback;
  }
}