import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui";
import type { SellerSummary } from "../../types";

interface SellerPickerProps {
  sellers: SellerSummary[];
  value: string;
  onChange: (id: string) => void;
}

export function SellerPicker({ sellers, value, onChange }: SellerPickerProps) {
  const selected = sellers.find((s) => s.id === value);
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-sm font-semibold text-muted-foreground">
        Продавец
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label="Продавец" className="w-fit">
          <SelectValue placeholder="Выберите продавца" />
        </SelectTrigger>
        <SelectContent>
          {sellers.length === 0 ? (
            <SelectItem value={value} disabled>
              {selected?.name ?? "Нет продавцов"}
            </SelectItem>
          ) : (
            sellers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.company || s.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}