// Automatic integrations: wire the telemetry façade into the host app without
// manual calls — router navigation, global error handlers, fetch performance and
// declarative `data-track` clicks/submits.

import { analytics } from "./track";
import { redact, redactUrl } from "./redact";

/** Tracked fetch metadata (no request/response bodies, no query param PII). */
export interface FetchLog {
  method: string;
  url: string; // path only, query redacted
  status: number | null;
  durationMs: number;
  ok: boolean;
}

/**
 * Wrap the network so every fetch is measured and logged. Applies only to app
 * API calls (same-origin /api) to avoid noise from analytics itself loop.
 */
export function instrumentFetch(
  fetchImpl: typeof fetch = window.fetch.bind(window),
): typeof fetch {
  return (input, init) => {
    const start = performance.now();
    const reqUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input?.url ?? "";
    const method = (init?.method ?? "GET").toUpperCase();
    const planned = !isAnalyticsSelf(reqUrl);

    const promise = fetchImpl(input, init)
      .then((res) => {
        if (planned) {
          logFetch({ method, url: redactUrl(reqUrl), status: res.status, durationMs: performance.now() - start, ok: res.ok });
        }
        return res;
      })
      .catch((err: unknown) => {
        if (planned) {
          logs.fetchError({ method, url: redactUrl(reqUrl), status: null, durationMs: performance.now() - start, ok: false, message: String((err as Error)?.message ?? err).slice(0, 200) });
        }
        throw err;
      });
    return promise;
  };
}

function isAnalyticsSelf(url: string): boolean {
  return url.includes("/api/analytics");
}

/** Event logs used by the integration — thin wrappers so `auto.ts` stays self-contained. */
export const logs = {
  fetchError(err: { method: string; url: string; status: number | null; durationMs: number; ok: boolean; message: string }) {
    analytics.trackRaw({ event: "fetch:fail", level: "warn", payload: { ...err } });
  },
};
export const logFetch = (meta: FetchLog) =>
  analytics.trackRaw({ event: meta.ok ? "fetch:call" : "fetch:error", level: meta.ok ? "debug" : "warn", payload: { ...meta } });

/** Call once from main.tsx after initAnalytics(). */
export function setupAutoIntegration(): () => void {
  const cleanups: Array<() => void> = [];

  // ---- Router / navigation ----
  let lastPath = location.pathname;

  const onRoute = () => {
    const path = location.pathname;
    if (path !== lastPath) {
      analytics.trackRaw({ event: "route:change", level: "info", payload: { from: lastPath, to: path } });
      lastPath = path;
    }
    analytics.trackRaw({ event: "page:view", level: "info", payload: { route: path } });
    analytics.setCurrentRoute(path);
  };
  window.addEventListener("popstate", onRoute);
  window.addEventListener("pushState", onRoute as EventListener);
  window.addEventListener("replaceState", onRoute as EventListener);
  onRoute();
  cleanups.push(() => {
    window.removeEventListener("popstate", onRoute);
    window.removeEventListener("pushState", onRoute as EventListener);
    window.removeEventListener("replaceState", onRoute as EventListener);
  });

  // ---- Global errors ----
  const onError = (event: ErrorEvent) => {
    analytics.trackRaw({
      event: "app:error",
      level: "error",
      payload: { message: redact(String(event.message).slice(0, 300)), file: event.filename?.slice(-120), line: event.lineno },
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    analytics.trackRaw({
      event: "app:critical",
      level: "critical",
      payload: { reason: redact(String(event.reason?.message ?? event.reason).slice(0, 300)) },
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  cleanups.push(() => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  });

  // ---- Declarative data-track clicks & submits ----
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const el = target?.closest?.("[data-track]") as HTMLElement | null;
    if (!el) return;
    const name = el.getAttribute("data-track");
    if (!name) return;
    let payload: Record<string, unknown> = {};
    const raw = el.getAttribute("data-track-payload-json");
    if (raw) {
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* ignore malformed */
      }
    }
    analytics.trackRaw({ event: "ui:click", level: "info", payload: { name, ...payload } });
  };
  const onSubmit = (e: SubmitEvent) => {
    const form = e.target as HTMLFormElement | null;
    if (!form) return;
    const name = form.getAttribute("data-track") || form.id || form.name || "unknown-form";
    analytics.trackRaw({ event: "ui:submit", level: "info", payload: { name, method: (form.method || "POST").toUpperCase() } });
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);
  cleanups.push(() => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("submit", onSubmit, true);
  });

  return () => cleanups.forEach((fn) => fn());
}

declare global {
  interface Window {
    pushState?: (data: unknown, unused: string, url?: string | URL | null) => void;
  }
}