// Sales analytics DAO: aggregates order/order_item snapshots into the
// seller/admin analytics DTO (revenue, funnel, top builds/parts, catalog
// coverage and the admin-only Alpha-Bank installment breakdown).
//
// Money is always `SUM(order_item.price_kopecks * order_item.count)`. The
// order_header.total_kopecks value is never used: a multi-seller order's total
// includes other sellers' lines. Revenue KPIs exclude `status='cancelled'`.

import type { Database } from "better-sqlite3";
import type { OrderStatus } from "./types.ts";

export interface SalesAnalyticsScope {
  /** Restrict to one seller's order lines; `null` aggregates every seller. */
  sellerId: string | null;
  /** Inclusive ISO lower bound, or `null` for "all time". */
  from: string | null;
  /** Exclusive ISO upper bound. */
  to: string;
}

export interface SalesKpi {
  revenueKopecks: number;
  orders: number;
  units: number;
  avgOrderKopecks: number;
  cancelledOrders: number;
  cancelledRate: number;
}

export interface RevenueDayRow {
  date: string;
  revenueKopecks: number;
  orders: number;
}

export interface FunnelRow {
  status: OrderStatus;
  orders: number;
  revenueKopecks: number;
}

export interface TopBuildRow {
  kind: "ready" | "config";
  refId: string;
  name: string;
  units: number;
  revenueKopecks: number;
}

export interface TopPartRow {
  refId: string;
  name: string;
  category: string;
  units: number;
  revenueKopecks: number;
}

export interface BucketRow {
  bucket: string;
  orders: number;
}

export interface CoverageRow {
  category: string;
  total: number;
  priced: number;
  available: number;
}

export interface InstallmentRow {
  approved: number;
  rejected: number;
  pending: number;
  withInstallment: number;
  withoutInstallment: number;
  installmentShare: number;
  avgInstallmentOrderKopecks: number;
  avgFullOrderKopecks: number;
}

export interface SalesAnalyticsRepository {
  kpi(scope: SalesAnalyticsScope): SalesKpi;
  revenueByDay(scope: SalesAnalyticsScope): RevenueDayRow[];
  funnel(scope: SalesAnalyticsScope): FunnelRow[];
  topBuilds(scope: SalesAnalyticsScope, limit: number): TopBuildRow[];
  topParts(scope: SalesAnalyticsScope, limit: number): TopPartRow[];
  orderValueBuckets(scope: SalesAnalyticsScope): BucketRow[];
  catalogCoverage(scope: SalesAnalyticsScope): CoverageRow[];
  installment(scope: SalesAnalyticsScope): InstallmentRow;
}

/** Bucket upper bounds in kopecks (rubles: 50k/100k/200k/400k) + labels. */
const VALUE_BUCKETS: Array<{ label: string; max: number | null }> = [
  { label: "< 50 000 ₽", max: 5_000_000 },
  { label: "50 000 – 100 000 ₽", max: 10_000_000 },
  { label: "100 000 – 200 000 ₽", max: 20_000_000 },
  { label: "200 000 – 400 000 ₽", max: 40_000_000 },
  { label: "≥ 400 000 ₽", max: null },
];

