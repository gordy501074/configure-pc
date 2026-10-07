// Catalog DAO: parts and ready PCs (read-mostly + catalog management).

import type { Database } from "better-sqlite3";
import type {
  ComponentCategory,
  ConfigPartDto,
  PartCompat,
  PartDto,
  PartRow,
  ReadyPcDto,
  ReadyPcRow,
  SpecItem,
  Usage,
} from "./types.ts";
import { attachPrice, deriveBuildSpecs, isPartOrderable, partToDto, readyPcToBaseDto } from "./types.ts";

export interface CreatePartInput {
  id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  vendorId?: string | null;
  tdpWatt: number;
  compat: PartCompat;
  specs?: SpecItem[];
  imageUrl?: string | null;
  description?: string | null;
}

export interface UpdatePartInput {
  name?: string;
  brand?: string;
  vendorId?: string | null;
  tdpWatt?: number;
  compat?: PartCompat;
  specs?: SpecItem[];
  imageUrl?: string | null;
  description?: string | null;
}

export interface ReadyBuildPartRef {
  category: ComponentCategory;
  partId: string;
}

export interface CreateReadyBuildInput {
  name: string;
  brand: string;
  usage: Usage;
  tdp: number;
  price: number;
  summary: string;
  specs?: SpecItem[];
  imageUrl?: string | null;
  sellerId: string | null;
  parts: ReadyBuildPartRef[];
}

export interface UpdateReadyBuildInput {
  name?: string;
  brand?: string;
  usage?: Usage;
  tdp?: number;
  price?: number;
  summary?: string;
  specs?: SpecItem[];
  parts?: ReadyBuildPartRef[];
}

export interface CatalogRepository {
  /**
   * List parts. When `includeInactive` is true, deactivated (/unavailable)
   * parts are returned too (catalog management use).
   */
  listParts(category?: ComponentCategory, includeInactive?: boolean, sellerId?: string): PartDto[];
  getPart(id: string, sellerId?: string): PartDto | null;
  /** Fetch a part regardless of is_active/is_available (admin internal use). */
  getPartAny(id: string): PartDto | null;
  listReadyPcs(sellerId?: string): ReadyPcDto[];
  /** List ready PCs, optionally including archived (is_active=0) entries (seller profile). */
  listReadyPcsIncludeInactive(sellerId?: string): ReadyPcDto[];
  getReadyPc(id: string, sellerId?: string): ReadyPcDto | null;
  /** Fetch a ready PC regardless of is_active (seller/admin internal use). */
  getReadyPcAny(id: string, sellerId?: string): ReadyPcDto | null;
  /** Resolve prices from the given active price list into a part list. */
  attachPrices(parts: PartDto[], sellerId?: string): PartDto[];
  // Catalog management (seller/admin).
  createPart(input: CreatePartInput): PartDto;
  updatePart(id: string, patch: UpdatePartInput): PartDto | null;
  deactivatePart(id: string): boolean;
  /** Reactivate a deactivated part so it becomes orderable again. */
  reactivatePart(id: string): boolean;
  /** Full catalog replacement (admin); returns affected part ids so callers can report. */
  initializeCatalog(parts: CreatePartInput[]): { inserted: number; deleted: number };
  // Ready-build management (seller/admin).
  createReadyBuild(input: CreateReadyBuildInput): ReadyPcDto;
  updateReadyBuild(id: string, input: UpdateReadyBuildInput): ReadyPcDto | null;
  deactivateReadyPc(id: string): boolean;
  reactivateReadyPc(id: string): boolean;
  /** Case-insensitive uniqueness of a build's model among a seller's active builds. */
  readyModelExists(sellerId: string, brand: string, model: string, excludeId?: string): boolean;
}

/** Serialize a compat document into compat_json (versioned shape). */
function compatJson(compat: PartCompat): string {
  return JSON.stringify({ v: 2, ...compat });
}

