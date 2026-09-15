// Catalog DAO: parts and ready PCs (read-mostly).

import type { Database } from "better-sqlite3";
import type { ComponentCategory, PartDto, PartRow, ReadyPcDto, ReadyPcRow } from "./types.ts";
import { partToDto, readyPcToBaseDto } from "./types.ts";

export interface CatalogRepository {
  listParts(category?: ComponentCategory): PartDto[];
  getPart(id: string): PartDto | null;
  listReadyPcs(): ReadyPcDto[];
  getReadyPc(id: string): ReadyPcDto | null;
}

/** Resolve parts by ids preserving the given order. */
function partsByIds(db: Database, ids: string[]): PartDto[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM part WHERE part_id IN (${placeholders}) AND is_active = 1`,
    )
    .all(...ids) as PartRow[];
  const byId = new Map(rows.map((r) => [r.part_id, partToDto(r)]));
  return ids.map((id) => byId.get(id)).filter((p): p is PartDto => !!p);
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
  const listReadyStmt = db.prepare(
    `SELECT * FROM ready_pc WHERE is_active = 1 ORDER BY created_at`,
  );
  const getReadyStmt = db.prepare(
    `SELECT * FROM ready_pc WHERE ready_pc_id = ? AND is_active = 1`,
  );
  const readyPartIdsStmt = db.prepare(
    `SELECT part_id, category FROM ready_pc_part WHERE ready_pc_id = ? ORDER BY category`,
  );

  function readyPcWithParts(row: ReadyPcRow): ReadyPcDto | null {
    if (!row) return null;
    const links = readyPartIdsStmt.all(row.ready_pc_id) as {
      part_id: string;
      category: ComponentCategory;
    }[];
    const byId = new Map(
      partsByIds(db, links.map((l) => l.part_id)).map((p) => [p.id, p]),
    );
    const parts = links
      .map((l) => byId.get(l.part_id))
      .filter((p): p is PartDto => !!p);
    return { ...readyPcToBaseDto(row), parts };
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
    listReadyPcs() {
      const rows = listReadyStmt.all() as ReadyPcRow[];
      return rows.map((r) => readyPcWithParts(r)!).filter(Boolean);
    },
    getReadyPc(id) {
      const row = getReadyStmt.get(id) as ReadyPcRow | undefined;
      return row ? readyPcWithParts(row) : null;
    },
  };
}