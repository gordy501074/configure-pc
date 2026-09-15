import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Skeleton,
  useToast,
} from "../components/ui";
import { ConfigPartsTable } from "../components/shared/ConfigPartsTable";
import { ReviewDialog } from "../components/shared/ReviewDialog";
import { InstallmentPlan } from "../components/shared/InstallmentPlan";
import { buildRecommendation, budgetTier } from "../lib/survey";
import { configStats } from "../lib/compatibility";
import { formatPrice, USAGE_LABELS, CATEGORY_LABELS } from "../lib/format";
import { saveConfigAction, shareAction } from "../lib/actions";
import { useAuth } from "../lib/auth";
import { fetchCatalog } from "../lib/api";
import { uid } from "../lib/session";
import type { ComponentCategory, Config, Part, SurveyAnswers } from "../types";

export default function AutoResult() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [loadState, setLoadState] = useState<"loading" | "done">("loading");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [catalog, setCatalog] = useState<Record<ComponentCategory, Part[]> | null>(null);
  const answers = (location.state as { answers?: SurveyAnswers } | null)?.answers;

  useEffect(() => {
    if (!answers) return;
    let cancelled = false;
    fetchCatalog().then((c) => {
      if (cancelled) return;
      setCatalog(c);
      setLoadState("done");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cfg: Config | null = useMemo(
    () => (answers && catalog ? buildRecommendation(answers, catalog) : null),
    [answers, catalog],
  );

  if (!answers) {
    return (
      <div className="container">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Автоподбор", to: "/auto" }]} />
        <EmptyState
          title="Нет данных для подбора"
          description="Пройдите опросник автоподбора, чтобы получить рекомендацию."
          actionLabel="К опроснику"
          onAction={() => navigate("/auto")}
        />
      </div>
    );
  }

  if (loadState === "loading" || !cfg) {
    return (
      <div className="container">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Автоподбор", to: "/auto" }]} />
        <Skeleton className="h-10 w-1/2" />
        <div className="mt-4 flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const stats = configStats({ parts: cfg.parts });

  const editInConfig = () => {
    navigate("/config", {
      state: {
        fromReady: {
          id: cfg.id,
          name: cfg.name,
          parts: cfg.parts,
          createdAt: cfg.createdAt,
          updatedAt: cfg.updatedAt,
          source: "auto",
        },
      },
    });
  };

  const checkout = () => {
    navigate("/checkout", {
      state: { orderTitle: cfg.name, total: stats.totalPrice, config: cfg },
    });
  };

  const handleSave = async () => {
    if (!user) {
      toast("Войдите, чтобы сохранить конфигурацию", "info");
      navigate("/auth");
      return;
    }
    const res = await saveConfigAction({ ...cfg, id: uid("cfg"), updatedAt: Date.now() }, user.id);
    toast(res.message);
  };

  const handleShare = async () => {
    const res = await shareAction(
      `${cfg.name} — ${formatPrice(stats.totalPrice)}`,
      window.location.href,
    );
    toast(res.message, res.ok ? "success" : "error");
  };

  return (
    <div className="container">
      <Breadcrumbs
        items={[
          { label: "Главная", to: "/" },
          { label: "Автоподбор", to: "/auto" },
          { label: "Рекомендация" },
        ]}
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{budgetTier(answers.budget)} сегмент</Badge>
            <Badge variant="info">{USAGE_LABELS[answers.usage]}</Badge>
            <Badge variant="neutral">
              Платформа {answers.ecosystem === "intel" ? "Intel" : "AMD"}
            </Badge>
          </div>
          <h1 className="text-3xl font-bold">{cfg.name}</h1>
          <p className="text-muted-foreground">
            Собрано под ваши приоритеты и бюджет{" "}
            {new Intl.NumberFormat("ru-RU").format(answers.budget)} ₽.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={checkout}>
            Оформить заказ · {formatPrice(stats.totalPrice)}
          </Button>
          <Button variant="secondary" size="lg" onClick={editInConfig}>
            Редактировать в конфигураторе
          </Button>
          <Button variant="ghost" onClick={handleSave}>
            Сохранить
          </Button>
          <Button variant="ghost" onClick={handleShare}>
            Поделиться
          </Button>
          <Button variant="ghost" onClick={() => setReviewOpen(true)}>
            Отзыв
          </Button>
        </div>

        <div className="max-w-sm">
          <InstallmentPlan total={stats.totalPrice} state={{ config: cfg }} />
        </div>

        <Card className="gap-4 p-4">
          <h2 className="text-lg font-semibold">Состав сборки</h2>
          <ConfigPartsTable parts={cfg.parts} />
        </Card>

        <Card className="gap-4 p-4">
          <h2 className="text-lg font-semibold">Сводка</h2>
          <div className="flex flex-col">
            {cfg.parts.map(({ category, part }) => (
              <div
                key={category}
                className="flex items-center justify-between gap-3 border-b py-2 text-sm"
              >
                <span className="text-muted-foreground">
                  {CATEGORY_LABELS[category] ?? category}
                </span>
                <span className="truncate font-medium">{part.name}</span>
                <span className="whitespace-nowrap">{formatPrice(part.price)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 py-2 font-semibold">
              <span>Итого</span>
              <span>{stats.totalTdp} Вт</span>
              <span>{formatPrice(stats.totalPrice)}</span>
            </div>
          </div>
        </Card>
      </div>

      <ReviewDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        entityId={`auto-${cfg.id}`}
        author={user?.name ?? "Гость"}
      />
    </div>
  );
}