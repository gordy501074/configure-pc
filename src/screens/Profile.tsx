import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  StarRating,
  Textarea,
  useToast,
} from "../components/ui";
import { ConfigPartsTable } from "../components/shared/ConfigPartsTable";
import { cn } from "../lib/utils";
import { configStats, isPriceStale } from "../lib/compatibility";
import { formatAgo, formatDate, formatPrice } from "../lib/format";
import {
  addSellerBrand,
  deleteConfigRemote,
  deleteOrderRemote,
  deleteSellerBrand,
  fetchAllReviews,
  fetchConfigs,
  fetchOrders,
  fetchSellerBrands,
  updateProfile,
  updateSellerBrand,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Config, Order, Review, SellerBrand } from "../types";
import Admin from "./Admin";
import { ProfileComponents } from "./ProfileComponents";
import { ProfilePriceLists } from "./ProfilePriceLists";

type Tab = "configs" | "orders" | "reviews" | "admin-users" | "brands" | "components" | "price-lists";

interface TabDef {
  key: Tab;
  label: string;
}

function tabsForRole(role: string): TabDef[] {
  if (role === "admin") {
    return [
      { key: "admin-users", label: "Администрирование пользователей" },
      { key: "components", label: "Компоненты" },
      { key: "price-lists", label: "Прайс-листы" },
    ];
  }
  if (role === "seller") {
    return [
      { key: "brands", label: "Бренды" },
      { key: "price-lists", label: "Прайс-листы" },
      { key: "components", label: "Компоненты" },
    ];
  }
  return [
    { key: "configs", label: "Конфигурации" },
    { key: "orders", label: "Заказы" },
    { key: "reviews", label: "Отзывы" },
  ];
}

function roleMeta(role: string): { label: string; variant: "success" | "warning" | "info" | "neutral" } {
  if (role === "seller") return { label: "Продавец", variant: "warning" };
  if (role === "admin") return { label: "Администратор", variant: "info" };
  return { label: "Клиент", variant: "success" };
}

