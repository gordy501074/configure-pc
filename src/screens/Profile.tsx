import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StarRating,
  Switch,
  useToast,
} from "../components/ui";
import { ConfigPartsTable } from "../components/shared/ConfigPartsTable";
import { cn } from "../lib/utils";
import { configStats } from "../lib/compatibility";
import { formatAgo, formatDate, formatPrice } from "../lib/format";
import {
  deleteConfigRemote,
  deleteOrderRemote,
  fetchAllReviews,
  fetchConfigs,
  fetchOrders,
  fetchSettings,
  saveSettingsRemote,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import type { AppSettings, Config, Order, Review } from "../types";

type Tab = "configs" | "orders" | "reviews" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "configs", label: "Конфигурации" },
  { key: "orders", label: "Заказы" },
  { key: "reviews", label: "Отзывы" },
  { key: "settings", label: "Настройки" },
];

export default function Profile() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [loadState, setLoadState] = useState<"loading" | "done">("loading");
  const [configs, setConfigs] = useState<Config[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [settings, setSettingsLocal] = useState<AppSettings>({ theme: "light", notifications: true });

  const active: Tab = (TABS.find((t) => t.key === tab)?.key ?? "configs") as Tab;

  const reload = useCallback(async () => {
    if (!user) return;
    const [cfgs, ords, revs, setts] = await Promise.all([
      fetchConfigs(user.id),
      fetchOrders(user.id),
      fetchAllReviews(),
      fetchSettings(user.id),
    ]);
    setConfigs(cfgs);
    setOrders(ords);
    setReviews(revs.filter((r) => r.author === user.name));
    setSettingsLocal(setts);
    setLoadState("done");
  }, [user]);

  useEffect(() => {
    setLoadState("loading");
    void reload();
  }, [reload, tab]);

  const updateSettings = async (patch: Partial<AppSettings>) => {
    if (!user) return;
    const next = { ...settings, ...patch };
    setSettingsLocal(next);
    if (patch.theme !== undefined) setTheme(patch.theme);
    await saveSettingsRemote(user.id, patch);
    toast("Настройки сохранены");
  };

  const handleDeleteConfig = async (id: string) => {
    await deleteConfigRemote(id);
    setConfigs(await fetchConfigs(user!.id));
    toast("Конфигурация удалена", "info");
  };

  const handleCancelOrder = async (id: string) => {
    await deleteOrderRemote(id);
    setOrders(await fetchOrders(user!.id));
    toast("Заказ отменён", "info");
  };

  if (!user) {
    return (
      <div className="container">
        <EmptyState
          title="Войдите в аккаунт"
          description="Чтобы видеть конфигурации, заказы и отзывы, войдите в профиль."
          actionLabel="Войти"
          onAction={() => navigate("/auth")}
        />
      </div>
    );
  }

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Профиль" }]} />

      <section className="mb-6 flex items-center gap-4" aria-label="Профиль пользователя">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col items-start gap-2">
          <h1 className="text-2xl font-bold">{user.name}</h1>
          <p className="text-muted-foreground">{user.phone ?? user.email ?? ""}</p>
          <Badge variant={user.role === "guest" ? "neutral" : "success"}>
            {user.role === "guest" ? "Гость" : "Клиент"}
          </Badge>
        </div>
      </section>

      <nav
        className="mb-6 flex gap-1 rounded-lg bg-muted p-1"
        aria-label="Разделы профиля"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            to={`/profile/${t.key}`}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm font-medium no-underline transition-colors",
              active === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={active === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {loadState === "loading" ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : active === "configs" ? (
        <section aria-label="Мои конфигурации">
          {configs.length === 0 ? (
            <EmptyState
              title="Конфигураций пока нет"
              description="Соберите свою первую сборку или сохраните готовую."
              actionLabel="В конфигуратор"
              onAction={() => navigate("/config")}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {configs.map((c) => {
                const s = configStats({ parts: c.parts });
                return (
                  <Card key={c.id} className="gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-lg font-semibold">{c.name}</h3>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(c.createdAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <Badge variant="info">{sourceLabel(c.source)}</Badge>
                      <span className="font-medium">{formatPrice(s.totalPrice)}</span>
                      <span className="text-muted-foreground">{s.totalTdp} Вт</span>
                    </div>
                    <ConfigPartsTable parts={c.parts} />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => navigate("/config", { state: { fromReady: c } })}
                      >
                        Открыть в конфигураторе
                      </Button>
                      <Button variant="ghost" onClick={() => handleDeleteConfig(c.id)}>
                        Удалить
                      </Button>
                    </div>
                  </Card>
                );
              })}
              <div>
                <Link to="/config" className="font-medium text-primary no-underline hover:underline">
                  + Новая конфигурация
                </Link>
              </div>
            </div>
          )}
        </section>
      ) : active === "orders" ? (
        <section aria-label="История заказов">
          {orders.length === 0 ? (
            <EmptyState
              title="Заказов пока нет"
              description="Оформите заказ — он появится в истории."
              actionLabel="К готовым ПК"
              onAction={() => navigate("/ready")}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {orders.map((o) => (
                <Card key={o.id} className="gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">#{o.id.slice(-6)}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(o.createdAt)}
                    </span>
                    <Badge variant={statusTone(o.status)}>{statusLabel(o.status)}</Badge>
                  </div>
                  <div className="flex flex-col">
                    {o.items.map((it, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border-b py-1.5 text-sm"
                      >
                        <span>{it.name}</span>
                        <span className="text-muted-foreground">
                          {formatPrice(it.price)} × {it.count}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t pt-2">
                    <span>Итого</span>
                    <span className="font-bold">{formatPrice(o.total)}</span>
                  </div>
                  {o.status !== "done" ? (
                    <div className="flex justify-end border-t pt-3">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleCancelOrder(o.id)}
                      >
                        Отменить
                      </Button>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : active === "reviews" ? (
        <section aria-label="Мои отзывы">
          {reviews.length === 0 ? (
            <EmptyState
              title="Отзывов пока нет"
              description="Оставьте отзыв на сборку, чтобы поделиться впечатлениями."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {reviews.map((r) => (
                <Card key={r.id} className="gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <StarRating value={r.rating} />
                    <time className="text-sm text-muted-foreground">
                      {formatAgo(r.createdAt)}
                    </time>
                  </div>
                  <p className="text-muted-foreground">{r.text}</p>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section aria-label="Настройки">
          <Card className="p-4">
            <div className="gap-3">
              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <h3 className="font-semibold">Тема оформления</h3>
                  <p className="text-sm text-muted-foreground">Светлая или тёмная.</p>
                </div>
                <Select value={theme} onValueChange={(v) => setTheme(v as AppSettings["theme"])}>
                  <SelectTrigger size="sm" aria-label="Тема оформления">
                    <SelectValue placeholder="Тема" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Светлая</SelectItem>
                    <SelectItem value="dark">Тёмная</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4 border-t py-3">
                <div>
                  <h3 className="font-semibold">Уведомления</h3>
                  <p className="text-sm text-muted-foreground">
                    Оформлять показ уведомлений (демо).
                  </p>
                </div>
                <Switch
                  checked={settings.notifications}
                  onCheckedChange={(v) => updateSettings({ notifications: v })}
                  aria-label="Уведомления"
                />
              </div>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}

function sourceLabel(s: Config["source"]): string {
  return s === "ready" ? "Из готовых" : s === "auto" ? "Автоподбор" : "Кастом";
}

function statusTone(s: Order["status"]): "success" | "warning" | "info" | "neutral" {
  switch (s) {
    case "new":
      return "warning";
    case "confirmed":
      return "info";
    case "delivery":
      return "info";
    case "done":
      return "success";
    case "alpha":
      return "info";
    default:
      return "neutral";
  }
}

function statusLabel(s: Order["status"]): string {
  return {
    new: "Новый",
    confirmed: "Подтверждён",
    delivery: "В доставке",
    done: "Выполнен",
    alpha: "На рассмотрении в Альфа-Банке",
  }[s] ?? s;
}