// Redaction filter: strips PII, secrets and volatile data from any payload or
// URL before it is queued/sent. Applied to every event and to fetch URLs.

const PII_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "secret_key",
  "authorization",
  "cookie",
  "set-cookie",
  "session_id",
  "sessionId",
  "phone",
  "email",
  "code",
  "sms_code",
  "verification_code",
  "address",
  "ssn",
  "card",
  "cvv",
  "card_number",
  "cardholder",
  "iban",
  "bic",
  "swift",
  "csrf",
  "csrf_token",
  "x-csrf-token",
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Loosely matches international phone forms; conservative on purpose.
const PHONE_RE = /\b(\+?\d[\d\s().-]{6,}\d)\b/g;
const TOKEN_RE = /\b(eyJ[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]+|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{16,})\b/g;

/** Mask occurrences in a string, keeping up to `keep` leading chars. */
function maskStrIn(s: string, re: RegExp, keep: number, label = "***"): string {
  return s.replace(re, (m) => {
    const head = m.slice(0, keep);
    return `${head}${label}`;
  });
}

/** Redact a single scalar string value. */
function redactString(v: string): string {
  let out = v;
  out = maskStrIn(out, EMAIL_RE, 2, "…@…");
  out = maskStrIn(out, TOKEN_RE, 6);
  out = maskStrIn(out, PHONE_RE, 3);
  return out;
}

/**
 * Recursively redact a plain value. Objects/arrays are cloned; known PII keys
 * are replaced with a marker; raw strings are scrubbed for embedded PII.
 */
export function redact<T>(value: T, key = "$root"): T {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item, i) => redact(item, `${key}[${i}]`)) as unknown as T;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (PII_KEYS.has(lower) || lower.includes("password") || lower.includes("token")) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v, `${key}.${k}`);
      }
    }
    return out as unknown as T;
  }

  return value;
}

/**
 * Remove query params that carry PII/tokens from a URL so they never reach logs.
 * Keeps the path so fetch logs remain useful for flow grouping.
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw, "http://local");
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (
        PII_KEYS.has(lower) ||
        lower.includes("token") ||
        lower.includes("key") ||
        lower.includes("code") ||
        lower.includes("session")
      ) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, redactString(url.searchParams.get(key) ?? ""));
      }
    }
    // Never expose host (internal routing) or credentials.
    url.host = "";
    url.username = "";
    url.password = "";
    // Rebuild a minimal "path?sanitized" string.
    const q = url.searchParams.toString();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return q ? `${path}?${q}` : path;
  } catch {
    // Non-parseable URL -> keep only leading path segment.
    return raw.split("?")[0] as string;
  }
}