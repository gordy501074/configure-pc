// Price-list DAO: sellers manage price lists (exactly one active per seller).
// Price list items carry per-part prices; price 0/missing => "недоступен для заказа".

import type { Database } from "better-sqlite3";
import type { ComponentCategory, PartDto } from "./types.ts";
import { partToDto } from "./types.ts";

export interface PriceListItemDto {
  partId: string;
  /** Part display name (from `part.name`). */
  name?: string;
  /** Part category (from `part.category`). */
  category?: ComponentCategory;
  price: number; // rubles
}

export interface PriceListDto {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: number;
  items: PriceListItemDto[];
}

export interface PriceListRepository {
  listPriceLists(sellerId: string): PriceListDto[];
  getPriceList(priceListId: string): PriceListDto | null;
  createPriceList(sellerId: string, name: string): PriceListDto;
  renamePriceList(priceListId: string, name: string): PriceListDto | null;
  deletePriceList(priceListId: string): boolean;
  setActivePriceList(priceListId: string): PriceListDto | null;
  upsertItem(priceListId: string, partId: string, price: number): PriceListDto | null;
  deleteItem(priceListId: string, partId: string): boolean;
  listMissingItems(sellerId: string, priceListId: string, includeInactive?: boolean): PartDto[];
  addItems(priceListId: string, partIds: string[]): { added: number };
  priceFor(priceListId: string, partId: string): number | null;
  activePriceListId(sellerId: string): string | null;
}

interface PriceListRow {
  price_list_id: string;
  seller_id: string;
  name: string;
  is_active: number;
  created_at: string;
}

interface PartRowLite {
  part_id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  vendor_id: string | null;
  tdp_watt: number;
  compat_json: string;
  specs_json: string;
  image_url: string | null;
  is_active: number;
  is_available: number;
  created_at: string;
}

