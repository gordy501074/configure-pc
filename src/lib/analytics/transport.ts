// Transport: batches events, debounces the flush, applies sampling, delivers via
// sendBeacon with fetch fallback, and requeues failures for retry. Never throws.

import type { AnalyticsEventEnvelope } from "./types";
import type { TrackOptions } from "./events";
import { getQueue } from "./store";

const ENDPOINT = "/api/analytics";
const FLUSH_DEBOUNCE_MS = 5000;
const FLUSH_MAX_BATCH = 50;

interface TransportDeps {
  fetch?: typeof fetch;
  beacon?: (url: string, data: Blob | string | FormData) => boolean;
}

export class AnalyticsTransport {
  private deps: TransportDeps;
  private buffer: AnalyticsEventEnvelope[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: TransportDeps = {}) {
    this.deps = {
      fetch: deps.fetch ?? (typeof window !== "undefined" ? window.fetch.bind(window) : undefined),
      beacon:
        deps.beacon ??
        (typeof navigator !== "undefined" ? navigator.sendBeacon.bind(navigator) : undefined),
    };
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const flush = () => this.flush();
      window.addEventListener("beforeunload", flush);
      window.addEventListener("pagehide", flush);
    }
  }

  /** Sample a high-frequency event; returns false when it should be dropped. */
  private sampled(ev: AnalyticsEventEnvelope, options?: TrackOptions): boolean {
    if (options?.force) return true;
    if (ev.level === "error" || ev.level === "critical" || ev.level === "warn") return true;
    const weight = options?.weight ?? 1;
    if (weight <= 0) return false;
    return Math.random() < Math.min(1, weight);
  }

  enqueue(ev: AnalyticsEventEnvelope, options?: TrackOptions): void {
    if (!this.sampled(ev, options)) return;
    this.buffer.push(ev);
    if (options?.flush) {
      this.flushImmediately();
      return;
    }
    if (this.buffer.length >= FLUSH_MAX_BATCH) {
      this.flushImmediately();
      return;
    }
    this.schedule();
  }

  /** Debounced flush (keeps a timer so batched events coalesce). */
  schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushImmediately();
    }, FLUSH_DEBOUNCE_MS);
  }

  private flushImmediately(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.buffer.length);
      // Persist to offline queue before attempting delivery so nothing is lost
      // if the user navigates away mid-send.
      getQueue().push(batch);
      void this.send(batch);
    }
    // Attempt any previously queued events.
    const queued = getQueue().drain();
    if (queued.length > 0) void this.send(queued);
  }

  flush(): void {
    void this.flushImmediately();
  }

  private async send(batch: AnalyticsEventEnvelope[]): Promise<void> {
    const payload = JSON.stringify({ events: batch });
    const fallbackSend = async () => {
      if (!this.deps.fetch) return false;
      try {
        const res = await this.deps.fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
        return res.ok;
      } catch {
        return false;
      }
    };
    let ok = false;
    if (this.deps.beacon) {
      try {
        ok = this.deps.beacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
      } catch {
        ok = false;
      }
    }
    if (!ok && !this.deps.beacon) {
      ok = await fallbackSend();
    } else if (!ok) {
      // sendBeacon returned false (payload too large or throttled) -> use fetch.
      ok = await fallbackSend();
    }
    if (!ok) getQueue().requeue(batch);
  }
}

let sharedTransport: AnalyticsTransport | null = null;

export function getTransport(): AnalyticsTransport {
  if (!sharedTransport) sharedTransport = new AnalyticsTransport();
  return sharedTransport;
}

/** Test seam: reset the cached transport. */
export function resetTransportForTests(): void {
  sharedTransport = null;
}