import { useEffect, useState } from "react";

import { Badge, Button, Modal, Skeleton } from "../ui";
import { fetchParts } from "../../lib/api";
import { CATEGORY_LABELS, formatPrice, formatWatts } from "../../lib/format";
import { checkPartCompatibility } from "../../lib/compatibility";
import type { ComponentCategory, Part } from "../../types";

interface ComponentPickerProps {
  open: boolean;
  onClose: () => void;
  category: ComponentCategory;
  chosen: Record<ComponentCategory, Part | null>;
  onSelect: (part: Part) => void;
}

export function ComponentPicker({
  open,
  onClose,
  category,
  chosen,
  onSelect,
}: ComponentPickerProps) {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setParts([]);
    fetchParts(category).then((list) => {
      if (cancelled) return;
      setParts(list);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, category]);

  if (!open) return null;

  const incompat = (p: Part) =>
    checkPartCompatibility(p, { ...chosen, [category]: p });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Выбор: ${CATEGORY_LABELS[category] ?? category}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        {loading || parts.length === 0 ? (
          <Skeleton className="h-[60px] w-full" />
        ) : (
          parts.map((p) => {
            const issues = incompat(p);
            const blocked = issues.length > 0;
            return (
              <div key={p.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  className={
                    blocked
                      ? "flex w-full items-center justify-between gap-3 rounded-md border border-destructive/60 px-3 py-3 text-left opacity-60"
                      : "flex w-full items-center justify-between gap-3 rounded-md border border-input px-3 py-3 text-left transition-colors hover:border-ring hover:bg-accent/50"
                  }
                  aria-disabled={blocked ? "true" : undefined}
                  onClick={() => !blocked && onSelect(p)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="text-sm text-muted-foreground">{p.brand}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end text-sm">
                    <span className="font-semibold">{formatPrice(p.price)}</span>
                    <span className="text-muted-foreground">{formatWatts(p.tdp)}</span>
                  </span>
                  {blocked ? <Badge variant="destructive">Несовместимо</Badge> : null}
                </button>
                {blocked ? (
                  <p className="px-1 text-sm text-destructive">
                    <span aria-hidden="true">⚠ </span>
                    {issues[0]}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <p className="mt-4 text-sm text-muted-foreground" role="note">
        <Badge variant="destructive">Несовместимо</Badge> — компоненты, которые не
        подходят к уже выбранным.
      </p>
    </Modal>
  );
}