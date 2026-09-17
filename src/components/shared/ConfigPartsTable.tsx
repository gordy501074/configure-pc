import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
} from "../ui";
import { CATEGORY_LABELS, formatPrice } from "../../lib/format";
import { isPartAvailable } from "../../lib/compatibility";
import type { ConfigPart } from "../../types";

export function ConfigPartsTable({ parts }: { parts: ConfigPart[] }) {
  return (
    <Table>
      <TableCaption className="sr-only">Состав конфигурации</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Категория</TableHead>
          <TableHead>Компонент</TableHead>
          <TableHead className="text-right">Цена</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {parts.map(({ category, part }) => {
          const unavailable = !part || !isPartAvailable(part);
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
                  <TableCell>{part!.name}</TableCell>
                  <TableCell className="text-right">{formatPrice(part!.price)}</TableCell>
                </>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}