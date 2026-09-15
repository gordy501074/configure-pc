// Client-side holder for the session identifier.
// The session itself lives in SQLite (auth_session); only the opaque session id is
// kept browser-side so that a page reload can re-attach the logged-in user.

const KEY = "confi_session";

export function getSessionId(): string | null {
  const m = document.cookie.match(`(?:^|;\\s*)${KEY}=([^;]+)`);
  return m ? decodeURIComponent(m[1]) : null;
}

export function setSessionId(id: string): void {
  document.cookie = `${KEY}=${encodeURIComponent(id)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

export function clearSessionId(): void {
  document.cookie = `${KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}