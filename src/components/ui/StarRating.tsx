import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  showValue?: boolean;
  readonly?: boolean;
  onChange?: (value: number) => void;
  reviewCount?: number;
}

const STAR_LABELS = ["1 из 5", "2 из 5", "3 из 5", "4 из 5", "5 из 5"];

export function StarRating({
  value,
  showValue = false,
  readonly = true,
  onChange,
  reviewCount,
}: StarRatingProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-flex items-center"
        role={readonly ? "img" : "radiogroup"}
        aria-label={`Оценка ${value} из 5${readonly && reviewCount ? `, отзывов: ${reviewCount}` : ""}`}
      >
        {[1, 2, 3, 4, 5].map((s) => {
          const filled = value >= s - 0.25;
          const star = (
            <Star
              className={cn(
                "size-4",
                filled
                  ? "fill-amber-400 text-amber-400"
                  : "fill-muted text-muted-foreground",
              )}
              aria-hidden="true"
            />
          );
          if (readonly) {
            return <span key={s}>{star}</span>;
          }
          return (
            <button
              key={s}
              type="button"
              className="p-0.5 transition-transform hover:scale-110"
              role="radio"
              aria-checked={Math.round(value) === s}
              aria-label={`Поставить ${STAR_LABELS[s - 1]}`}
              onClick={() => onChange?.(s)}
            >
              {star}
            </button>
          );
        })}
      </span>
      {showValue ? (
        <span className="text-sm text-muted-foreground">{value.toFixed(1)}</span>
      ) : null}
    </span>
  );
}