// Typed analytics event catalog. Adding a new tracked action = add a name here
// (and its payload type) so the whole pipeline stays type-checked.

export type AnalyticsLevel = "debug" | "info" | "warn" | "error" | "critical";

/** Namespace of known events. String literals keep the wire format compact. */
export type AnalyticsEventName =
  | "app:init"
  | "app:error"
  | "app:critical"
  | "page:view"
  | "route:change"
  | "ui:click"
  | "ui:submit"
  | "ui:error-boundary"
  | "fetch:call"
  | "fetch:error"
  | "fetch:fail"
  | "session:signin"
  | "session:signout"
  | "checkout:start"
  | "checkout:complete";

/** Route name shown in the envelope & used to group telemetry by screens. */
export type TrackPayload = Record<string, unknown>;

export interface TrackOptions {
  /** Override the sampled-out decision (always send). */
  force?: boolean;
  /** Higher sample-rate weight; default 1.0 */
  weight?: number;
  /** Skip debounce and flush immediately. */
  flush?: boolean;
}