// Public telemetry façade. Exposes a typed, redacting, level-aware tracker that
// is safe to call from anywhere (guard: no-op unless enabled). All events flow
// through the transport (batching/sampling/offline queue) and get persisted to
// the /api/analytics endpoint on the SQLite backend.

import type {
  AnalyticsEventEnvelope,
  TrackInput,
} from "./types";
import type { AnalyticsEventName, AnalyticsLevel, TrackOptions } from "./events";
import { redact, redactUrl } from "./redact";
import { getTransport, type AnalyticsTransport } from "./transport";
import { getSessionId } from "../session";

const STORAGE_ANON_ID = "confi_analytics_anon_id";
const STORAGE_OPTOUT = "confi_analytics_disabled";
const BUILD = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "dev";

function isEnabled(): boolean {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_OPTOUT) !== "1";
  } catch {
    return true;
  }
}

/** Deterministic SHA-256 fingerprint so raw ids never hit the wire. */
async function fingerprint(value: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(`confi|${value}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    // crypto.subtle unavailable (insecure context): fall back to a cheap hash.
    let h = 0;
    for (let i = 0; i < value.length; i++) {
      h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
    }
    return `h${(h >>> 0).toString(16)}`;
  }
}

function anonymousId(): string {
  try {
    let id = localStorage.getItem(STORAGE_ANON_ID);
    if (!id) {
      id = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(STORAGE_ANON_ID, id);
    }
    return id;
  } catch {
    return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export interface Analytics {
  /** Enable/disable the pipeline (persist via opt-out storage). */
  enabled(): boolean;
  setEnabled(v: boolean): void;
  track(event: AnalyticsEventName, payload?: Record<string, unknown>, options?: TrackOptions): void;
  /** Fire a typed event using the higher-level input shape. */
  trackRaw(input: TrackInput): void;
  /** Flush any buffered events immediately. */
  flush(): void;
  /** Current route captured by the declarative integration (set elsewhere). */
  getCurrentRoute(): string;
  setCurrentRoute(route: string): void;
  _transport(): AnalyticsTransport | null;
}

let userId: string | null = null;
let sessionId: string | null = null;
let currentRoute = "/";
let transport: AnalyticsTransport | null = null;

export function initAnalytics(): Analytics {
  if (transport) return analytics;
  sessionId = getSessionId();
  const rawUser = sessionId ?? anonymousId();
  void fingerprint(rawUser).then((h) => (userId = h));
  transport = getTransport();
  return analytics;
}

async function buildEnvelope(
  event: AnalyticsEventName,
  level: AnalyticsLevel,
  payload: Record<string, unknown>,
): Promise<AnalyticsEventEnvelope> {
  const raw = sessionId ?? userId ?? anonymousId();
  const id = userId ?? (await fingerprint(raw));
  return {
    ts: new Date().toISOString(),
    sessionId,
    userId: id,
    event,
    level,
    route: currentRoute,
    payload: redact(payload),
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
    build: BUILD,
  };
}

function track(
  event: AnalyticsEventName,
  payload: Record<string, unknown> = {},
  options: TrackOptions = {},
): void {
  if (!isEnabled()) return;
  const t = getTransport();
  void buildEnvelope(event, "info", payload).then((env) => t.enqueue(env, options));
}

function trackRaw(input: TrackInput): void {
  if (!isEnabled()) return;
  const t = getTransport();
  const level = input.level ?? "info";
  void buildEnvelope(input.event, level, input.payload ?? {}).then((env) =>
    t.enqueue(env, input.options),
  );
}

export const analytics: Analytics = {
  enabled: isEnabled,
  setEnabled(v) {
    try {
      if (v) localStorage.removeItem(STORAGE_OPTOUT);
      else localStorage.setItem(STORAGE_OPTOUT, "1");
    } catch {
      /* ignore */
    }
  },
  track,
  trackRaw,
  flush: () => {
    if (transport) transport.flush(); else getTransport().flush();
  },
  getCurrentRoute: () => currentRoute,
  setCurrentRoute: (route) => {
    currentRoute = redactUrl(route);
  },
  _transport: () => transport,
};

export function trackView(route: string): void {
  if (!isEnabled()) return;
  currentRoute = redactUrl(route);
  track("page:view", { route: currentRoute });
}

export function trackRouteChange(from: string, to: string): void {
  if (!isEnabled()) return;
  const safeTo = redactUrl(to);
  currentRoute = safeTo;
  track("route:change", { from: redactUrl(from), to: safeTo });
}

export { redactUrl, BUILD };