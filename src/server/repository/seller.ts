// Seller DAO: seller <-> brand ownership (1-to-many).

import type { Database } from "better-sqlite3";

export interface SellerRepository {
  listSellerBrands(sellerId: string): string[];
}

export function createSellerRepository(db: Database): SellerRepository {
  const listBrandsStmt = db.prepare(
    `SELECT brand FROM seller_brand WHERE seller_id = ? ORDER BY brand`,
  );

  return {
    listSellerBrands(sellerId) {
      const rows = listBrandsStmt.all(sellerId) as { brand: string }[];
      return rows.map((r) => r.brand);
    },
  };
}