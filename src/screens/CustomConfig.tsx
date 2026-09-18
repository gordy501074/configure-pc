import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Input,
  Skeleton,
  useToast,
} from "../components/ui";
import { ComponentPicker } from "../components/shared/ComponentPicker";
import { SellerPicker } from "../components/shared/SellerPicker";
import { ReviewDialog } from "../components/shared/ReviewDialog";
import { InstallmentPlan } from "../components/shared/InstallmentPlan";
import { CATEGORY_LABELS, formatPrice, formatWatts } from "../lib/format";
import { configStats, validateConfig, isConfigComplete } from "../lib/compatibility";
import { saveConfigAction, shareAction } from "../lib/actions";
import { useAuth } from "../lib/auth";
import { useSeller } from "../lib/useSeller";
import { uid } from "../lib/session";
import type { ComponentCategory, Config, Part } from "../types";

const CATEGORY_ORDER: ComponentCategory[] = [
  "cpu",
  "gpu",
  "motherboard",
  "ram",
  "storage",
  "case",
  "psu",
  "cooler",
];

const EMPTY_CHOSEN: Record<ComponentCategory, Part | null> = {
  cpu: null,
  gpu: null,
  motherboard: null,
  ram: null,
  storage: null,
  case: null,
  psu: null,
  cooler: null,
};

