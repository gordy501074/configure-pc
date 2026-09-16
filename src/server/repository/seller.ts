// Seller DAO: seller <-> brand ownership (1-to-many).

import type { Database } from "better-sqlite3";
import type { SellerBrandDto } from "./types.ts";

export interface SellerRepository {
  listSellerBrands(sellerId: string): SellerBrandDto[];
  addBrand(sellerId: string, brand: string, description?: string): SellerBrandDto;
  updateBrand(
    sellerId: string,
    brand: string,
    patch: { brand?: string; description?: string },
  ): SellerBrandDto | null;
  deleteBrand(sellerId: string, brand: string): boolean;
}

export function createSellerRepository(db: Database): SellerRepository {
  const listBrandsStmt = db.prepare(
    `SELECT brand, description FROM seller_brand WHERE seller_id = ? ORDER BY brand`,
  );
  const getBrandStmt = db.prepare(
    `SELECT brand, description FROM seller_brand WHERE seller_id = ? AND brand = ?`,
  );
  const insertBrandStmt = db.prepare(
    `INSERT INTO seller_brand (seller_id, brand, description) VALUES (?, ?, ?)`,
  );
  const updateBrandStmt = db.prepare(
    `UPDATE seller_brand SET brand = ?, description = ? WHERE seller_id = ? AND brand = ?`,
  );
  const deleteBrandStmt = db.prepare(
    `DELETE FROM seller_brand WHERE seller_id = ? AND brand = ?`,
  );

  function toDto(row: { brand: string; description: string | null }): SellerBrandDto {
    return row.description === null
      ? { brand: row.brand }
      : { brand: row.brand, description: row.description };
  }

  return {
    listSellerBrands(sellerId) {
      const rows = listBrandsStmt.all(sellerId) as {
        brand: string;
        description: string | null;
      }[];
      return rows.map(toDto);
    },

    addBrand(sellerId, brand, description) {
      insertBrandStmt.run(sellerId, brand, description ?? null);
      return toDto(getBrandStmt.get(sellerId, brand) as {
        brand: string;
        description: string | null;
      });
    },

    updateBrand(sellerId, brand, patch) {
      const existing = getBrandStmt.get(sellerId, brand) as {
        brand: string;
        description: string | null;
      } | undefined;
      if (!existing) return null;
      const nextBrand = patch.brand ?? existing.brand;
      const nextDescription =
        patch.description !== undefined ? patch.description : existing.description;
      // Avoid renaming onto another existing row (PK collision).
      if (nextBrand !== existing.brand) {
        const collision = getBrandStmt.get(sellerId, nextBrand) as
          | { brand: string; description: string | null }
          | undefined;
        if (collision) return null;
      }
      updateBrandStmt.run(nextBrand, nextDescription, sellerId, brand);
      return toDto(getBrandStmt.get(sellerId, nextBrand) as {
        brand: string;
        description: string | null;
      });
    },

    deleteBrand(sellerId, brand) {
      const info = deleteBrandStmt.run(sellerId, brand);
      return info.changes > 0;
    },
  };
}