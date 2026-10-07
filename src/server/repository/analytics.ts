// Analytics DAO: appends anonymized telemetry events into SQLite.
// The heavy lifting (redaction, batching, offline queue) happens client-side;
// this endpoint is a simple, cheap append store used for smoke/regression
// signals and for generating tests from real usage logs.

import type { Database } from "better-sqlite3";

export type AnalyticsLevel = "debug" | "info" | "warn" | "error" | "critical";

export interface AnalyticsEvent {
  ts: string;
  sessionId?: string | null;
  userId?: string | null; // hashed or anonymous id, never a raw PII login
  event: string;
  level: AnalyticsLevel;
  route?: string | null;
  payload?: Record<string, unknown> | null;
  ua?: string | null;
  build?: string | null;
}

export interface AnalyticsRepository {
  append(events: AnalyticsEvent[]): number;
  count(): number;
  recent(limit: number): AnalyticsEvent[];
  /** Latest events that map to the most frequent user flows (for test gen). */
  flows(limit: number, minCount?: number): { event: string; count: number }[];
  /** Click counts per fake-door name (`ui:click` with payload.name LIKE fake_door%). */
  fakeDoorClicks(from: string | null, to: string): { name: string; clicks: number }[];
  /** `page:view` counts per route, restricted to the given host routes. */
  routeViews(routes: string[], from: string | null, to: string): { route: string; views: number }[];
  /** Impression counts per fake-door name (`fake-door:impression`). */
  impressions(names: string[], from: string | null, to: string): { name: string; impressions: number }[];
}

export function createAnalyticsRepository(db: Database): AnalyticsRepository {
  const insertStmt = db.prepare(
    `INSERT INTO analytics_events (ts, session_id, user_id, event, level, route, payload, ua, build)
     VALUES (@ts, @sessionId, @userId, @event, @level, @route, @payload, @ua, @build)`,
  );
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM analytics_events`);
  const recentStmt = db.prepare(
    `SELECT
        ts, session_id AS sessionId, user_id AS userId, event, level, route,
        payload, ua, build
      FROM analytics_events ORDER BY ts DESC LIMIT ?`,
  );
  const flowsStmt = db.prepare(
    `SELECT event, COUNT(*) AS count FROM analytics_events
     WHERE level != 'debug'
     GROUP BY event ORDER BY count DESC LIMIT ?`,
  );

  const fakeDoorClicksStmt = db.prepare(
    `SELECT json_extract(payload,'$.name') AS name, COUNT(*) AS clicks
     FROM analytics_events
     WHERE event = 'ui:click' AND json_valid(payload)
       AND json_extract(payload,'$.name') LIKE 'fake_door%'
       AND (@from IS NULL OR ts >= @from) AND ts <= @to
     GROUP BY name`,
  );

  const impressionsStmt = db.prepare(
    `SELECT json_extract(payload,'$.name') AS name, COUNT(*) AS impressions
     FROM analytics_events
     WHERE event = 'fake-door:impression' AND json_valid(payload)
       AND json_extract(payload,'$.name') IN (SELECT value FROM json_each(@names))
       AND (@from IS NULL OR ts >= @from) AND ts <= @to
     GROUP BY name`,
  );

  const routeViewsStmt = db.prepare(
    `SELECT route, COUNT(*) AS views
     FROM analytics_events
     WHERE event = 'page:view' AND route IS NOT NULL
       AND route IN (SELECT value FROM json_each(@routes))
       AND (@from IS NULL OR ts >= @from) AND ts <= @to
     GROUP BY route`,
  );

  const insertMany = db.transaction((rows: AnalyticsEvent[]) => {
    let n = 0;
    for (const r of rows) {
      insertStmt.run({
        ...r,
        sessionId: r.sessionId ?? null,
        userId: r.userId ?? null,
        route: r.route ?? null,
        payload: r.payload ? JSON.stringify(r.payload) : "{}",
        ua: r.ua ?? null,
        build: r.build ?? null,
      });
      n++;
    }
    return n;
  });

  return {
    append(events) {
      if (events.length === 0) return 0;
      return insertMany(events);
    },
    count() {
      const row = countStmt.get() as { n: number };
      return row.n;
    },
    recent(limit) {
      return recentStmt.all(limit) as unknown as AnalyticsEvent[];
    },
    flows(limit, minCount = 3) {
      const rows = flowsStmt.all(limit) as { event: string; count: number }[];
      return rows.filter((r) => r.count >= minCount);
    },
    fakeDoorClicks(from, to) {
      return fakeDoorClicksStmt.all({ from, to }) as { name: string; clicks: number }[];
    },
    routeViews(routes, from, to) {
      if (routes.length === 0) return [];
      return routeViewsStmt.all({ routes: JSON.stringify(routes), from, to }) as {
        route: string;
        views: number;
      }[];
    },
    impressions(names, from, to) {
      if (names.length === 0) return [];
      return impressionsStmt.all({ names: JSON.stringify(names), from, to }) as {
        name: string;
        impressions: number;
      }[];
    },
  };
}