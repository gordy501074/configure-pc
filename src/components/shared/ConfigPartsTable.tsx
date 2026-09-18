import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHeader,
  TableRow,
  Badge,
} from "../ui";
import { SortableTh } from "../ui/SortableTh";
import { CATEGORY_LABELS, formatPrice } from "../../lib/format";
import { isPartAvailable, isPriceStale } from "../../lib/compatibility";
import { useSort } from "../../lib/useSort";
import type { ConfigPart } from "../../types";

export function ConfigPartsTable({
  parts,
  showStale = false,
}: {
  parts: ConfigPart[];
  showStale?: boolean;
}) {
  const { sort, toggle, sorted } = useSort();
  const rows = sorted(parts, (cp: ConfigPart) => {
    switch (sort?.key) {
      case "category": return CATEGORY_LABELS[cp.category] ?? cp.category;
      case "name": return cp.part?.name ?? "";
      case "price": return cp.part?.price ?? cp.price ?? 0;
      default: return CATEGORY_LABELS[cp.category] ?? cp.category;
    }
  });

  return (
    <Table>
      <TableCaption className="sr-only">Состав конфигурации</TableCaption>
      <TableHeader>
        <TableRow>
          <SortableTh label="Категория" column="category" sort={sort} onSort={toggle} />
          <SortableTh label="Компонент" column="name" sort={sort} onSort={toggle} />
          <SortableTh label="Цена" column="price" sort={sort} onSort={toggle} align="right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ category, part, price, currentPrice }) => {
          const unavailable = !part || !isPartAvailable(part);
          const stale = showStale && !!price && isPriceStale(price, currentPrice);
          return (
            <TableRow key={category}>
              <TableCell>{CATEGORY_LABELS[category] ?? category}</TableCell>
              {unavailable ? (
                <>
                  <TableCell>
                    <Badge variant="destructive">
                      Компонент более недоступен для заказа
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                </>
              ) : (
                <>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{part!.name}</span>
                      {stale ? (
                        <Badge variant="warning">Цена может быть неактуальной</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {part!.price !== undefined ? formatPrice(part!.price) : "—"}
                  </TableCell>
                </>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}