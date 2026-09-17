// Vendor DAO: the shared "trademark" dictionary (vendor). Case-insensitively unique.

import type { Database } from "better-sqlite3";
import type { VendorDto, VendorRow } from "./types.ts";

export interface VendorRepository {
  listVendors(): VendorDto[];
  getVendor(id: string): VendorDto | null;
  getOrCreateVendor(name: string): VendorDto;
}

function toDto(row: VendorRow): VendorDto {
  return { id: row.vendor_id, name: row.name };
}

function vendorId(): string {
  return `ven-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createVendorRepository(db: Database): VendorRepository {
  const listStmt = db.prepare(`SELECT * FROM vendor ORDER BY name COLLATE NOCASE`);
  const getByIdStmt = db.prepare(`SELECT * FROM vendor WHERE vendor_id = ?`);
  const getByNameStmt = db.prepare(
    `SELECT * FROM vendor WHERE name = ? COLLATE NOCASE`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO vendor (vendor_id, name) VALUES (?, ?)`,
  );

  return {
    listVendors() {
      return (listStmt.all() as VendorRow[]).map(toDto);
    },

    getVendor(id) {
      const row = getByIdStmt.get(id) as VendorRow | undefined;
      return row ? toDto(row) : null;
    },

    getOrCreateVendor(name) {
      const key = String(name ?? "").trim();
      if (!key) throw new Error("vendor name required");
      const existing = getByNameStmt.get(key) as VendorRow | undefined;
      if (existing) return toDto(existing);
      const id = vendorId();
      insertStmt.run(id, key);
      return toDto(getByIdStmt.get(id) as VendorRow);
    },
  };
}