export function createPriceListRepository(db: Database): PriceListRepository {
  const listStmt = db.prepare(
    `SELECT * FROM price_list WHERE seller_id = ? ORDER BY created_at ASC`,
  );
  const getStmt = db.prepare(
    `SELECT * FROM price_list WHERE price_list_id = ?`,
  );
  const listItemsStmt = db.prepare(
    `SELECT pli.part_id, pli.price_kopecks, p.name AS part_name, p.category AS part_category
     FROM price_list_item pli
     LEFT JOIN part p ON p.part_id = pli.part_id
     WHERE pli.price_list_id = ?
     ORDER BY p.name`,
  );
  const itemStmt = db.prepare(
    `SELECT price_kopecks FROM price_list_item WHERE price_list_id = ? AND part_id = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO price_list (price_list_id, seller_id, name, is_active)
     VALUES (?, ?, ?, 0)`,
  );
  const renameStmt = db.prepare(
    `UPDATE price_list SET name = ? WHERE price_list_id = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM price_list WHERE price_list_id = ?`);
  const setActiveStmt = db.prepare(
    `UPDATE price_list SET is_active = 1 WHERE price_list_id = ?`,
  );
  const clearActiveStmt = db.prepare(
    `UPDATE price_list SET is_active = 0 WHERE seller_id = ?`,
  );
  const activeIdStmt = db.prepare(
    `SELECT price_list_id FROM price_list WHERE seller_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`,
  );
  const upsertItemStmt = db.prepare(
    `INSERT INTO price_list_item (price_list_id, part_id, price_kopecks)
     VALUES (?, ?, ?)
     ON CONFLICT(price_list_id, part_id) DO UPDATE SET price_kopecks=excluded.price_kopecks`,
  );
  const delItemStmt = db.prepare(
    `DELETE FROM price_list_item WHERE price_list_id = ? AND part_id = ?`,
  );
  const missingStmt = db.prepare(
    `SELECT p.* FROM part p
     WHERE p.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM price_list_item pli
                       WHERE pli.price_list_id = ? AND pli.part_id = p.part_id)
     ORDER BY p.category, p.name`,
  );
  const missingAllStmt = db.prepare(
    `SELECT p.* FROM part p
     WHERE NOT EXISTS (SELECT 1 FROM price_list_item pli
                       WHERE pli.price_list_id = ? AND pli.part_id = p.part_id)
     ORDER BY p.category, p.name`,
  );
  const countStmt = db.prepare(
    `SELECT count(*) AS c FROM price_list WHERE seller_id = ?`,
  );

  function toDto(row: PriceListRow, items: PriceListItemDto[]): PriceListDto {
    return {
      id: row.price_list_id,
      name: row.name,
      isActive: row.is_active === 1,
      createdAt: Date.parse(row.created_at),
      items,
    };
  }

  function itemRowsOf(priceListId: string): PriceListItemDto[] {
    return (listItemsStmt.all(priceListId) as {
      part_id: string;
      price_kopecks: number;
      part_name: string | null;
      part_category: ComponentCategory | null;
    }[]).map((i): PriceListItemDto => ({
      partId: i.part_id,
      name: i.part_name ?? undefined,
      category: i.part_category ?? undefined,
      price: i.price_kopecks / 100,
    }));
  }

  function getListWithItems(priceListId: string): PriceListDto | null {
    const row = getStmt.get(priceListId) as PriceListRow | undefined;
    if (!row) return null;
    const items = itemRowsOf(priceListId);
    return toDto(row, items);
  }

  return {
    listPriceLists(sellerId) {
      const rows = listStmt.all(sellerId) as PriceListRow[];
      return rows
        .map((r) => toDto(r, []))
        .map((d) => ({
          ...d,
          items: itemRowsOf(d.id),
        }));
    },

    getPriceList(priceListId) {
      return getListWithItems(priceListId);
    },

    createPriceList(sellerId, name) {
      const id = `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const count = (countStmt.get(sellerId) as { c: number }).c;
      if (count === 0) {
        db.transaction(() => {
          insertStmt.run(id, sellerId, name);
          setActiveStmt.run(id);
        })();
      } else {
        insertStmt.run(id, sellerId, name);
      }
      return getListWithItems(id)!;
    },

    renamePriceList(priceListId, name) {
      const row = getStmt.get(priceListId) as PriceListRow | undefined;
      if (!row) return null;
      renameStmt.run(name, priceListId);
      return getListWithItems(priceListId)!;
    },

    deletePriceList(priceListId) {
      const row = getStmt.get(priceListId) as PriceListRow | undefined;
      if (!row) return false;
      const wasActive = row.is_active === 1;
      const tx = db.transaction(() => {
        deleteStmt.run(priceListId);
        if (wasActive) {
          // Activate the most recent remaining price list of this seller.
          const next = db
            .prepare(
              `SELECT price_list_id FROM price_list
               WHERE seller_id = ? ORDER BY created_at DESC LIMIT 1`,
            )
            .get(row.seller_id) as { price_list_id: string } | undefined;
          if (next) setActiveStmt.run(next.price_list_id);
        }
      });
      tx();
      return true;
    },

    setActivePriceList(priceListId) {
      const row = getStmt.get(priceListId) as PriceListRow | undefined;
      if (!row) return null;
      db.transaction(() => {
        clearActiveStmt.run(row.seller_id);
        setActiveStmt.run(priceListId);
      })();
      return getListWithItems(priceListId)!;
    },

    upsertItem(priceListId, partId, price) {
      const row = getStmt.get(priceListId) as PriceListRow | undefined;
      if (!row) return null;
      upsertItemStmt.run(priceListId, partId, Math.round(price * 100));
      return getListWithItems(priceListId)!;
    },

    deleteItem(priceListId, partId) {
      const info = delItemStmt.run(priceListId, partId);
      return info.changes > 0;
    },

    listMissingItems(sellerId, priceListId, includeInactive) {
      // Ownership sanity: only expose parts for the seller's own price list.
      const row = getStmt.get(priceListId) as PriceListRow | undefined;
      if (!row || row.seller_id !== sellerId) return [];
      const rows = (includeInactive ? missingAllStmt : missingStmt).all(priceListId) as PartRowLite[];
      return rows.map(partToDto);
    },

    addItems(priceListId, partIds) {
      const row = getStmt.get(priceListId) as PriceListRow | undefined;
      if (!row) return { added: 0 };
      let added = 0;
      db.transaction(() => {
        for (const partId of partIds) {
          const existing = itemStmt.get(priceListId, partId);
          if (existing) continue;
          const part = db
            .prepare(`SELECT part_id FROM part WHERE part_id = ?`)
            .get(partId);
          if (!part) continue;
          upsertItemStmt.run(priceListId, partId, 0);
          added += 1;
        }
      })();
      return { added };
    },

    priceFor(priceListId, partId) {
      const row = itemStmt.get(priceListId, partId) as { price_kopecks: number } | undefined;
      return row ? row.price_kopecks : null;
    },

    activePriceListId(sellerId) {
      const row = activeIdStmt.get(sellerId) as { price_list_id: string } | undefined;
      return row?.price_list_id ?? null;
    },
  };
}