export function createSalesAnalyticsRepository(db: Database): SalesAnalyticsRepository {
  /**
   * Build the optional `AND i.seller_id = ?` / date predicates. Pass
   * `includeSeller: false` to get a header-level date-only filter (used by the
   * order_header-level installment aggregates, which have no item join).
   */
  function scopeWhere(
    scope: SalesAnalyticsScope,
    aliases: { header: string; item: string },
    includeSeller = true,
  ): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (includeSeller && scope.sellerId) {
      clauses.push(`${aliases.item}.seller_id = ?`);
      params.push(scope.sellerId);
    }
    if (scope.from) {
      clauses.push(`${aliases.header}.created_at >= ?`);
      params.push(scope.from);
    }
    clauses.push(`${aliases.header}.created_at < ?`);
    params.push(scope.to);
    return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", params };
  }

  /** Date-only filter for order_header-level aggregates (no seller/item join). */
  function headerDateFilter(scope: SalesAnalyticsScope): { sql: string; params: unknown[] } {
    return scopeWhere(scope, { header: "h", item: "h" }, false);
  }

  /**
   * Per-order aggregate of this seller's lines for orders in the scope.
   * `orderTotals(orderId, kopecks)`; excludes cancelled by default.
   */
  function orderTotalsSubquery(scope: SalesAnalyticsScope, excludeCancelled: boolean): string {
    const w = scopeWhere(scope, { header: "h", item: "i" });
    return `
      SELECT i.order_id AS order_id, SUM(i.price_kopecks * i.count) AS total
      FROM order_item i
      JOIN order_header h ON h.order_id = i.order_id
      WHERE 1=1${w.sql}${excludeCancelled ? " AND h.status <> 'cancelled'" : ""}
      GROUP BY i.order_id
    `;
  }

  function kpi(scope: SalesAnalyticsScope): SalesKpi {
    const w = scopeWhere(scope, { header: "h", item: "i" });
    const totals = orderTotalsSubquery(scope, true);
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(total), 0) AS revenue,
           COUNT(*) AS orders
         FROM (${totals})`,
      )
      .get(...w.params) as {
      revenue: number;
      orders: number;
    };

    const unitsRow = db
      .prepare(
        `SELECT COALESCE(SUM(i.count), 0) AS units
         FROM order_item i JOIN order_header h ON h.order_id = i.order_id
         WHERE h.status <> 'cancelled'${w.sql}`,
      )
      .get(...w.params) as { units: number };

    const cancelledRow = db
      .prepare(
        `SELECT COUNT(DISTINCT i.order_id) AS n
         FROM order_item i JOIN order_header h ON h.order_id = i.order_id
         WHERE h.status = 'cancelled'${w.sql}`,
      )
      .get(...w.params) as { n: number };

    const cancelledOrders = cancelledRow.n;
    const totalOrders = row.orders + cancelledOrders;
    return {
      revenueKopecks: row.revenue,
      orders: row.orders,
      units: unitsRow.units,
      avgOrderKopecks: row.orders > 0 ? Math.round(row.revenue / row.orders) : 0,
      cancelledOrders,
      cancelledRate: totalOrders > 0 ? cancelledOrders / totalOrders : 0,
    };
  }

  function revenueByDay(scope: SalesAnalyticsScope): RevenueDayRow[] {
    const w = scopeWhere(scope, { header: "h", item: "i" });
    const rows = db
      .prepare(
        `SELECT
           substr(h.created_at, 1, 10) AS date,
           SUM(i.price_kopecks * i.count) AS revenue,
           COUNT(DISTINCT h.order_id) AS orders
         FROM order_item i JOIN order_header h ON h.order_id = i.order_id
         WHERE h.status <> 'cancelled'${w.sql}
         GROUP BY date
         ORDER BY date ASC`,
      )
      .all(...w.params) as { date: string; revenue: number; orders: number }[];
    return rows.map((r) => ({
      date: r.date,
      revenueKopecks: r.revenue,
      orders: r.orders,
    }));
  }

  /**
   * Cumulative funnel by current status (no status history is stored). Each
   * cumulative stage counts orders that reached *at least* that stage, per the
   * monotone lifecycle in `SELLER_ORDER_TRANSITIONS`.
   */
  function funnel(scope: SalesAnalyticsScope): FunnelRow[] {
    // Per status totals across the scope (cancelled included for its own branch).
    const w = scopeWhere(scope, { header: "h", item: "i" });
    const rows = db
      .prepare(
        `SELECT
           h.status AS status,
           COUNT(DISTINCT h.order_id) AS orders,
           COALESCE(SUM(i.price_kopecks * i.count), 0) AS revenue
         FROM order_item i JOIN order_header h ON h.order_id = i.order_id
         WHERE 1=1${w.sql}
         GROUP BY h.status`,
      )
      .all(...w.params) as { status: OrderStatus; orders: number; revenue: number }[];

    const byStatus = new Map(rows.map((r) => [r.status, r]));
    const at = (statuses: OrderStatus[]): { orders: number; revenueKopecks: number } => {
      let orders = 0;
      let revenueKopecks = 0;
      for (const s of statuses) {
        const r = byStatus.get(s);
        if (r) {
          orders += r.orders;
          revenueKopecks += r.revenue;
        }
      }
      return { orders, revenueKopecks };
    };

    const newStage = at(["new", "confirmed", "delivery", "done", "alpha", "alpha_rejected"]);
    const confirmedStage = at(["confirmed", "delivery", "done", "alpha", "alpha_rejected"]);
    const deliveryStage = at(["delivery", "done"]);
    const doneStage = at(["done"]);
    const alphaStage = at(["alpha"]);
    const rejectedStage = at(["alpha_rejected"]);
    const cancelledStage = at(["cancelled"]);

    return [
      { status: "new", ...newStage },
      { status: "confirmed", ...confirmedStage },
      { status: "delivery", ...deliveryStage },
      { status: "done", ...doneStage },
      { status: "alpha", ...alphaStage },
      { status: "alpha_rejected", ...rejectedStage },
      { status: "cancelled", ...cancelledStage },
    ];
  }

  function topBuilds(scope: SalesAnalyticsScope, limit: number): TopBuildRow[] {
    const w = scopeWhere(scope, { header: "h", item: "i" });
    const rows = db
      .prepare(
        `SELECT
           i.kind AS kind, i.ref_id AS ref_id, i.name AS name,
           SUM(i.count) AS units,
           SUM(i.price_kopecks * i.count) AS revenue
         FROM order_item i JOIN order_header h ON h.order_id = i.order_id
         WHERE h.status <> 'cancelled'${w.sql}
         GROUP BY i.kind, i.ref_id, i.name`,
      )
      .all(...w.params) as {
      kind: "ready" | "config";
      ref_id: string;
      name: string;
      units: number;
      revenue: number;
    }[];

    // Aggregate every custom-config line into a single "Кастомные сборки" row.
    let customUnits = 0;
    let customRevenue = 0;
    const ready: TopBuildRow[] = [];
    for (const r of rows) {
      if (r.kind === "config") {
        customUnits += r.units;
        customRevenue += r.revenue;
      } else {
        ready.push({
          kind: "ready",
          refId: r.ref_id,
          name: r.name,
          units: r.units,
          revenueKopecks: r.revenue,
        });
      }
    }
    ready.sort((a, b) => b.revenueKopecks - a.revenueKopecks);
    const top = ready.slice(0, limit);
    if (customUnits > 0) {
      top.push({
        kind: "config",
        refId: "config",
        name: "Кастомные сборки",
        units: customUnits,
        revenueKopecks: customRevenue,
      });
    }
    return top;
  }

  function topParts(scope: SalesAnalyticsScope, limit: number): TopPartRow[] {
    const w = scopeWhere(scope, { header: "h", item: "i" });
    const rows = db
      .prepare(
        `SELECT
           i.ref_id AS ref_id, i.name AS name,
           COALESCE(i.category, '—') AS category,
           SUM(i.count) AS units,
           SUM(i.price_kopecks * i.count) AS revenue
         FROM order_item i JOIN order_header h ON h.order_id = i.order_id
         WHERE i.kind = 'config' AND h.status <> 'cancelled'${w.sql}
         GROUP BY i.ref_id, i.name, i.category
         ORDER BY revenue DESC
         LIMIT ?`,
      )
      .all(...w.params, limit) as {
      ref_id: string;
      name: string;
      category: string;
      units: number;
      revenue: number;
    }[];
    return rows.map((r) => ({
      refId: r.ref_id,
      name: r.name,
      category: r.category,
      units: r.units,
      revenueKopecks: r.revenue,
    }));
  }

  function orderValueBuckets(scope: SalesAnalyticsScope): BucketRow[] {
    const w = scopeWhere(scope, { header: "h", item: "i" });
    const totals = orderTotalsSubquery(scope, true);
    const rows = db
      .prepare(
        `SELECT total FROM (${totals})`,
      )
      .all(...w.params) as { total: number }[];

    const counts = VALUE_BUCKETS.map(() => 0);
    for (const r of rows) {
      const idx = VALUE_BUCKETS.findIndex((b) => b.max === null || r.total < b.max);
      counts[idx === -1 ? VALUE_BUCKETS.length - 1 : idx] += 1;
    }
    return VALUE_BUCKETS.map((b, i) => ({ bucket: b.label, orders: counts[i] }));
  }

  function catalogCoverage(scope: SalesAnalyticsScope): CoverageRow[] {
    if (scope.sellerId) {
      const rows = db
        .prepare(
          `SELECT
             p.category AS category,
             COUNT(*) AS total,
             SUM(CASE WHEN p.is_active = 1 AND p.is_available = 1 THEN 1 ELSE 0 END) AS available,
             SUM(CASE WHEN EXISTS (
               SELECT 1 FROM price_list_item pli
               JOIN price_list pl ON pl.price_list_id = pli.price_list_id
               WHERE pl.seller_id = ? AND pl.is_active = 1
                 AND pli.part_id = p.part_id AND pli.price_kopecks > 0
             ) THEN 1 ELSE 0 END) AS priced
           FROM part p
           GROUP BY p.category
           ORDER BY p.category`,
        )
        .all(scope.sellerId) as {
        category: string;
        total: number;
        available: number;
        priced: number;
      }[];
      return rows.map((r) => ({
        category: r.category,
        total: r.total,
        priced: r.priced,
        available: r.available,
      }));
    }

    // All sellers: a part counts as "priced" when at least one active seller list prices it.
    const rows = db
      .prepare(
        `SELECT
           p.category AS category,
           COUNT(*) AS total,
           SUM(CASE WHEN p.is_active = 1 AND p.is_available = 1 THEN 1 ELSE 0 END) AS available,
           SUM(CASE WHEN EXISTS (
             SELECT 1 FROM price_list_item pli
             JOIN price_list pl ON pl.price_list_id = pli.price_list_id
             WHERE pl.is_active = 1 AND pli.part_id = p.part_id AND pli.price_kopecks > 0
           ) THEN 1 ELSE 0 END) AS priced
         FROM part p
         GROUP BY p.category
         ORDER BY p.category`,
      )
      .all() as {
      category: string;
      total: number;
      available: number;
      priced: number;
    }[];
    return rows.map((r) => ({
      category: r.category,
      total: r.total,
      priced: r.priced,
      available: r.available,
    }));
  }

  function installment(scope: SalesAnalyticsScope): InstallmentRow {
    const w = scopeWhere(scope, { header: "h", item: "i" });
    const dateFilter = headerDateFilter(scope);

    const decisions = db
      .prepare(
        `SELECT
           SUM(CASE WHEN h.installment_decision = 'approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN h.installment_decision = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN h.installment_decision = 'pending' THEN 1 ELSE 0 END) AS pending
         FROM order_header h
         WHERE h.installment_decision IS NOT NULL
           AND h.status <> 'cancelled'${dateFilter.sql}`,
      )
      .get(...dateFilter.params) as {
      approved: number | null;
      rejected: number | null;
      pending: number | null;
    };

    const paid = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN h.payment_method = 'installment' THEN 1 ELSE 0 END) AS installment
         FROM order_header h
         WHERE h.status IN ('confirmed','delivery','done')${dateFilter.sql}`,
      )
      .get(...dateFilter.params) as { total: number; installment: number | null };

    const totals = orderTotalsSubquery(scope, true);
    const avgRow = db
      .prepare(
        `SELECT
           AVG(CASE WHEN h.payment_method = 'installment' THEN t.total END) AS avg_installment,
           AVG(CASE WHEN h.payment_method = 'full' THEN t.total END) AS avg_full
         FROM (${totals}) t
         JOIN order_header h ON h.order_id = t.order_id
         WHERE h.status IN ('confirmed','delivery','done')`,
      )
      .get(...w.params) as {
      avg_installment: number | null;
      avg_full: number | null;
    };

    const withInstallment = paid.installment ?? 0;
    const withoutInstallment = paid.total - withInstallment;
    const denom = withInstallment + withoutInstallment;
    return {
      approved: decisions.approved ?? 0,
      rejected: decisions.rejected ?? 0,
      pending: decisions.pending ?? 0,
      withInstallment,
      withoutInstallment,
      installmentShare: denom > 0 ? withInstallment / denom : 0,
      avgInstallmentOrderKopecks: Math.round(avgRow.avg_installment ?? 0),
      avgFullOrderKopecks: Math.round(avgRow.avg_full ?? 0),
    };
  }

  return {
    kpi,
    revenueByDay,
    funnel,
    topBuilds,
    topParts,
    orderValueBuckets,
    catalogCoverage,
    installment,
  };
}