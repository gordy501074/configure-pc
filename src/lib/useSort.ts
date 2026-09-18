import { useCallback, useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

/**
 * Reusable column-sort state for tabular lists.
 * `toggle(key)` sets the column (ascending first) or flips the direction.
 */
export function useSort(initial?: SortState) {
  const [sort, setSort] = useState<SortState | null>(initial ?? null);

  const toggle = useCallback((key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears sorting
    });
  }, []);

  /** Return a sorted copy of `rows` using a per-row value accessor. */
  const sorted = useMemo(
    () =>
      function sortRows<T>(rows: T[], valueOf: (row: T) => unknown): T[] {
        if (!sort) return rows;
        const val = (row: T): string | number => {
          const v = valueOf(row) as string | number | null | undefined;
          return v ?? "";
        };
        const copy = [...rows];
        copy.sort((a, b) => {
          const av = val(a);
          const bv = val(b);
          const cmp =
            typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av).localeCompare(String(bv), "ru");
          return sort.dir === "asc" ? cmp : -cmp;
        });
        return copy;
      },
    [sort],
  );

  return { sort, toggle, sorted };
}