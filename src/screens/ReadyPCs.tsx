import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import {
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "../components/ui";
import { ReadyPcCard } from "../components/shared/ReadyPcCard";
import { SellerPicker } from "../components/shared/SellerPicker";
import { fetchReadyPcs } from "../lib/api";
import { useSeller } from "../lib/useSeller";
import { USAGE_LABELS } from "../lib/format";
import { cn } from "../lib/utils";
import type { ReadyPc, Usage } from "../types";

type SortKey = "price-asc" | "price-desc" | "rating";

interface Filters {
  usage: Usage | "all";
  brand: string;
  min: string;
  max: string;
  sort: SortKey;
}

export default function ReadyPCs() {
  const [params, setParams] = useSearchParams();
  const [loadState, setLoadState] = useState<"loading" | "done">("loading");
  const [pcs, setPcs] = useState<ReadyPc[]>([]);
  const { sellerId, sellers, setSellerId, loading: sellerLoading } = useSeller();

  const [filters, setFilters] = useState<Filters>(() => ({
    usage: (params.get("usage") as Filters["usage"]) || "all",
    brand: params.get("brand") ?? "all",
    min: params.get("min") ?? "",
    max: params.get("max") ?? "",
    sort: (params.get("sort") as SortKey) || "price-asc",
  }));

  useEffect(() => {
    setLoadState("loading");
    let cancelled = false;
    fetchReadyPcs(sellerId).then((list) => {
      if (cancelled) return;
      setPcs(list);
      setLoadState("done");
    });
    return () => {
      cancelled = true;
    };
  }, [sellerId]);

  const BRANDS = useMemo(() => Array.from(new Set(pcs.map((p) => p.brand))), [pcs]);

  const filtered = useMemo(() => {
    let list = [...pcs];
    if (filters.usage !== "all") list = list.filter((p) => p.usage === filters.usage);
    if (filters.brand !== "all") list = list.filter((p) => p.brand === filters.brand);
    const min = Number(filters.min);
    if (!Number.isNaN(min) && filters.min !== "") list = list.filter((p) => p.price >= min);
    const max = Number(filters.max);
    if (!Number.isNaN(max) && filters.max !== "") list = list.filter((p) => p.price <= max);
    switch (filters.sort) {
      case "price-asc":
        list.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        list.sort((a, b) => b.price - a.price);
        break;
      case "rating":
        list.sort((a, b) => b.rating - a.rating);
        break;
    }
    return list;
  }, [pcs, filters]);

  const applyFilters = (next: Partial<Filters>) => {
    const merged = { ...filters, ...next };
    setFilters(merged);
    const sp = new URLSearchParams();
    if (merged.usage !== "all") sp.set("usage", merged.usage);
    if (merged.brand !== "all") sp.set("brand", merged.brand);
    if (merged.min) sp.set("min", merged.min);
    if (merged.max) sp.set("max", merged.max);
    if (merged.sort !== "price-asc") sp.set("sort", merged.sort);
    setParams(sp, { replace: true });
  };

  const reset = () => {
    applyFilters({ usage: "all", brand: "all", min: "", max: "", sort: "price-asc" });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    applyFilters({});
  };

  const hasCustomFilter =
    filters.min !== "" ||
    filters.max !== "" ||
    filters.usage !== "all" ||
    filters.brand !== "all";

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Готовые ПК" }]} />
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Готовые ПК</h1>
          <p className="mt-1 text-muted-foreground">
            Проверенные сборки под разные задачи и бюджеты.
          </p>
        </div>
        {!sellerLoading ? (
          <SellerPicker sellers={sellers} value={sellerId} onChange={setSellerId} />
        ) : null}
      </div>

      <Card className="mb-5 p-4">
        <form
          onSubmit={onSubmit}
          className="flex flex-wrap items-end gap-3"
        >
          <FilterField label="Сортировка" htmlFor="filter-sort">
            <Select
              value={filters.sort}
              onValueChange={(v) => applyFilters({ sort: v as SortKey })}
            >
              <SelectTrigger id="filter-sort" size="sm">
                <SelectValue placeholder="Сортировка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="price-asc">Сначала дешевле</SelectItem>
                <SelectItem value="price-desc">Сначала дороже</SelectItem>
                <SelectItem value="rating">По рейтингу</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Назначение" htmlFor="filter-usage">
            <Select
              value={filters.usage}
              onValueChange={(v) => applyFilters({ usage: v as Filters["usage"] })}
            >
              <SelectTrigger id="filter-usage" size="sm">
                <SelectValue placeholder="Все" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {(Object.keys(USAGE_LABELS) as Usage[]).map((u) => (
                  <SelectItem key={u} value={u}>
                    {USAGE_LABELS[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Бренд" htmlFor="filter-brand">
            <Select value={filters.brand} onValueChange={(v) => applyFilters({ brand: v })}>
              <SelectTrigger id="filter-brand" size="sm">
                <SelectValue placeholder="Все" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {BRANDS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <fieldset className="flex flex-col gap-1 border-0">
            <legend className="mb-1 text-sm font-semibold text-muted-foreground">
              Цена, ₽
            </legend>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                placeholder="от"
                value={filters.min}
                onChange={(e) => applyFilters({ min: e.target.value })}
                aria-label="Цена от"
              />
              <Input
                type="number"
                min={0}
                placeholder="до"
                value={filters.max}
                onChange={(e) => applyFilters({ max: e.target.value })}
                aria-label="Цена до"
              />
            </div>
          </fieldset>

          {hasCustomFilter ? (
            <Button variant="ghost" onClick={reset} className="self-end">
              Сбросить
            </Button>
          ) : null}
        </form>
      </Card>

      <div className="mb-3 min-h-6 text-sm text-muted-foreground" role="status">
        {loadState === "done" ? `Найдено: ${filtered.length}` : null}
      </div>

      {loadState === "loading" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-3 p-4">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-8 w-2/5" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          description="Попробуйте изменить или сбросить фильтры."
          actionLabel="Сбросить фильтры"
          onAction={reset}
        />
      ) : (
        <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
          {filtered.map((pc) => (
            <ReadyPcCard key={pc.id} pc={pc} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="mb-1 text-sm font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}