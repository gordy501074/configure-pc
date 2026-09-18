import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "./Table";
import { cn } from "../../lib/utils";
import type { SortState } from "../../lib/useSort";

interface SortableThProps {
  label: string;
  column: string;
  sort: SortState | null;
  onSort: (column: string) => void;
  className?: string;
  align?: "left" | "right";
}

/** A clickable table-header cell that toggles ascending/descending sort on its column. */
export function SortableTh({
  label,
  column,
  sort,
  onSort,
  className,
  align = "left",
}: SortableThProps) {
  const active = sort?.key === column;
  const Icon = !active ? ChevronsUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={cn(align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
          align === "right" && "flex-row-reverse",
        )}
        title={`Сортировать по: ${label}`}
        aria-sort={
          active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"
        }
      >
        {label}
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
    </TableHead>
  );
}