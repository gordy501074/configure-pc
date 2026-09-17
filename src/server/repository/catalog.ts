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
import { partToDto, readyPcToBaseDto } from "./types.ts";

export interface CreatePartInput {
  id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  vendorId?: string | null;
  priceKopecks: number;
  tdpWatt: number;
  compat: PartCompat;
  specs?: SpecItem[];
  imageUrl?: string | null;
}

export interface UpdatePartInput {
  name?: string;
  brand?: string;
  vendorId?: string | null;
  priceKopecks?: number;
  tdpWatt?: number;
  compat?: PartCompat;
  specs?: SpecItem[];
  imageUrl?: string | null;
}

export interface CatalogRepository {
  listParts(category?: ComponentCategory): PartDto[];
  getPart(id: string): PartDto | null;
  /** Fetch a part regardless of is_active/is_available (admin internal use). */
  getPartAny(id: string): PartDto | null;
  listReadyPcs(): ReadyPcDto[];
  getReadyPc(id: string): ReadyPcDto | null;
  // Catalog management (seller/admin).
  createPart(input: CreatePartInput): PartDto;
  updatePart(id: string, patch: UpdatePartInput): PartDto | null;
  deactivatePart(id: string): boolean;
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
  const listPartsByCatStmt = db.prepare(
    `SELECT * FROM part WHERE category = ? AND is_active = 1 ORDER BY name`,
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

  function readyPcWithParts(row: ReadyPcRow): ReadyPcDto | null {
    if (!row) return null;
    const links = readyPartIdsStmt.all(row.ready_pc_id) as {
      part_id: string | null;
      category: ComponentCategory;
    }[];
    const resolved = partsByIds(
      db,
      links.map((l) => l.part_id),
    );
    const byId = new Map(resolved.map((p) => [p.id, p]));
    const parts: ConfigPartDto[] = links.map((l) => {
      if (!l.part_id) return { category: l.category, part: null, unavailableReason: "missing" };
      const part = byId.get(l.part_id);
      if (!part || !part.available) {
        return { category: l.category, part: null, unavailableReason: "deactivated" };
      }
      return { category: l.category, part };
    });
    const reviewCount = (reviewCountStmt.get(row.ready_pc_id) as { c: number }).c;
    return { ...readyPcToBaseDto(row), reviewCount, parts };
  }

  return {
    listParts(category) {
      const rows = category ? listPartsByCatStmt.all(category) : listPartsStmt.all();
      return (rows as PartRow[]).map(partToDto);
    },
    getPart(id) {
      const row = getPartStmt.get(id) as PartRow | undefined;
      return row ? partToDto(row) : null;
    },
    getPartAny(id) {
      const row = getPartAnyStmt.get(id) as PartRow | undefined;
      return row ? partToDto(row) : null;
    },
    listReadyPcs() {
      const rows = listReadyStmt.all() as ReadyPcRow[];
      return rows.map((r) => readyPcWithParts(r)!).filter(Boolean);
    },
    getReadyPc(id) {
      const row = getReadyStmt.get(id) as ReadyPcRow | undefined;
      return row ? readyPcWithParts(row) : null;
    },
    createPart(input) {
      db.prepare(
        `INSERT INTO part (part_id, category, name, brand, vendor_id, price_kopecks, tdp_watt, compat_json, specs_json, image_url, is_active, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
         ON CONFLICT(part_id) DO UPDATE SET
           category=excluded.category, name=excluded.name, brand=excluded.brand,
           vendor_id=excluded.vendor_id, price_kopecks=excluded.price_kopecks,
           tdp_watt=excluded.tdp_watt, compat_json=excluded.compat_json,
           specs_json=excluded.specs_json, image_url=excluded.image_url,
           is_active=1, is_available=1`,
      ).run(
        input.id,
        input.category,
        input.name,
        input.brand,
        input.vendorId ?? null,
        input.priceKopecks,
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
        price_kopecks: patch.priceKopecks ?? existing.price_kopecks,
        tdp_watt: patch.tdpWatt ?? existing.tdp_watt,
        compat_json: patch.compat ? compatJson(patch.compat) : existing.compat_json,
        specs_json: patch.specs ? specsJson(patch.specs) : existing.specs_json,
        image_url:
          patch.imageUrl !== undefined ? patch.imageUrl : existing.image_url,
      };
      db.prepare(
        `UPDATE part SET name=?, brand=?, vendor_id=?, price_kopecks=?, tdp_watt=?,
           compat_json=?, specs_json=?, image_url=?
         WHERE part_id=?`,
      ).run(
        next.name,
        next.brand,
        next.vendor_id,
        next.price_kopecks,
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