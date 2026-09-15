// Offline-queue: durable buffer for batched analytics events. Uses localStorage
// when available. Each entry tracks an attempt counter and enqueue timestamp so
// failed sends are retried with backoff and eventually pruned.

import type { AnalyticsEventEnvelope } from "./types";

const QUEUE_KEY = "confi_analytics_queue";
const DEFAULT_MAX_RETRIES = 5;
const QUEUE_TTL_MS = 24 * 60 * 60 * 1000; // drop events older than a day

interface QueueEntry {
  id: string;
  attempts: number;
  enqueuedAt: number;
  events: AnalyticsEventEnvelope[];
}

function loadQueue(storage: Storage | null): QueueEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as QueueEntry[];
  } catch {
    return [];
  }
}

function saveQueue(storage: Storage | null, queue: QueueEntry[]): void {
  if (!storage) return;
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, 200)));
  } catch {
    // Quota exceeded: drop oldest block silently is handled by pruning below.
  }
}

export interface AnalyticsQueue {
  push(events: AnalyticsEventEnvelope[]): void;
  /** Pull all queued entries with attempts left (FIFO), pruning expired. */
  drain(): AnalyticsEventEnvelope[];
  /** Mark a batch failed: increments attempts or removes when exhausted. */
  requeue(events: AnalyticsEventEnvelope[]): void;
  size(): number;
}

class LocalAnalyticsQueue implements AnalyticsQueue {
  private storage: Storage | null;
  private maxRetries: number;
  private seq = 0;

  constructor(storage: Storage | null, maxRetries = DEFAULT_MAX_RETRIES) {
    this.storage = storage;
    this.maxRetries = maxRetries;
  }

  private prune(queue: QueueEntry[], now = Date.now()): QueueEntry[] {
    return queue.filter((e) => {
      const expired = now - (e.enqueuedAt ?? now) > QUEUE_TTL_MS;
      const exhausted = (e.attempts ?? 0) >= this.maxRetries;
      return !expired && !exhausted;
    });
  }

  push(events: AnalyticsEventEnvelope[]) {
    if (events.length === 0) return;
    const queue = this.prune(loadQueue(this.storage));
    queue.push({
      id: `q${(this.seq++).toString(36)}-${Date.now().toString(36)}`,
      attempts: 0,
      enqueuedAt: Date.now(),
      events,
    });
    saveQueue(this.storage, queue);
  }

  drain(): AnalyticsEventEnvelope[] {
    const queue = this.prune(loadQueue(this.storage));
    if (queue.length === 0) return [];
    saveQueue(this.storage, []);
    return queue.flatMap((q) => q.events);
  }

  requeue(events: AnalyticsEventEnvelope[]) {
    if (events.length === 0) return;
    const queue = this.prune(loadQueue(this.storage));
    // Re-batch the failed events back into one entry with an incremented attempt.
    const last = queue.length > 0 ? queue[queue.length - 1] : undefined;
    queue.push({
      id: `q${(this.seq++).toString(36)}-${Date.now().toString(36)}`,
      attempts: (last?.attempts ?? 0) + 1,
      enqueuedAt: Date.now(),
      events,
    });
    saveQueue(this.storage, queue);
  }

  size() {
    return loadQueue(this.storage).reduce((n, q) => n + q.events.length, 0);
  }
}

/** No-op queue used when storage is unavailable (SSR / privacy mode). */
class NoopAnalyticsQueue implements AnalyticsQueue {
  push() {}
  drain() {
    return [];
  }
  requeue() {}
  size() {
    return 0;
  }
}

let shared: AnalyticsQueue | null = null;

export function getQueue(): AnalyticsQueue {
  if (shared) return shared;
  let storage: Storage | null = null;
  if (typeof window !== "undefined") {
    try {
      storage = window.localStorage;
      // Probe reachability.
      const k = "__confi_q_probe__";
      storage.setItem(k, "1");
      storage.removeItem(k);
    } catch {
      storage = null;
    }
  }
  shared = storage
    ? new LocalAnalyticsQueue(storage)
    : new NoopAnalyticsQueue();
  return shared;
}