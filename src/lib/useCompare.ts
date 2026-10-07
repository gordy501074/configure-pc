// Client-side "compare" selection list, persisted in localStorage so it
// survives navigation and reloads. The fake door only stores ids; the actual
// comparison page does not exist yet.

import { useCallback, useEffect, useMemo, useState } from "react";

export const MAX_COMPARE = 3;
export const COMPARE_STORAGE_KEY = "confi_compare_configs";

/**
 * Pure toggle: add `id` when absent, remove it when present. Adding beyond
 * `max` is a no-op (the list is returned unchanged).
 */
export function toggleCompare(list: string[], id: string, max = MAX_COMPARE): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (list.length >= max) return list;
  return [...list, id];
}

function readStored(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COMPARE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function writeStored(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* quota / privacy mode: keep the in-memory state only */
  }
}

export interface UseCompare {
  ids: string[];
  toggle: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  canCompare: boolean;
}

/**
 * Compare-selection state. When `validIds` is provided, ids that no longer
 * correspond to an existing configuration are pruned from the stored list.
 */
export function useCompare(validIds?: string[]): UseCompare {
  const [ids, setIds] = useState<string[]>(() => readStored());

  // Prune stale ids whenever the set of valid ids changes.
  const validKey = validIds ? validIds.join("|") : null;
  useEffect(() => {
    if (!validIds) return;
    setIds((prev) => {
      const next = prev.filter((id) => validIds.includes(id));
      if (next.length === prev.length) return prev;
      writeStored(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validKey]);

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = toggleCompare(prev, id);
      writeStored(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    writeStored([]);
  }, []);

  const selectedSet = useMemo(() => new Set(ids), [ids]);

  return {
    ids,
    toggle,
    clear,
    isSelected: (id: string) => selectedSet.has(id),
    canCompare: ids.length > 0,
  };
}