export default function Profile() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, refreshUser } = useAuth();
  const [loadState, setLoadState] = useState<"loading" | "done">("loading");
  const [configs, setConfigs] = useState<Config[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [brands, setBrands] = useState<SellerBrand[]>([]);
  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editing, setEditing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Brand modal state.
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandEditIndex, setBrandEditIndex] = useState<number | null>(null);
  const [brandName, setBrandName] = useState("");
  const [brandDescription, setBrandDescription] = useState("");

  const tabs: TabDef[] = tabsForRole(user?.role ?? "customer");
  const activeTab: Tab = tabs.some((t) => t.key === tab) ? (tab as Tab) : tabs[0]?.key ?? "configs";

  const reload = useCallback(async () => {
    if (!user) return;
    if (user.role === "admin") {
      setLoadState("done");
      return;
    }
    if (user.role === "seller") {
      try {
        setBrands(await fetchSellerBrands(user.id));
      } catch {
        toast("Не удалось загрузить бренды", "error");
      }
      setLoadState("done");
      return;
    }
    try {
      const [cfgs, ords, revs] = await Promise.all([
        fetchConfigs(user.id),
        fetchOrders(user.id),
        fetchAllReviews(),
      ]);
      setConfigs(cfgs);
      setOrders(ords);
      setReviews(revs.filter((r) => r.author === user.name));
    } catch {
      toast("Не удалось загрузить данные профиля", "error");
    }
    setLoadState("done");
  }, [user, toast]);

  useEffect(() => {
    setLoadState("loading");
    void reload();
  }, [reload, tab]);

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

  const beginEdit = () => {
    setEditName(user!.name);
    setEditCompany(user!.company ?? "");
    setEditing(true);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    if (!editName.trim()) {
      toast("Имя не может быть пустым", "error");
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({
        name: editName.trim(),
        ...(user.role === "seller" ? { company: editCompany } : {}),
      });
      await refreshUser();
      await reload();
      toast("Аккаунт обновлён");
      setEditing(false);
    } catch {
      toast("Не удалось сохранить изменения", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const openAddBrand = () => {
    setBrandEditIndex(null);
    setBrandName("");
    setBrandDescription("");
    setBrandModalOpen(true);
  };

  const openEditBrand = (index: number, b: SellerBrand) => {
    setBrandEditIndex(index);
    setBrandName(b.brand);
    setBrandDescription(b.description ?? "");
    setBrandModalOpen(true);
  };

  const handleSaveBrand = async () => {
    const sellerId = user?.id;
    if (!sellerId || !brandName.trim()) {
      toast("Укажите название бренда", "error");
      return;
    }
    try {
      if (brandEditIndex !== null) {
        const original = brands[brandEditIndex];
        await updateSellerBrand(sellerId, original.brand, {
          brand: brandName.trim(),
          description: brandDescription.trim() || undefined,
        });
        toast("Бренд обновлён");
      } else {
        await addSellerBrand(sellerId, brandName.trim(), brandDescription.trim() || undefined);
        toast("Бренд добавлен");
      }
      setBrands(await fetchSellerBrands(sellerId));
      setBrandModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast(
        message === "brand_exists" && brandEditIndex === null
          ? "Бренд с таким названием уже существует"
          : "Не удалось сохранить бренд",
        "error",
      );
    }
  };

  const handleDeleteBrand = async (b: SellerBrand) => {
    if (!user) return;
    try {
      await deleteSellerBrand(user.id, b.brand);
      setBrands(await fetchSellerBrands(user.id));
      toast("Бренд удалён", "info");
    } catch {
      toast("Не удалось удалить бренд", "error");
    }
  };

  if (!user) {
    return (
      <div className="container">
        <EmptyState
          title="Войдите в аккаунт"
          description="Чтобы видеть профиль и разделы, войдите в аккаунт."
          actionLabel="Войти"
          onAction={() => navigate("/auth")}
        />
      </div>
    );
  }

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Профиль" }]} />

      <section className="mb-6 flex items-start gap-4" aria-label="Профиль пользователя">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{user.name}</h1>
            <Badge variant={roleMeta(user.role).variant}>{roleMeta(user.role).label}</Badge>
          </div>
          {user.role === "seller" ? (
            <p className="text-muted-foreground" aria-label="Компания">
              {user.company ?? "Компания не указана"}
            </p>
          ) : null}
          <p className="text-muted-foreground">
            {user.role === "customer"
              ? [user.email, user.phone].filter(Boolean).join(" · ")
              : user.email}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {!editing ? (
              <Button variant="secondary" size="sm" onClick={beginEdit}>
                Редактировать аккаунт
              </Button>
            ) : (
              <>
                <Field label="Имя" htmlFor="profile-name" className="min-w-52 gap-1.5">
                  <Input
                    id="profile-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </Field>
                {user.role === "seller" ? (
                  <Field label="Компания" htmlFor="profile-company" className="min-w-52 gap-1.5">
                    <Input
                      id="profile-company"
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                    />
                  </Field>
                ) : null}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" loading={savingProfile} onClick={handleSaveProfile}>
                    Сохранить
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                    disabled={savingProfile}
                  >
                    Отмена
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <nav
        className="mb-6 flex gap-1 rounded-lg bg-muted p-1"
        aria-label="Разделы профиля"
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            to={`/profile/${t.key}`}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm font-medium no-underline transition-colors",
              activeTab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={activeTab === t.key ? "page" : undefined}
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
      ) : activeTab === "configs" ? (
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
                      {c.source !== "ready" &&
                      c.parts.some(
                        (cp) =>
                          cp.price !== undefined &&
                          isPriceStale(cp.price, cp.currentPrice),
                      ) ? (
                        <Badge variant="warning">Цена может быть неактуальной</Badge>
                      ) : null}
                    </div>
                    <ConfigPartsTable parts={c.parts} showStale={c.source !== "ready"} />
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
      ) : activeTab === "orders" ? (
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
      ) : activeTab === "reviews" ? (
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
      ) : activeTab === "admin-users" ? (
        <section aria-label="Администрирование пользователей">
          <Admin embedded />
        </section>
      ) : activeTab === "components" ? (
        <ProfileComponents isAdmin={user?.role === "admin"} />
      ) : activeTab === "price-lists" ? (
        <ProfilePriceLists sellerId={user.id} isAdmin={user?.role === "admin"} />
      ) : activeTab === "brands" ? (
        <section aria-label="Бренды" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Бренды продавца</h2>
            <Button onClick={openAddBrand}>Добавить бренд</Button>
          </div>
          {brands.length === 0 ? (
            <EmptyState
              title="Брендов пока нет"
              description="Добавьте бренд, который вы представляете, и его описание."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {brands.map((b, i) => (
                <Card key={b.brand} className="gap-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-lg font-semibold">{b.brand}</span>
                      {b.description ? (
                        <span className="text-sm text-muted-foreground">{b.description}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Без описания</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => openEditBrand(i, b)}>
                        Редактировать
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteBrand(b)}>
                        Удалить
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Modal
            open={brandModalOpen}
            onClose={() => setBrandModalOpen(false)}
            title={brandEditIndex !== null ? "Редактировать бренд" : "Новый бренд"}
            footer={
              <>
                <Button variant="ghost" onClick={() => setBrandModalOpen(false)}>
                  Отмена
                </Button>
                <Button onClick={handleSaveBrand}>
                  {brandEditIndex !== null ? "Сохранить" : "Добавить"}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-4">
              <Field label="Название бренда" htmlFor="brand-name" required>
                <Input
                  id="brand-name"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                />
              </Field>
              <Field label="Описание бренда" htmlFor="brand-description">
                <Textarea
                  id="brand-description"
                  value={brandDescription}
                  onChange={(e) => setBrandDescription(e.target.value)}
                  placeholder="Небольшое описание бренда…"
                />
              </Field>
            </div>
          </Modal>
        </section>
      ) : null}
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