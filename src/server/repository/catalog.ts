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
} from "./types.ts";
import { attachPrice, partToDto, readyPcToBaseDto } from "./types.ts";

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
}

export interface UpdatePartInput {
  name?: string;
  brand?: string;
  vendorId?: string | null;
  tdpWatt?: number;
  compat?: PartCompat;
  specs?: SpecItem[];
  imageUrl?: string | null;
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
  getReadyPc(id: string, sellerId?: string): ReadyPcDto | null;
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
}

/** Serialize a compat document into compat_json (versioned shape). */
function compatJson(compat: PartCompat): string {
  return JSON.stringify({ v: 2, ...compat });
}

function specsJson(specs?: SpecItem[]): string {
  return JSON.stringify(specs ?? []);
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
  const getReadyStmt = db.prepare(
    `SELECT * FROM ready_pc WHERE ready_pc_id = ? AND is_active = 1`,
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

  function readyPcWithParts(row: ReadyPcRow, sellerId?: string): ReadyPcDto | null {
    if (!row) return null;
    const links = readyPartIdsStmt.all(row.ready_pc_id) as {
      part_id: string | null;
      category: ComponentCategory;
    }[];
    const resolved = partsByIds(
      db,
      links.map((l) => l.part_id),
    ).map((p) => attachPrices([p], sellerId)[0]);
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
    // Ready PC price = sum of priced parts in its composition.
    const totalPrice = parts
      .filter((p) => p.part?.price !== undefined)
      .reduce((s, p) => s + (p.part!.price ?? 0), 0);
    const reviewCount = (reviewCountStmt.get(row.ready_pc_id) as { c: number }).c;
    return { ...readyPcToBaseDto(row), price: totalPrice, reviewCount, parts };
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
    getReadyPc(id, sellerId) {
      const row = getReadyStmt.get(id) as ReadyPcRow | undefined;
      return row && (sellerId === undefined || row.seller_id === sellerId)
        ? readyPcWithParts(row, sellerId)
        : null;
    },
    createPart(input) {
      db.prepare(
        `INSERT INTO part (part_id, category, name, brand, vendor_id, tdp_watt, compat_json, specs_json, image_url, is_active, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
         ON CONFLICT(part_id) DO UPDATE SET
           category=excluded.category, name=excluded.name, brand=excluded.brand,
           vendor_id=excluded.vendor_id,
           tdp_watt=excluded.tdp_watt, compat_json=excluded.compat_json,
           specs_json=excluded.specs_json, image_url=excluded.image_url,
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
      };
      db.prepare(
        `UPDATE part SET name=?, brand=?, vendor_id=?, tdp_watt=?,
           compat_json=?, specs_json=?, image_url=?
         WHERE part_id=?`,
      ).run(
        next.name,
        next.brand,
        next.vendor_id,
        next.tdp_watt,
        next.compat_json,
        next.specs_json,
        next.image_url,
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
  };
}