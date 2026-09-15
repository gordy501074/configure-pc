import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui";
import { CATEGORY_LABELS, formatPrice } from "../../lib/format";
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
        {parts.map(({ category, part }) => (
          <TableRow key={category}>
            <TableCell>{CATEGORY_LABELS[category] ?? category}</TableCell>
            <TableCell>{part.name}</TableCell>
            <TableCell className="text-right">{formatPrice(part.price)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}