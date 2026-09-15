// Shared types for the analytics envelope and options. Kept separate so client
// and (for reference) server layers agree on the wire shape.

import type { AnalyticsEventName, AnalyticsLevel, TrackOptions } from "./events";

export interface AnalyticsEventEnvelope {
  ts: string;
  sessionId: string | null;
  userId: string | null;
  event: AnalyticsEventName;
  level: AnalyticsLevel;
  route: string;
  payload: Record<string, unknown>;
  ua: string;
  build: string;
}

/** Raw input to `track()` before redaction/envelope assembly. */
export interface TrackInput {
  event: AnalyticsEventName;
  level?: AnalyticsLevel;
  payload?: Record<string, unknown>;
  options?: TrackOptions;
}