export default function CustomConfig() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { user, isCustomer } = useAuth();
  const { sellerId, sellers, setSellerId, loading: sellerLoading } = useSeller();

  const [chosen, setChosen] = useState<Record<ComponentCategory, Part | null>>({
    ...EMPTY_CHOSEN,
  });
  const [pickerCat, setPickerCat] = useState<ComponentCategory | null>(null);
  const [name, setName] = useState("Моя сборка");
  const [loadState, setLoadState] = useState<"loading" | "done">("loading");
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    setLoadState("loading");
    const t = window.setTimeout(() => {
      const fromReady = (location.state as { fromReady?: Config } | null)?.fromReady;
      if (fromReady) {
        const next: Record<ComponentCategory, Part | null> = { ...EMPTY_CHOSEN };
        for (const { category, part } of fromReady.parts) {
          if (part) next[category] = part;
        }
        setChosen(next);
        setName(`${fromReady.name} — копия`);
        window.history.replaceState({}, "");
      }
      setLoadState("done");
    }, 300);
    return () => window.clearTimeout(t);
  }, [location.state]);

  const stats = useMemo(
    () =>
      configStats({
        parts: Object.values(chosen)
          .filter((p): p is Part => !!p)
          .map((p) => ({ category: p.category, part: p })),
      }),
    [chosen],
  );
  const issues = useMemo(() => validateConfig(chosen), [chosen]);
  const complete = useMemo(() => isConfigComplete(chosen), [chosen]);
  const filledCount = useMemo(
    () => CATEGORY_ORDER.filter((c) => chosen[c] !== null).length,
    [chosen],
  );

  const selectPart = (category: ComponentCategory, part: Part) => {
    setChosen((prev) => ({ ...prev, [category]: part }));
    setPickerCat(null);
    toast(`Выбрано: ${part.name}`, "info");
  };

  const removePart = (category: ComponentCategory) => {
    setChosen((prev) => ({ ...prev, [category]: null }));
  };

  const buildConfig = (): Config => ({
    id: uid("cfg"),
    name: name.trim() || "Моя сборка",
    parts: CATEGORY_ORDER.filter((c) => chosen[c]).map((c) => ({
      category: c,
      part: chosen[c]!,
      price: chosen[c]!.price,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: "custom",
    sellerId,
  });

  const handleSave = async () => {
    if (!complete) {
      toast("Заполните все категории без ошибок совместимости", "error");
      return;
    }
    if (!user) {
      toast("Войдите, чтобы сохранить конфигурацию", "info");
      navigate("/auth");
      return;
    }
    const config = buildConfig();
    const res = await saveConfigAction(config, user.id);
    toast(res.message);
  };

  const checkout = () => {
    if (!complete) {
      toast("Сначала соберите корректную конфигурацию", "error");
      return;
    }
    const config = buildConfig();
    navigate("/checkout", {
      state: {
        orderTitle: name,
        total: stats.totalPrice,
        config,
      },
    });
  };

  const handleShare = async () => {
    const res = await shareAction(
      `${name} — ${formatPrice(stats.totalPrice)}`,
      window.location.href,
    );
    toast(res.message, res.ok ? "success" : "error");
  };

  if (loadState === "loading") {
    return (
      <div className="container">
        <Skeleton className="h-10 w-2/5" />
        <div className="mt-4 flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Конфигуратор" }]} />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Конфигуратор</h1>
          <p className="mt-1 text-muted-foreground">
            Выбирайте компоненты — несовместимые блокируются автоматически.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleShare}>
            Поделиться
          </Button>
          {isCustomer ? (
            <Button variant="secondary" onClick={() => setReviewOpen(true)}>
              Отзыв
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
        <section className="flex flex-col gap-4" aria-label="Компоненты конфигурации">
          {CATEGORY_ORDER.map((cat) => {
            const part = chosen[cat];
            const catIssues = issues.filter((i) => i.category === cat);
            return (
              <Card key={cat} className="gap-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{CATEGORY_LABELS[cat]}</span>
                  {part ? (
                    <Button variant="ghost" size="sm" onClick={() => removePart(cat)}>
                      Убрать
                    </Button>
                  ) : null}
                </div>

                {part ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{part.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {formatWatts(part.tdp)}
                      </span>
                    </div>
                    <span className="whitespace-nowrap font-semibold">
                      {formatPrice(part.price ?? 0)}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Компонент не выбран.</p>
                )}

                {catIssues.length > 0 ? (
                  <div className="flex flex-col gap-1" role="alert">
                    {catIssues.map((iss, i) => (
                      <p key={i} className="flex items-center gap-2 text-sm text-destructive">
                        <Badge variant="destructive">Проблема</Badge> {iss.reason}
                      </p>
                    ))}
                  </div>
                ) : null}

                <Button
                  variant="secondary"
                  onClick={() => setPickerCat(cat)}
                  className="w-full"
                >
                  {part ? "Заменить" : `Выбрать ${CATEGORY_LABELS[cat].toLowerCase()}`}
                </Button>
              </Card>
            );
          })}
        </section>

        <aside className="flex flex-col" aria-label="Сводка">
          <Card className="sticky top-20 flex-col gap-3 p-4">
            {!sellerLoading ? (
              <SellerPicker sellers={sellers} value={sellerId} onChange={setSellerId} />
            ) : null}
            <h2 className="text-lg font-semibold">Сводка</h2>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Компонентов</span>
              <span>
                {filledCount} / {CATEGORY_ORDER.length}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Потребление</span>
              <span>{formatWatts(stats.totalTdp)}</span>
            </div>
            <div className="flex justify-between border-t pt-3">
              <span className="font-semibold">Итого</span>
              <span className="font-bold">{formatPrice(stats.totalPrice)}</span>
            </div>

            {!complete ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {filledCount < CATEGORY_ORDER.length
                  ? "Заполните все категории."
                  : "Есть ошибки совместимости."}
              </div>
            ) : null}

            <Input
              value={name}
              aria-label="Название сборки"
              placeholder="Название сборки"
              onChange={(e) => setName(e.target.value)}
            />

            {complete && isCustomer ? (
              <InstallmentPlan
                total={stats.totalPrice}
                state={{
                  orderTitle: name,
                  config: buildConfig(),
                }}
              />
            ) : null}

            {isCustomer ? (
              <>
                <Button size="lg" disabled={!complete} onClick={checkout}>
                  Оформить заказ
                </Button>
                <Button variant="secondary" disabled={!complete} onClick={handleSave}>
                  Сохранить в профиль
                </Button>
              </>
            ) : null}
          </Card>
        </aside>
      </div>

      {pickerCat ? (
        <ComponentPicker
          open
          onClose={() => setPickerCat(null)}
          category={pickerCat}
          chosen={chosen}
          onSelect={(p) => selectPart(pickerCat, p)}
          sellerId={sellerId}
        />
      ) : null}

      {isCustomer ? (
      <ReviewDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        entityId="custom-config"
        author={user?.name ?? "Гость"}
      />
    ) : null}
    </div>
  );
}