function specsJson(specs?: SpecItem[]): string {
  return JSON.stringify(specs ?? []);
}

/** Recover the model suffix from a full build name and its brand: "Confi Gaming" -> "Gaming". */
function modelFromBuildName(name: string, brand: string): string {
  const n = String(name ?? "").trim();
  const b = String(brand ?? "").trim();
  if (!b) return n;
  if (n.toLowerCase().startsWith(b.toLowerCase())) {
    return n.slice(b.length).trim();
  }
  return n;
}

/** Resolve parts by ids preserving the given order (includes unavailable so callers can mark them). */
function partsByIds(db: Database, ids: Array<string | null>): PartDto[] {
  const realIds = ids.filter((id): id is string => !!id);
  if (realIds.length === 0) return [];
  const placeholders = realIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM part WHERE part_id IN (${placeholders})`)
    .all(...realIds) as PartRow[];
  const byId = new Map(rows.map((r) => [r.part_id, partToDto(r)]));
  return realIds.map((id) => byId.get(id)).filter((p): p is PartDto => !!p);
}

export function createCatalogRepository(db: Database): CatalogRepository {
  const listPartsStmt = db.prepare(
    `SELECT * FROM part WHERE is_active = 1 ORDER BY category, name`,
  );
  const listAllPartsStmt = db.prepare(
    `SELECT * FROM part WHERE is_active IN (0, 1) ORDER BY category, name`,
  );
  const listPartsByCatStmt = db.prepare(
    `SELECT * FROM part WHERE category = ? AND is_active = 1 ORDER BY name`,
  );
  const listAllPartsByCatStmt = db.prepare(
    `SELECT * FROM part WHERE category = ? AND is_active IN (0, 1) ORDER BY name`,
  );
  const getPartStmt = db.prepare(
    `SELECT * FROM part WHERE part_id = ? AND is_active = 1`,
  );
  const getPartAnyStmt = db.prepare(`SELECT * FROM part WHERE part_id = ?`);
  const listReadyStmt = db.prepare(
    `SELECT * FROM ready_pc WHERE is_active = 1 ORDER BY created_at`,
  );
  const listAllReadyStmt = db.prepare(
    `SELECT * FROM ready_pc WHERE is_active IN (0, 1) ORDER BY created_at`,
  );
  const getReadyStmt = db.prepare(
    `SELECT * FROM ready_pc WHERE ready_pc_id = ? AND is_active = 1`,
  );
  const getReadyAnyStmt = db.prepare(
    `SELECT * FROM ready_pc WHERE ready_pc_id = ?`,
  );
  const insertReadyStmt = db.prepare(
    `INSERT INTO ready_pc (ready_pc_id, name, brand, usage, price_kopecks, tdp_watt, summary, specs_json, image_url, in_stock, rating, is_active, seller_id)
     VALUES (@id, @name, @brand, @usage, @price_kopecks, @tdp_watt, @summary, @specs_json, @image_url, 1, 0, 1, @seller_id)`,
  );
  const updateReadyStmt = db.prepare(
    `UPDATE ready_pc SET name=?, brand=?, usage=?, price_kopecks=?, tdp_watt=?, summary=?, specs_json=?, image_url=? WHERE ready_pc_id=?`,
  );
  const deactivateReadyStmt = db.prepare(
    `UPDATE ready_pc SET is_active = 0 WHERE ready_pc_id = ?`,
  );
  const reactivateReadyStmt = db.prepare(
    `UPDATE ready_pc SET is_active = 1 WHERE ready_pc_id = ?`,
  );
  const readyModelRowsStmt = db.prepare(
    `SELECT name, brand FROM ready_pc WHERE seller_id = ? AND is_active = 1`,
  );
  const readyModelRowsExcludeStmt = db.prepare(
    `SELECT name, brand FROM ready_pc WHERE seller_id = ? AND is_active = 1 AND ready_pc_id <> ?`,
  );
  const insertReadyPartStmt = db.prepare(
    `INSERT INTO ready_pc_part (ready_pc_id, part_id, category) VALUES (?, ?, ?)
     ON CONFLICT(ready_pc_id, category) DO UPDATE SET part_id=excluded.part_id`,
  );
  const deleteReadyPartsStmt = db.prepare(
    `DELETE FROM ready_pc_part WHERE ready_pc_id = ?`,
  );
  const readyPartIdsStmt = db.prepare(
    `SELECT part_id, category FROM ready_pc_part WHERE ready_pc_id = ? ORDER BY category`,
  );
  const reviewCountStmt = db.prepare(
    `SELECT count(*) AS c FROM review WHERE ready_pc_id = ?`,
  );
  const activePriceListIdStmt = db.prepare(
    `SELECT price_list_id FROM price_list WHERE seller_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`,
  );
  const priceForStmt = db.prepare(
    `SELECT price_kopecks FROM price_list_item WHERE price_list_id = ? AND part_id = ?`,
  );

  function activePriceListId(sellerId?: string): string | null {
    if (!sellerId) return null;
    const row = activePriceListIdStmt.get(sellerId) as { price_list_id: string } | undefined;
    return row?.price_list_id ?? null;
  }

  function priceFor(priceListId: string | null, partId: string): number | null {
    if (!priceListId) return null;
    const row = priceForStmt.get(priceListId, partId) as { price_kopecks: number } | undefined;
    return row ? row.price_kopecks : null;
  }

  function attachPrices(parts: PartDto[], sellerId?: string): PartDto[] {
    const plId = activePriceListId(sellerId);
    return parts.map((p) => attachPrice(p, priceFor(plId, p.id)));
  }

  function insertReadyParts(readyPcId: string, parts: ReadyBuildPartRef[]): void {
    deleteReadyPartsStmt.run(readyPcId);
    for (const p of parts) {
      insertReadyPartStmt.run(readyPcId, p.partId, p.category);
    }
  }

  function readyPcWithParts(row: ReadyPcRow, sellerId?: string): ReadyPcDto | null {
    if (!row) return null;
    // Price/validate against the build's own seller's active list unless an
    // explicit seller was supplied for the query.
    const priceSeller = row.seller_id ?? sellerId;
    const links = readyPartIdsStmt.all(row.ready_pc_id) as {
      part_id: string | null;
      category: ComponentCategory;
    }[];
    const resolved = partsByIds(
      db,
      links.map((l) => l.part_id),
    ).map((p) => attachPrices([p], priceSeller)[0]);
    const byId = new Map(resolved.map((p) => [p.id, p]));
    const parts: ConfigPartDto[] = links.map((l) => {
      if (!l.part_id) return { category: l.category, part: null, unavailableReason: "missing" };
      const part = byId.get(l.part_id);
      if (!part || !part.available) {
        const priced = part && (part.priceSet === true);
        return {
          category: l.category,
          part: priced ? part : null,
          unavailableReason: !part ? "missing" : part.price !== undefined && part.price <= 0 ? "no_price" : "deactivated",
        };
      }
      return { category: l.category, part };
    });
    // A build is valid when all 8 mandatory categories resolve to an orderable part
    // against the seller's active price list.
    const valid =
      links.length === 8 &&
      parts.every((cp) => cp.part !== null && isPartOrderable(cp.part));
    // Ready PC price = sum of priced parts in its composition.
    const totalPrice = parts
      .filter((p) => p.part?.price !== undefined)
      .reduce((s, p) => s + (p.part!.price ?? 0), 0);
    const reviewCount = (reviewCountStmt.get(row.ready_pc_id) as { c: number }).c;
    const base = readyPcToBaseDto(row);
    // Fallback for builds persisted before specs were auto-generated: derive the
    // showcase rows (Процессор/Видеокарта/…) from the composition.
    const specs = base.specs.length > 0 ? base.specs : deriveBuildSpecs(parts);
    return {
      ...base,
      specs,
      price: totalPrice,
      reviewCount,
      valid,
      sellerId: row.seller_id ?? null,
      parts,
    };
  }

  return {
    listParts(category, includeInactive, sellerId) {
      const all = includeInactive === true;
      const rows = category
        ? (all ? listAllPartsByCatStmt : listPartsByCatStmt).all(category)
        : (all ? listAllPartsStmt : listPartsStmt).all();
      const parts = (rows as PartRow[]).map(partToDto);
      return includeInactive ? parts : attachPrices(parts, sellerId);
    },
    getPart(id, sellerId) {
      const row = getPartStmt.get(id) as PartRow | undefined;
      return row ? attachPrices([partToDto(row)], sellerId)[0] : null;
    },
    getPartAny(id) {
      const row = getPartAnyStmt.get(id) as PartRow | undefined;
      return row ? partToDto(row) : null;
    },
    attachPrices(parts, sellerId) {
      return attachPrices(parts, sellerId);
    },
    listReadyPcs(sellerId) {
      const rows = listReadyStmt.all() as ReadyPcRow[];
      return rows
        .filter((r) => !sellerId || r.seller_id === sellerId)
        .map((r) => readyPcWithParts(r, sellerId)!)
        .filter(Boolean);
    },
    listReadyPcsIncludeInactive(sellerId) {
      const rows = listAllReadyStmt.all() as ReadyPcRow[];
      return rows
        .filter((r) => !sellerId || r.seller_id === sellerId)
        .map((r) => readyPcWithParts(r, sellerId)!)
        .filter(Boolean);
    },
    getReadyPc(id, sellerId) {
      const row = getReadyStmt.get(id) as ReadyPcRow | undefined;
      return row && (sellerId === undefined || row.seller_id === sellerId)
        ? readyPcWithParts(row, sellerId)
        : null;
    },
    getReadyPcAny(id, sellerId) {
      const row = getReadyAnyStmt.get(id) as ReadyPcRow | undefined;
      return row && (sellerId === undefined || row.seller_id === sellerId)
        ? readyPcWithParts(row, sellerId)
        : null;
    },
    createPart(input) {
      db.prepare(
        `INSERT INTO part (part_id, category, name, brand, vendor_id, tdp_watt, compat_json, specs_json, image_url, description, is_active, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
         ON CONFLICT(part_id) DO UPDATE SET
           category=excluded.category, name=excluded.name, brand=excluded.brand,
           vendor_id=excluded.vendor_id,
           tdp_watt=excluded.tdp_watt, compat_json=excluded.compat_json,
           specs_json=excluded.specs_json, image_url=excluded.image_url,
           description=excluded.description,
           is_active=1, is_available=1`,
      ).run(
        input.id,
        input.category,
        input.name,
        input.brand,
        input.vendorId ?? null,
        input.tdpWatt,
        compatJson(input.compat),
        specsJson(input.specs),
        input.imageUrl ?? null,
        input.description ?? null,
      );
      return partToDto(getPartAnyStmt.get(input.id) as PartRow);
    },
    updatePart(id, patch) {
      const existing = getPartAnyStmt.get(id) as PartRow | undefined;
      if (!existing) return null;
      const next = {
        name: patch.name ?? existing.name,
        brand: patch.brand ?? existing.brand,
        vendor_id:
          patch.vendorId !== undefined ? patch.vendorId : existing.vendor_id,
        tdp_watt: patch.tdpWatt ?? existing.tdp_watt,
        compat_json: patch.compat ? compatJson(patch.compat) : existing.compat_json,
        specs_json: patch.specs ? specsJson(patch.specs) : existing.specs_json,
        image_url:
          patch.imageUrl !== undefined ? patch.imageUrl : existing.image_url,
        description:
          patch.description !== undefined ? patch.description : existing.description,
      };
      db.prepare(
        `UPDATE part SET name=?, brand=?, vendor_id=?, tdp_watt=?,
           compat_json=?, specs_json=?, image_url=?, description=?
         WHERE part_id=?`,
      ).run(
        next.name,
        next.brand,
        next.vendor_id,
        next.tdp_watt,
        next.compat_json,
        next.specs_json,
        next.image_url,
        next.description,
        id,
      );
      return partToDto(getPartAnyStmt.get(id) as PartRow);
    },
    deactivatePart(id) {
      const existing = getPartAnyStmt.get(id) as PartRow | undefined;
      if (!existing) return false;
      db.prepare(
        `UPDATE part SET is_active = 0, is_available = 0 WHERE part_id = ?`,
      ).run(id);
      return true;
    },
    reactivatePart(id) {
      const existing = getPartAnyStmt.get(id) as PartRow | undefined;
      if (!existing) return false;
      db.prepare(
        `UPDATE part SET is_active = 1, is_available = 1 WHERE part_id = ?`,
      ).run(id);
      return true;
    },
    initializeCatalog(parts) {
      const ids = new Set(parts.map((p) => p.id));
      let deleted = 0;
      const tx = db.transaction(() => {
        const existing = db
          .prepare(`SELECT part_id FROM part`)
          .all() as { part_id: string }[];
        for (const row of existing) {
          if (ids.has(row.part_id)) continue;
          deleted += db.prepare(`DELETE FROM part WHERE part_id = ?`).run(row.part_id).changes;
        }
        for (const p of parts) {
          this.createPart(p);
        }
      });
      tx();
      return { inserted: parts.length, deleted };
    },
    createReadyBuild(input) {
      const id = `ready-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const tx = db.transaction(() => {
        insertReadyStmt.run({
          id,
          name: input.name,
          brand: input.brand,
          usage: input.usage,
          price_kopecks: Math.round(input.price * 100),
          tdp_watt: Math.round(input.tdp),
          summary: input.summary,
          specs_json: specsJson(input.specs),
          image_url: input.imageUrl ?? null,
          seller_id: input.sellerId ?? null,
        });
        insertReadyParts(id, input.parts);
      });
      tx();
      return this.getReadyPcAny(id, input.sellerId ?? undefined)!;
    },
    updateReadyBuild(id, input) {
      const existing = getReadyAnyStmt.get(id) as ReadyPcRow | undefined;
      if (!existing) return null;
      const tx = db.transaction(() => {
        updateReadyStmt.run(
          input.name ?? existing.name,
          input.brand ?? existing.brand,
          input.usage ?? existing.usage,
          Math.round((input.price ?? existing.price_kopecks / 100) * 100),
          input.tdp !== undefined ? Math.round(input.tdp) : existing.tdp_watt,
          input.summary ?? existing.summary,
          input.specs ? specsJson(input.specs) : existing.specs_json,
          existing.image_url,
          id,
        );
        if (input.parts) insertReadyParts(id, input.parts);
      });
      tx();
      return this.getReadyPcAny(id, existing.seller_id ?? undefined)!;
    },
    deactivateReadyPc(id) {
      const existing = getReadyAnyStmt.get(id) as ReadyPcRow | undefined;
      if (!existing) return false;
      deactivateReadyStmt.run(id);
      return true;
    },
    reactivateReadyPc(id) {
      const existing = getReadyAnyStmt.get(id) as ReadyPcRow | undefined;
      if (!existing) return false;
      reactivateReadyStmt.run(id);
      return true;
    },
    readyModelExists(sellerId, brand, model, excludeId) {
      const stmt = excludeId ? readyModelRowsExcludeStmt : readyModelRowsStmt;
      const params = excludeId ? [sellerId, excludeId] : [sellerId];
      const rows = stmt.all(...params) as { name: string; brand: string }[];
      const target = model.trim().toLowerCase();
      return rows.some((r) => modelFromBuildName(r.name, r.brand).toLowerCase() === target);
    },
  };
}