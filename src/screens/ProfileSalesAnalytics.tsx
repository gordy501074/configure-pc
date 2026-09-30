import { useCallback, useEffect, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Badge,
  Card,
  ChartContainer,
  ChartTooltipContent,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  type ChartConfig,
} from "../components/ui";
import { cn } from "../lib/utils";
import { CATEGORY_LABELS, formatPrice } from "../lib/format";
import {
  fetchAdminSalesAnalytics,
  fetchSellerSalesAnalytics,
  fetchSellerSummaries,
} from "../lib/api";
import { ORDER_STATUS_LABELS } from "../lib/orderStatus";
import type {
  AnalyticsPeriod,
  Order,
  SalesAnalytics,
  SellerSummary,
} from "../types";

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "90d", label: "90 дней" },
  { key: "all", label: "Весь период" },
];

const ACTIVE_STATUSES: Order["status"][] = ["new", "confirmed", "delivery", "done", "alpha", "alpha_rejected"];

const revenueConfig = {
  revenue: { label: "Выручка", color: "var(--chart-1)" },
  orders: { label: "Заказы", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function ProfileSalesAnalytics({
  sellerId,
  isAdmin = false,
}: {
  sellerId: string;
  isAdmin?: boolean;
}) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [sellers, setSellers] = useState<SellerSummary[]>([]);
  const [selectedSeller, setSelectedSeller] = useState<string>(isAdmin ? "all" : sellerId);
  const [data, setData] = useState<SalesAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    fetchSellerSummaries()
      .then(setSellers)
      .catch(() => setSellers([]));
  }, [isAdmin]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (isAdmin && selectedSeller === "all") {
        setData(await fetchAdminSalesAnalytics(period));
      } else {
        const id = isAdmin ? selectedSeller : sellerId;
        if (!id) {
          setData(null);
          return;
        }
        setData(await fetchSellerSalesAnalytics(id, period));
      }
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, selectedSeller, sellerId, period]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const showInstallment = isAdmin && selectedSeller === "all";

  if (loading) {
    return (
      <section aria-label="Аналитика продаж" className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        title="Не удалось загрузить аналитику"
        description="Попробуйте обновить страницу позже."
      />
    );
  }

  const { kpi } = data;
  const isEmpty = kpi.orders === 0 && kpi.cancelledOrders === 0;

  return (
    <section aria-label="Аналитика продаж" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Аналитика продаж</h2>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin ? (
            <Select value={selectedSeller} onValueChange={setSelectedSeller}>
              <SelectTrigger className="w-56" aria-label="Продавец">
                <SelectValue placeholder="Выберите продавца" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все продавцы</SelectItem>
                {sellers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.company ? ` · ${s.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Период">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period === p.key}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  period === p.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          title="Недостаточно данных за выбранный период"
          description="Как только появятся заказы с вашими позициями, здесь отобразится аналитика."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard title="Выручка" value={formatPrice(kpi.revenue)} />
            <KpiCard title="Заказы" value={String(kpi.orders)} />
            <KpiCard title="Средний чек" value={formatPrice(kpi.avgOrder)} />
            <KpiCard title="Продано единиц" value={String(kpi.units)} />
            <KpiCard
              title="Доля отмен"
              value={`${Math.round(kpi.cancelledRate * 100)}%`}
              hint={`${kpi.cancelledOrders} отменённых`}
            />
          </div>

          <FunnelCard stages={data.funnel} />

          <Card className="gap-4 p-4">
            <ChartHeading
              title="Динамика выручки и заказов"
              caption="Выручка по дням по позициям выбранного продавца; отменённые заказы не учитываются."
            />
            <ChartContainer config={revenueConfig} className="h-72 w-full" role="img" aria-label="Динамика выручки и заказов">
              <ComposedChart data={data.revenueByDay} accessibilityLayer>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} width={70} />
                <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                <RechartsTooltip content={<ChartTooltipContent />} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="revenue"
                  name="Выручка"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.2}
                  isAnimationActive={false}
                />
                <Bar
                  yAxisId="right"
                  dataKey="orders"
                  name="Заказы"
                  fill="var(--chart-2)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ChartContainer>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <HorizontalBarCard
              title="Топ готовых сборок"
              caption="Кастомные сборки показаны одной строкой «Кастомные сборки»."
              rows={data.topBuilds.map((r) => ({
                name: r.name,
                value: r.revenue,
                units: r.units,
              }))}
              config={revenueConfig}
            />
            <HorizontalBarCard
              title="Топ компонентов"
              caption="Источник — снимки позиций кастомных сборок; пустая категория показана как «—»."
              rows={data.topParts.map((r) => ({
                name: r.name,
                value: r.revenue,
                units: r.units,
              }))}
              config={revenueConfig}
            />
          </div>

          <Card className="gap-4 p-4">
            <ChartHeading
              title="Средний чек и распределение заказов"
              caption="Распределение заказов по сумме позиций продавца."
            />
            <ChartContainer config={revenueConfig} className="h-64 w-full" role="img" aria-label="Распределение заказов по сумме">
              <BarChart data={data.orderValueBuckets} accessibilityLayer>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                <RechartsTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="orders" name="Заказы" fill="var(--chart-3)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          </Card>

          <CatalogCoverageCard rows={data.catalogCoverage} aggregate={isAdmin && selectedSeller === "all"} />

          {showInstallment && data.installment ? (
            <InstallmentCard installment={data.installment} />
          ) : null}
        </>
      )}
    </section>
  );
}

function KpiCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 p-4" aria-label={title}>
      <span className="text-sm text-muted-foreground">{title}</span>
      <span className="text-xl font-bold">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </Card>
  );
}

function ChartHeading({ title, caption }: { title: string; caption: string }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{caption}</p>
    </div>
  );
}

function FunnelCard({ stages }: { stages: SalesAnalytics["funnel"] }) {
  const byStatus = new Map(stages.map((s) => [s.status, s]));
  const order: Order["status"][] = [...ACTIVE_STATUSES, "cancelled"];
  const max = Math.max(1, ...order.map((s) => byStatus.get(s)?.orders ?? 0));

  return (
    <Card className="gap-4 p-4">
      <ChartHeading
        title="Воронка заказов"
        caption="Воронка строится по текущему статусу (история переходов не хранится) и кумулятивна: «подтверждён» включает доставленные и выполненные заказы."
      />
      <ul className="flex flex-col gap-2">
        {order.map((status) => {
          const stage = byStatus.get(status);
          const count = stage?.orders ?? 0;
          const width = Math.round((count / max) * 100);
          return (
            <li key={status} className="flex items-center gap-3">
              <span className="w-56 shrink-0 text-sm text-muted-foreground">
                {ORDER_STATUS_LABELS[status]}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    status === "cancelled" ? "bg-destructive" : "bg-primary",
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                {count} · {formatPrice(stage?.revenue ?? 0)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function HorizontalBarCard({
  title,
  caption,
  rows,
  config,
}: {
  title: string;
  caption: string;
  rows: { name: string; value: number; units: number }[];
  config: ChartConfig;
}) {
  const top = rows.slice(0, 8).map((r) => ({ ...r, revenue: r.value }));
  return (
    <Card className="gap-4 p-4">
      <ChartHeading title={title} caption={caption} />
      {top.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет данных за период.</p>
      ) : (
        <ChartContainer
          config={config}
          className="w-full"
          style={{ height: Math.max(160, top.length * 40) }}
          role="img"
          aria-label={title}
        >
          <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }} accessibilityLayer>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              width={160}
            />
            <RechartsTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="revenue" name="Выручка" fill="var(--chart-1)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      )}
    </Card>
  );
}

function CatalogCoverageCard({
  rows,
  aggregate,
}: {
  rows: SalesAnalytics["catalogCoverage"];
  aggregate: boolean;
}) {
  const data = rows.map((r) => ({
    category: CATEGORY_LABELS[r.category] ?? r.category,
    available: r.available,
    priced: r.priced,
    unpriced: Math.max(0, r.total - r.priced),
  }));
  const config = {
    priced: { label: "С ценой", color: "var(--chart-2)" },
    unpriced: { label: "Без цены", color: "var(--chart-5)" },
  } satisfies ChartConfig;

  const totalAvailable = rows.reduce((s, r) => s + r.available, 0);
  const totalParts = rows.reduce((s, r) => s + r.total, 0);

  return (
    <Card className="gap-4 p-4">
      <ChartHeading
        title="Каталог, цены и наличие"
        caption={
          aggregate
            ? "«С ценой» — детали, оценённые хотя бы одним продавцом в активном прайсе."
            : "«С ценой» — детали с положительной ценой в вашем активном прайс-листе."
        }
      />
      <p className="text-sm text-muted-foreground">
        Доступно к заказу: {totalAvailable} из {totalParts} позиций каталога.
      </p>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет данных о каталоге.</p>
      ) : (
        <ChartContainer config={config} className="h-72 w-full" role="img" aria-label="Покрытие каталога по категориям">
          <BarChart data={data} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="category" tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={-30} textAnchor="end" height={70} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <RechartsTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="priced" name="С ценой" stackId="a" fill="var(--chart-2)" isAnimationActive={false} />
            <Bar dataKey="unpriced" name="Без цены" stackId="a" fill="var(--chart-5)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      )}
    </Card>
  );
}

function InstallmentCard({ installment }: { installment: NonNullable<SalesAnalytics["installment"]> }) {
  const decisions = [
    { name: "Одобрено", value: installment.approved, color: "var(--chart-2)" },
    { name: "Отклонено", value: installment.rejected, color: "var(--chart-5)" },
    { name: "На рассмотрении", value: installment.pending, color: "var(--chart-4)" },
  ].filter((d) => d.value > 0);

  const share = [
    { name: "С рассрочкой", value: installment.withInstallment, color: "var(--chart-3)" },
    { name: "Без рассрочки", value: installment.withoutInstallment, color: "var(--chart-2)" },
  ].filter((d) => d.value > 0);

  const config = {
    approved: { label: "Одобрено", color: "var(--chart-2)" },
    rejected: { label: "Отклонено", color: "var(--chart-5)" },
    pending: { label: "На рассмотрении", color: "var(--chart-4)" },
  } satisfies ChartConfig;

  return (
    <Card
      className="gap-4 border-red-200 p-4 dark:border-red-900/50"
      aria-label="Рассрочка от Альфа-Банка"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Рассрочка от Альфа-Банка</h3>
        <Badge variant="warning">только админ · все продавцы</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Исторические одобренные до миграции не учитываются; выкуп за свой счёт после отказа
        относится к продажам без рассрочки.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="Одобрено" value={String(installment.approved)} />
        <KpiCard title="Отклонено" value={String(installment.rejected)} />
        <KpiCard title="На рассмотрении" value={String(installment.pending)} />
        <KpiCard title="Доля рассрочки" value={`${Math.round(installment.installmentShare * 100)}%`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-medium">Решения по заявкам</h4>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Заявок нет.</p>
          ) : (
            <ChartContainer config={config} className="mx-auto h-56 w-full" role="img" aria-label="Решения по заявкам на рассрочку">
              <PieChart>
                <RechartsTooltip content={<ChartTooltipContent />} />
                <Pie data={decisions} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} isAnimationActive={false}>
                  {decisions.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Продажи с рассрочкой и без</h4>
          <div className="flex flex-col gap-2">
            {share.map((s) => {
              const total = share.reduce((acc, x) => acc + x.value, 0) || 1;
              return (
                <div key={s.name} className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <span>{s.name}</span>
                    <span className="text-muted-foreground">
                      {s.value} · {Math.round((s.value / total) * 100)}%
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <span className="text-muted-foreground">
              Средний рассрочный: {formatPrice(installment.avgInstallmentOrder)}
            </span>
            <span className="text-muted-foreground">
              Средний обычный: {formatPrice(installment.avgFullOrder)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}