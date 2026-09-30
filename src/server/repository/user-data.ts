// User-data DAO: sessions/users, configs (with parts), orders, reviews, settings.

import type { Database } from "better-sqlite3";
import type {
  AppSettingsDto,
  ComponentCategory,
  ConfigDto,
  ConfigPartDto,
  ConfigRow,
  ConfigSource,
  InstallmentDecision,
  OrderDto,
  OrderItemDto,
  OrderItemRow,
  OrderRow,
  OrderStatus,
  PartRow,
  PaymentMethod,
  ReadyPcRow,
  ReviewDto,
  ReviewRow,
  UnavailableReason,
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
  seller_id?: string;
  ready_pc_id?: string;
  parts: { category: string; part_id: string; price?: number }[];
}

export interface SaveOrderInput {
  id: string;
  user_id: string;
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
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
  /** Owning user id of an order, or null when it does not exist. */
  getOrderOwner(id: string): string | null;
  /** Soft-cancel: set status='cancelled' (keeps the row). */
  cancelOrder(id: string): boolean;

  // orders (seller / admin)
  /** Orders containing at least one line owned by `sellerId`, with only that seller's lines. */
  listOrdersForSeller(sellerId: string): OrderDto[];
  /** All orders in a given status (admin, e.g. 'alpha' installment requests). */
  listOrdersByStatus(status: OrderStatus): OrderDto[];
  /** Whether the order contains at least one line attributed to the seller. */
  orderHasSeller(orderId: string, sellerId: string): boolean;
  /** Current status of an order, or null when it does not exist. */
  getOrderStatus(orderId: string): OrderStatus | null;
  /** Set the whole order's status; false when the order does not exist. */
  setOrderStatus(orderId: string, status: OrderStatus): boolean;
  /** Set the installment decision snapshot; false when the order does not exist. */
  setInstallmentDecision(orderId: string, decision: InstallmentDecision): boolean;
  /** Set the payment method; false when the order does not exist. */
  setOrderPaymentMethod(orderId: string, method: PaymentMethod): boolean;

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
    `INSERT INTO config (config_id, user_id, name, source, usage, seller_id, ready_pc_id, created_at, updated_at)
     VALUES (@id, @user_id, @name, @source, @usage, @seller_id, @ready_pc_id,
             @created_at, @updated_at)
     ON CONFLICT(config_id) DO UPDATE SET
       user_id=excluded.user_id, name=excluded.name, source=excluded.source,
       usage=excluded.usage, seller_id=excluded.seller_id,
       ready_pc_id=excluded.ready_pc_id,
       updated_at=excluded.updated_at`,
  );
  const delConfigStmt = db.prepare(`DELETE FROM config WHERE config_id = ?`);
  const configPartIdsStmt = db.prepare(
    `SELECT part_id, category, price_kopecks FROM config_part WHERE config_id = ? ORDER BY category`,
  );
  const insertConfigPartStmt = db.prepare(
    `INSERT INTO config_part (config_id, category, part_id, price_kopecks) VALUES (?, ?, ?, ?)
     ON CONFLICT(config_id, category) DO UPDATE SET part_id=excluded.part_id, price_kopecks=excluded.price_kopecks`,
  );
  const delConfigPartsStmt = db.prepare(
    `DELETE FROM config_part WHERE config_id = ?`,
  );

  // --- price lists (price resolution for configs) ---
  const activePriceListIdStmt = db.prepare(
    `SELECT price_list_id FROM price_list WHERE seller_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`,
  );
  const priceForStmt = db.prepare(
    `SELECT price_kopecks FROM price_list_item WHERE price_list_id = ? AND part_id = ?`,
  );

  // --- orders ---
  const listOrdersStmt = db.prepare(
    `SELECT * FROM order_header WHERE user_id = ? ORDER BY created_at DESC`,
  );
  const getOrderStmt = db.prepare(
    `SELECT * FROM order_header WHERE order_id = ?`,
  );
  const upsertOrderStmt = db.prepare(
    `INSERT INTO order_header (order_id, user_id, total_kopecks, status, payment_method, installment_decision, address, user_name, created_at)
     VALUES (@id, @user_id, @total_kopecks, @status, @payment_method, @installment_decision, @address, @user_name, @created_at)
     ON CONFLICT(order_id) DO UPDATE SET
       user_id=excluded.user_id, total_kopecks=excluded.total_kopecks, status=excluded.status,
       payment_method=excluded.payment_method, installment_decision=excluded.installment_decision,
       address=excluded.address, user_name=excluded.user_name`,
  );
  const cancelOrderStmt = db.prepare(
    `UPDATE order_header SET status = 'cancelled' WHERE order_id = ?`,
  );
  const readySellerStmt = db.prepare(
    `SELECT seller_id FROM ready_pc WHERE ready_pc_id = ?`,
  );
  const orderItemsStmt = db.prepare(
    `SELECT * FROM order_item WHERE order_id = ? ORDER BY position`,
  );
  const insertOrderItemStmt = db.prepare(
    `INSERT INTO order_item (order_id, position, kind, ref_id, name, price_kopecks, count, seller_id, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const delOrderItemsStmt = db.prepare(
    `DELETE FROM order_item WHERE order_id = ?`,
  );
  // Orders that contain at least one item attributed to the seller.
  const sellerOrdersStmt = db.prepare(
    `SELECT DISTINCT h.* FROM order_header h
     JOIN order_item i ON i.order_id = h.order_id
     WHERE i.seller_id = ?
     ORDER BY h.created_at DESC`,
  );
  const ordersByStatusStmt = db.prepare(
    `SELECT * FROM order_header WHERE status = ? ORDER BY created_at DESC`,
  );
  const orderHasSellerStmt = db.prepare(
    `SELECT 1 FROM order_item WHERE order_id = ? AND seller_id = ? LIMIT 1`,
  );
  const setOrderStatusStmt = db.prepare(
    `UPDATE order_header SET status = ? WHERE order_id = ?`,
  );
  const setInstallmentDecisionStmt = db.prepare(
    `UPDATE order_header SET installment_decision = ? WHERE order_id = ?`,
  );
  const setOrderPaymentMethodStmt = db.prepare(
    `UPDATE order_header SET payment_method = ? WHERE order_id = ?`,
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

  /** Map an order_item row to its API DTO, preserving attribution snapshots. */
  function orderItemToDto(i: OrderItemRow): OrderItemDto {
    return {
      kind: i.kind,
      refId: i.ref_id,
      name: i.name,
      price: i.price_kopecks / 100,
      count: i.count,
      sellerId: i.seller_id ?? undefined,
      category: (i.category as ComponentCategory | null) ?? undefined,
    };
  }

  /**
   * Load order_item rows for many orders in a single query (avoids N+1), grouped
   * by order_id and ordered by position within each order.
   */
  function orderItemsByOrderId(orderIds: string[]): Map<string, OrderItemRow[]> {
    const grouped = new Map<string, OrderItemRow[]>();
    if (orderIds.length === 0) return grouped;
    const placeholders = orderIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT * FROM order_item WHERE order_id IN (${placeholders}) ORDER BY order_id, position`,
      )
      .all(...orderIds) as OrderItemRow[];
    for (const row of rows) {
      const list = grouped.get(row.order_id);
      if (list) list.push(row);
      else grouped.set(row.order_id, [row]);
    }
    return grouped;
  }

  /** Map order rows to DTOs, loading all their items with a single query. */
  function orderRowsToDtos(rows: OrderRow[]): OrderDto[] {
    const itemsByOrder = orderItemsByOrderId(rows.map((r) => r.order_id));
    return rows.map((r) =>
      orderToDto(
        r,
        (itemsByOrder.get(r.order_id) ?? []).map(orderItemToDto),
      ),
    );
  }

  function configPartsFor(config: ConfigRow): ConfigPartDto[] {
    const configId = config.config_id;
    const source = config.source;
    const sellerId = config.seller_id ?? undefined;
    const links = configPartIdsStmt.all(configId) as {
      part_id: string | null;
      category: string;
      price_kopecks: number;
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

    // Current price comes from the config.seller_id active price list.
    const priceListId = sellerId
      ? (activePriceListIdStmt.get(sellerId) as { price_list_id: string } | undefined)
      : undefined;
    const currentPriceOf = (partId: string): number | undefined => {
      if (!priceListId) return undefined;
      const p = priceForStmt.get(priceListId.price_list_id, partId) as
        | { price_kopecks: number }
        | undefined;
      return p?.price_kopecks;
    };

    return links.map((l) => {
      const category = l.category as ConfigPartDto["category"];
      if (!l.part_id) {
        return { category, part: null, unavailableReason: "missing" };
      }
      const base = byId.get(l.part_id);
      if (!base || !base.available) {
        return {
          category,
          part: null,
          price: l.price_kopecks > 0 ? l.price_kopecks / 100 : undefined,
          currentPrice: currentPriceOf(l.part_id),
          unavailableReason: "deactivated",
        };
      }
      const current = currentPriceOf(l.part_id);
      const currentRub = current !== undefined ? current / 100 : undefined;

      if (source === "ready") {
        // Live re-pricing: the part carries its current price from the active list.
        const orderable = current !== undefined && current > 0;
        const livePart = { ...base, price: currentRub, priceSet: current !== undefined };
        return {
          category,
          part: orderable ? livePart : null,
          price: currentRub,
          currentPrice: currentRub,
          ...(orderable ? {} : { unavailableReason: "no_price" as UnavailableReason }),
        };
      }

      // custom/auto: snapshot price on the part, currentPrice for the -5% check.
      const snapshot = l.price_kopecks > 0 ? l.price_kopecks / 100 : undefined;
      const snapshotPart = { ...base, price: snapshot, priceSet: snapshot !== undefined };
      const orderable = current !== undefined && current > 0;
      return {
        category,
        part: orderable ? snapshotPart : null,
        price: snapshot,
        currentPrice: currentRub,
        ...(orderable ? {} : { unavailableReason: "no_price" as UnavailableReason }),
      };
    });
  }

  function configDtoFor(row: ConfigRow): ConfigDto {
    const parts = configPartsFor(row);
    // For ready configs also treat an archived (is_active=0) source build as invalid.
    let buildArchived = false;
    if (row.source === "ready" && row.ready_pc_id) {
      const rp = db
        .prepare(`SELECT is_active FROM ready_pc WHERE ready_pc_id = ?`)
        .get(row.ready_pc_id) as { is_active: number } | undefined;
      buildArchived = rp ? rp.is_active !== 1 : true;
    }
    const buildInvalid =
      row.source === "ready" &&
      (buildArchived ||
        parts.some((cp) => cp.part === null || cp.part?.available === false));
    return configToDto(row, parts, buildInvalid);
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
      return rows.map(configDtoFor);
    },

    getConfig(id) {
      const row = getConfigStmt.get(id) as ConfigRow | undefined;
      return row ? configDtoFor(row) : null;
    },

    saveConfig(input) {
      const created_at = now();
      upsertConfigStmt.run({
        id: input.id,
        user_id: input.user_id,
        name: input.name,
        source: input.source,
        usage: input.usage ?? null,
        seller_id: input.seller_id ?? "usr-seller",
        ready_pc_id: input.ready_pc_id ?? null,
        created_at,
        updated_at: created_at,
      });
      const del = db.transaction(() => {
        delConfigPartsStmt.run(input.id);
        for (const p of input.parts) {
          insertConfigPartStmt.run(
            input.id,
            p.category,
            p.part_id,
            p.price !== undefined ? Math.round(p.price * 100) : 0,
          );
        }
      });
      del();
      const row = getConfigStmt.get(input.id) as ConfigRow;
      return configDtoFor(row);
    },

    deleteConfig(id) {
      const info = delConfigStmt.run(id);
      return info.changes > 0;
    },

    listOrders(userId) {
      const rows = listOrdersStmt.all(userId) as OrderRow[];
      return orderRowsToDtos(rows);
    },

    saveOrder(input) {
      const total = input.items.reduce(
        (s, it) => s + Math.round(it.price * 100) * it.count,
        0,
      );
      const existing = getOrderStmt.get(input.id) as OrderRow | undefined;
      // Existing orders keep their stored payment fields (mirrors status handling);
      // new orders derive them from the input or the created status.
      const paymentMethod: PaymentMethod =
        existing?.payment_method ??
        input.paymentMethod ??
        (input.status === "alpha" ? "installment" : "full");
      const installmentDecision: InstallmentDecision | null = existing
        ? existing.installment_decision
        : input.status === "alpha"
          ? "pending"
          : null;
      const transaction = db.transaction(() => {
        upsertOrderStmt.run({
          id: input.id,
          user_id: input.user_id,
          total_kopecks: total,
          status: input.status,
          payment_method: paymentMethod,
          installment_decision: installmentDecision,
          address: input.address,
          user_name: input.userName,
          created_at: existing?.created_at ?? now(),
        });
        delOrderItemsStmt.run(input.id);
        input.items.forEach((it, pos) => {
          // Ready lines fall back to the build's owner when the client omitted it.
          let sellerId = it.sellerId ?? null;
          if (!sellerId && it.kind === "ready") {
            const resolved = readySellerStmt.get(it.refId) as
              | { seller_id: string | null }
              | undefined;
            sellerId = resolved?.seller_id ?? null;
          }
          insertOrderItemStmt.run(
            input.id,
            pos,
            it.kind,
            it.refId,
            it.name,
            Math.round(it.price * 100),
            it.count,
            sellerId,
            it.category ?? null,
          );
        });
      });
      transaction();
      const items = (orderItemsStmt.all(input.id) as OrderItemRow[]).map(
        orderItemToDto,
      );
      return orderToDto(getOrderStmt.get(input.id) as OrderRow, items);
    },

    getOrderOwner(id) {
      const row = getOrderStmt.get(id) as OrderRow | undefined;
      return row?.user_id ?? null;
    },

    cancelOrder(id) {
      const info = cancelOrderStmt.run(id);
      return info.changes > 0;
    },

    listOrdersForSeller(sellerId) {
      const rows = sellerOrdersStmt.all(sellerId) as OrderRow[];
      const itemsByOrder = orderItemsByOrderId(rows.map((r) => r.order_id));
      return rows.map((r) => {
        const items = (itemsByOrder.get(r.order_id) ?? [])
          .filter((i) => i.seller_id === sellerId)
          .map(orderItemToDto);
        const total = items.reduce((s, it) => s + it.price * it.count, 0);
        return { ...orderToDto(r, items), total };
      });
    },

    listOrdersByStatus(status) {
      const rows = ordersByStatusStmt.all(status) as OrderRow[];
      return orderRowsToDtos(rows);
    },

    orderHasSeller(orderId, sellerId) {
      return !!orderHasSellerStmt.get(orderId, sellerId);
    },

    getOrderStatus(orderId) {
      const row = getOrderStmt.get(orderId) as OrderRow | undefined;
      return row?.status ?? null;
    },

    setOrderStatus(orderId, status) {
      const info = setOrderStatusStmt.run(status, orderId);
      return info.changes > 0;
    },

    setInstallmentDecision(orderId, decision) {
      const info = setInstallmentDecisionStmt.run(decision, orderId);
      return info.changes > 0;
    },

    setOrderPaymentMethod(orderId, method) {
      const info = setOrderPaymentMethodStmt.run(method, orderId);
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