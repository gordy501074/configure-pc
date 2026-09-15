import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Skeleton,
  StarRating,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "../components/ui";
import { ConfigPartsTable } from "../components/shared/ConfigPartsTable";
import { ReviewDialog } from "../components/shared/ReviewDialog";
import { InstallmentPlan } from "../components/shared/InstallmentPlan";
import { readyPcs, seededReviews } from "../data/mock";
import { formatPrice, USAGE_LABELS, formatAgo } from "../lib/format";
import { saveConfigAction, shareAction, listReviews } from "../lib/actions";
import { useAuth } from "../lib/auth";
import { configStats } from "../lib/compatibility";
import { uid } from "../lib/storage";
import type { Review } from "../types";

export default function PcCard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [loadState, setLoadState] = useState<"loading" | "done">("loading");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const pc = useMemo(() => readyPcs.find((p) => p.id === id), [id]);

  useEffect(() => {
    setLoadState("loading");
    const t = window.setTimeout(() => {
      setLoadState("done");
      setReviews(listReviews(id ?? ""));
    }, 300);
    return () => window.clearTimeout(t);
  }, [id]);

  const allReviews = useMemo(() => {
    const map = new Map<string, Review>();
    for (const r of [...seededReviews, ...reviews]) map.set(r.id, r);
    return Array.from(map.values()).filter((r) => r.entityId === id);
  }, [reviews, id]);

  if (loadState === "loading") {
    return (
      <div className="container">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Готовые ПК", to: "/ready" }]} />
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="mt-2 h-64 w-full" />
      </div>
    );
  }

  if (!pc) {
    return (
      <div className="container">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Готовые ПК", to: "/ready" }]} />
        <EmptyState
          title="Сборка не найдена"
          description="Возможно, она была удалена или ссылка устарела."
          actionLabel="К каталогу"
          onAction={() => navigate("/ready")}
        />
      </div>
    );
  }

  const stats = configStats({ parts: pc.parts });
  const avgRating =
    allReviews.length > 0
      ? allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length
      : pc.rating;

  const configureFromTemplate = () => {
    const cfgId = uid("cfg");
    const config = {
      id: cfgId,
      name: `${pc.name} (копия)`,
      parts: pc.parts,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: "ready" as const,
      usage: pc.usage,
    };
    navigate(`/config?load=${cfgId}`, { state: { fromReady: config } });
  };

  const checkout = () => {
    navigate("/checkout", {
      state: {
        orderTitle: pc.name,
        total: stats.totalPrice,
        line: { kind: "ready", refId: pc.id, name: pc.name, price: stats.totalPrice, count: 1 },
      },
    });
  };

  const handleSave = () => {
    if (!user) {
      toast("Войдите, чтобы сохранить конфигурацию", "info");
      navigate("/auth");
      return;
    }
    const res = saveConfigAction({
      id: uid("cfg"),
      name: pc.name,
      parts: pc.parts,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: "ready",
      usage: pc.usage,
    });
    toast(res.message);
  };

  const handleShare = async () => {
    const res = await shareAction(
      `${pc.name} — ${formatPrice(pc.price)}`,
      window.location.href,
    );
    toast(res.message, res.ok ? "success" : "error");
  };

  return (
    <div className="container">
      <Breadcrumbs
        items={[
          { label: "Главная", to: "/" },
          { label: "Готовые ПК", to: "/ready" },
          { label: pc.name },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
        <section className="flex flex-col gap-5" aria-labelledby="pc-name">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant={pc.inStock ? "success" : "neutral"}>
                {pc.inStock ? "В наличии" : "Под заказ"}
              </Badge>
              <Badge variant="info">{USAGE_LABELS[pc.usage] ?? pc.usage}</Badge>
              <Badge variant="secondary">TDP {pc.tdp} Вт</Badge>
            </div>
            <h1 id="pc-name" className="text-3xl font-bold">
              {pc.name}
            </h1>
            <StarRating value={avgRating} showValue reviewCount={allReviews.length} />
            <p className="text-muted-foreground">{pc.summary}</p>
          </div>

          <Card className="gap-4 p-4">
            <h2 className="text-lg font-semibold">Состав сборки</h2>
            <ConfigPartsTable parts={pc.parts} />
          </Card>

          <Card className="gap-4 p-4">
            <h2 className="text-lg font-semibold">Характеристики</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Параметр</TableHead>
                  <TableHead>Значение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pc.specs.map((s) => (
                  <TableRow key={s.label}>
                    <TableCell>{s.label}</TableCell>
                    <TableCell>{s.value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>

        <aside className="flex flex-col" aria-label="Покупка">
          <Card className="sticky top-20 flex-col gap-3 p-4">
            <span className="text-3xl font-bold text-foreground">
              {formatPrice(stats.totalPrice)}
            </span>
            <span className="mb-2 text-sm text-muted-foreground">
              Потребление: {stats.totalTdp} Вт
            </span>
            <InstallmentPlan
              total={stats.totalPrice}
              state={{
                orderTitle: pc.name,
                line: {
                  kind: "ready",
                  refId: pc.id,
                  name: pc.name,
                  price: stats.totalPrice,
                  count: 1,
                },
              }}
            />
            <Button size="lg" onClick={checkout}>
              Оформить заказ
            </Button>
            <Button variant="secondary" onClick={configureFromTemplate}>
              Настроить в конфигураторе
            </Button>
            <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
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
          </Card>
        </aside>
      </div>

      <section className="mt-6 flex flex-col gap-4" aria-labelledby="reviews-title">
        <h2 id="reviews-title" className="text-lg font-semibold">
          Отзывы ({allReviews.length})
        </h2>
        {allReviews.length === 0 ? (
          <p className="text-muted-foreground">Отзывов пока нет. Станьте первым!</p>
        ) : (
          <div className="flex flex-col gap-3">
            {allReviews.map((r) => (
              <Card key={r.id} className="gap-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StarRating value={r.rating} />
                  <span className="font-semibold">{r.author}</span>
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={new Date(r.createdAt).toISOString()}
                  >
                    {formatAgo(r.createdAt)}
                  </time>
                </div>
                <p className="text-muted-foreground">{r.text}</p>
              </Card>
            ))}
          </div>
        )}
        <Button variant="secondary" onClick={() => setReviewOpen(true)}>
          Оставить отзыв
        </Button>
      </section>

      <ReviewDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        entityId={pc.id}
        author={user?.name ?? "Гость"}
        onSubmitted={() => setReviews(listReviews(pc.id))}
      />
    </div>
  );
}