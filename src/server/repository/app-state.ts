// App-state DAO: auth sessions, pending SMS verification, generic key/value store.
// Replaces everything previously kept in localStorage (alfagen:*).

import type { Database } from "better-sqlite3";

export interface PendingAuth {
  phone: string;
  code: string;
  expiresAt: number;
}

export interface AppStateRepository {
  // sessions
  createSession(userId: string): string;
  getSessionUser(sessionId: string): string | null;
  deleteSession(sessionId: string): void;

  // pending phone auth
  getPendingAuth(phone: string): PendingAuth | null;
  setPendingAuth(p: PendingAuth): void;
  clearPendingAuth(phone: string): void;

  // key/value
  getKV(key: string): string | null;
  setKV(key: string, value: string): void;

  // onboarding
  isOnboarded(): boolean;
  setOnboarded(v: boolean): void;
}

export function createAppStateRepository(db: Database): AppStateRepository {
  const insertSessionStmt = db.prepare(
    `INSERT INTO auth_session (session_id, user_id) VALUES (?, ?)`,
  );
  const getSessionStmt = db.prepare(
    `SELECT user_id FROM auth_session WHERE session_id = ?`,
  );
  const deleteSessionStmt = db.prepare(
    `DELETE FROM auth_session WHERE session_id = ?`,
  );

  const getPendingStmt = db.prepare(
    `SELECT * FROM auth_pending WHERE phone = ?`,
  );
  const upsertPendingStmt = db.prepare(
    `INSERT INTO auth_pending (phone, code, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       code=excluded.code, expires_at=excluded.expires_at`,
  );
  const clearPendingStmt = db.prepare(`DELETE FROM auth_pending WHERE phone = ?`);

  const getKVStmt = db.prepare(`SELECT v FROM kv_store WHERE k = ?`);
  const upsertKVStmt = db.prepare(
    `INSERT INTO kv_store (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v=excluded.v,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );

  return {
    createSession(userId) {
      const sessionId =
        `ses-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      insertSessionStmt.run(sessionId, userId);
      return sessionId;
    },
    getSessionUser(sessionId) {
      const row = getSessionStmt.get(sessionId) as { user_id: string } | undefined;
      return row?.user_id ?? null;
    },
    deleteSession(sessionId) {
      deleteSessionStmt.run(sessionId);
    },

    getPendingAuth(phone) {
      const row = getPendingStmt.get(phone) as
        | { code: string; expires_at: string }
        | undefined;
      if (!row) return null;
      return { phone, code: row.code, expiresAt: Date.parse(row.expires_at) };
    },
    setPendingAuth(p) {
      upsertPendingStmt.run(p.phone, p.code, new Date(p.expiresAt).toISOString());
    },
    clearPendingAuth(phone) {
      clearPendingStmt.run(phone);
    },

    getKV(key) {
      const row = getKVStmt.get(key) as { v: string } | undefined;
      return row?.v ?? null;
    },
    setKV(key, value) {
      upsertKVStmt.run(key, value);
    },

    isOnboarded() {
      return this.getKV("onboarded") === "1";
    },
    setOnboarded(v) {
      this.setKV("onboarded", v ? "1" : "0");
    },
  };
}