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
  };
}