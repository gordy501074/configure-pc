// A/B assignment for the installment fake door. Each visitor deterministically
// sees exactly one scheme (based on a stable string key — the session/anonymous
// id), so bucket assignment survives reloads and navigation.

import { getSessionId } from "./session.ts";

export type InstallmentSchemeId = "20-6" | "50-12";

export interface InstallmentScheme {
  id: InstallmentSchemeId;
  /** Fake door id tracked on click (`data-track` / analytics name). */
  fakeDoorId: string;
  prepayPct: number;
  months: number;
  title: string;
}

export const INSTALLMENT_SCHEMES: Record<InstallmentSchemeId, InstallmentScheme> = {
  "20-6": {
    id: "20-6",
    fakeDoorId: "fake_door_installment_20_6",
    prepayPct: 20,
    months: 6,
    title: "Рассрочка на 6 месяцев",
  },
  "50-12": {
    id: "50-12",
    fakeDoorId: "fake_door_installment_50_12",
    prepayPct: 50,
    months: 12,
    title: "Рассрочка на 12 месяцев",
  },
};

const SCHEME_IDS: InstallmentSchemeId[] = ["20-6", "50-12"];

/** FNV-1a 32-bit hash (pure). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic bucket: even hash -> "20-6", odd -> "50-12". */
export function pickInstallmentScheme(key: string): InstallmentSchemeId {
  const h = fnv1a(String(key ?? ""));
  return SCHEME_IDS[h % 2]!;
}

/** Resolve the assignment key: session cookie first, anon id fallback. */
export function installmentSchemeKey(): string {
  if (typeof window === "undefined") return "";
  const fromSession = getSessionId();
  if (fromSession) return fromSession;
  try {
    return window.localStorage.getItem("confi_analytics_anon_id") ?? "";
  } catch {
    return "";
  }
}