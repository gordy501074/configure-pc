import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard } from "lucide-react";
import { formatPrice } from "../../lib/format";

const MONTH_NAMES = [
  "Янв",
  "Фев",
  "Мар",
  "Апр",
  "Май",
  "Июн",
  "Июл",
  "Авг",
  "Сен",
  "Окт",
  "Ноя",
  "Дек",
];

function monthLabel(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function paymentOf(total: number, index: number, count: number): number {
  if (index === count - 1) {
    return total - Math.floor(total / count) * (count - 1);
  }
  return Math.floor(total / count);
}

export function InstallmentPlan({
  total,
  state: payload,
}: {
  total: number;
  state?: Record<string, unknown>;
}) {
  const navigate = useNavigate();
  const count = 4;
  const payments = useMemo(
    () => Array.from({ length: count }, (_, i) => paymentOf(total, i, count)),
    [total, count],
  );

  if (total <= 0) return null;

  const go = () =>
    navigate("/alpha", {
      state: { orderTitle: "Рассрочка", total, ...payload },
    });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-3 transition-colors hover:border-red-400 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:hover:border-red-700 dark:hover:bg-red-950/60"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white">
          <CreditCard className="h-4 w-4" />
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-tight text-foreground">
            Купить в рассрочку на 4 месяца
          </span>
          <span className="text-xs text-muted-foreground">
            от Альфа-Банка · без переплат
          </span>
        </div>
      </div>

      <div className="flex h-2 w-full gap-1" aria-hidden="true">
        {payments.map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-full bg-red-500"
            style={{
              opacity: 1 - i * 0.22,
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center">
        {payments.map((p, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {monthLabel(i + 1)}
            </span>
            <span className="text-xs font-semibold text-foreground">
              {formatPrice(p)}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Разделим сумму на 4 равные части: каждый месяц по{" "}
        <strong className="text-foreground">
          {formatPrice(Math.round(total / 4))}
        </strong>{" "}
        начиная со следующего месяца.
      </p>
    </div>
  );
}