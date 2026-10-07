import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { analytics } from "../../lib/analytics/track";
import { formatPrice } from "../../lib/format";
import {
  INSTALLMENT_SCHEMES,
  installmentSchemeKey,
  pickInstallmentScheme,
} from "../../lib/installmentAb";
import { ComingSoonDialog } from "./ComingSoonDialog";

/**
 * Fake door for the upcoming Alpha-Bank installment schemes (20/6 and 50/12).
 * Only one scheme is shown per visitor, deterministically chosen by
 * session/anonymous id. The click opens a «Скоро» modal and tracks the click
 * via `data-track`; the impression is tracked on mount via `fake-door:impression`.
 */
export function InstallmentFakeDoor({ total }: { total: number }) {
  const [open, setOpen] = useState(false);
  const tracked = useRef(false);

  const scheme = useMemo(() => {
    const id = pickInstallmentScheme(installmentSchemeKey());
    return INSTALLMENT_SCHEMES[id];
  }, []);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    // Track the single shown scheme. Deduped via ref so StrictMode (dev)
    // doesn't double-count the impression.
    analytics.trackRaw({
      event: "fake-door:impression",
      level: "info",
      payload: { name: scheme.fakeDoorId },
    });
  }, [scheme]);

  const prepay = total > 0 ? Math.round((total * scheme.prepayPct) / 100) : 0;
  const monthly = total > 0 ? Math.round((total - prepay) / scheme.months) : 0;

  const openDialog = () => setOpen(true);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        data-track={scheme.fakeDoorId}
        onClick={openDialog}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDialog();
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
              {scheme.title}
            </span>
            <span className="text-xs text-muted-foreground">
              от Альфа-Банка · {scheme.prepayPct}% предоплаты, 0 переплат
            </span>
          </div>
        </div>

        {total > 0 ? (
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                Предоплата {scheme.prepayPct}%
              </span>
              <span className="text-xs font-semibold text-foreground">
                {formatPrice(prepay)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {scheme.months} мес · оплата
              </span>
              <span className="text-xs font-semibold text-foreground">
                {formatPrice(monthly)}/мес
              </span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Рассрочка от Альфа-Банка — скоро для этой сборки.
          </p>
        )}

        <p className="text-[11px] leading-snug text-muted-foreground">
          {scheme.prepayPct}% предоплаты, 0 переплат, {scheme.months} месяцев. Уже скоро!
        </p>
      </div>

      <ComingSoonDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Схема рассрочки скоро появится"
        description="Мы готовим новые схемы рассрочки от Альфа-Банка. Скоро вы сможете ими воспользоваться."
      />
    </>
  );
}