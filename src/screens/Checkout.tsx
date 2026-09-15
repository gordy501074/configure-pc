import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  useToast,
} from "../components/ui";
import { ConfigPartsTable } from "../components/shared/ConfigPartsTable";
import { formatPrice } from "../lib/format";
import { configStats } from "../lib/compatibility";
import { addOrder, uid } from "../lib/storage";
import { useAuth } from "../lib/auth";
import type { Config, Order } from "../types";

interface CheckoutState {
  orderTitle?: string;
  total?: number;
  config?: Config;
  line?: { kind: "ready" | "config"; refId: string; name: string; price: number; count: number };
}

export default function Checkout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const state = (location.state ?? {}) as CheckoutState;

  const [name, setName] = useState(user?.name ?? "");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const [loading, setLoading] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);

  const config = state.config;
  const parts = config?.parts ?? (state.line ? [] : []);
  const stats = config ? configStats({ parts }) : { totalPrice: state.total ?? 0, totalTdp: 0 };
  const items = state.line
    ? [state.line]
    : parts.map(({ part }) => ({
        kind: "config" as const,
        refId: part.id,
        name: part.name,
        price: part.price,
        count: 1,
      }));
  const total = stats.totalPrice;

  const validate = () => {
    const next: { [k: string]: string } = {};
    if (name.trim().length < 2) next.name = "Укажите имя (минимум 2 символа).";
    if (address.trim().length < 5) next.address = "Укажите полный адрес доставки.";
    if (!/^[+()\d\s-]{6,}$/.test(phone)) next.phone = "Укажите корректный телефон.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    window.setTimeout(() => {
      const order: Order = {
        id: uid("ord"),
        createdAt: Date.now(),
        items: items.map((it) => ({
          kind: it.kind,
          refId: it.refId ?? config?.id ?? "",
          name: it.name ?? config?.name ?? "",
          price: it.price ?? 0,
          count: it.count ?? 1,
        })),
        total,
        status: "new",
        address,
        userName: name.trim(),
      };
      addOrder(order);
      setLoading(false);
      setPlaced(order);
      toast("Заказ оформлен!");
    }, 900);
  };

  if (placed) {
    return (
      <div className="container">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Оформление" }]} />
        <div className="flex items-center justify-center py-6">
          <Card className="w-full max-w-md items-center gap-4 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              ✓
            </div>
            <h1 className="text-2xl font-bold">Заказ оформлен</h1>
            <p className="text-muted-foreground">
              Номер заказа: <strong className="text-foreground">{placed.id}</strong>. Мы
              свяжемся с вами для подтверждения доставки.
            </p>
            <div className="w-full border-t pt-4 text-left">
              <Row label="Сумма" value={formatPrice(placed.total)} />
              <Row label="Адрес" value={placed.address} />
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-muted-foreground">Статус</span>
                <Badge variant="success">Новый</Badge>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => navigate("/")}>На главную</Button>
              <Button variant="secondary" onClick={() => navigate("/profile/orders")}>
                Мои заказы
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!config && !state.line) {
    return (
      <div className="container">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Оформление" }]} />
        <EmptyState
          title="Корзина пуста"
          description="Выберите готовую сборку или соберите конфигурацию, чтобы оформить заказ."
          actionLabel="К готовым ПК"
          onAction={() => navigate("/ready")}
        />
      </div>
    );
  }

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Оформление заказа" }]} />

      <h1 className="text-3xl font-bold">Оформление заказа</h1>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
        <section className="flex flex-col gap-5" aria-label="Данные заказа">
          {parts.length > 0 ? (
            <Card className="gap-4 p-4">
              <h2 className="text-lg font-semibold">Состав</h2>
              <ConfigPartsTable parts={parts} />
            </Card>
          ) : null}

          <Card className="gap-4 p-4">
            <h2 className="text-lg font-semibold">Контактные данные</h2>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Field label="Имя" htmlFor="ord-name" required error={errors.name}>
                <Input
                  id="ord-name"
                  autoComplete="name"
                  value={name}
                  invalid={!!errors.name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) {
                      setErrors((p) => {
                        const n = { ...p };
                        delete n.name;
                        return n;
                      });
                    }
                  }}
                />
              </Field>
              <Field label="Телефон" htmlFor="ord-phone" required error={errors.phone}>
                <Input
                  id="ord-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+7 (___) ___-__-__"
                  value={phone}
                  invalid={!!errors.phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (errors.phone) {
                      setErrors((p) => {
                        const n = { ...p };
                        delete n.phone;
                        return n;
                      });
                    }
                  }}
                />
              </Field>
              <Field label="Адрес доставки" htmlFor="ord-address" required error={errors.address}>
                <Input
                  id="ord-address"
                  autoComplete="street-address"
                  value={address}
                  invalid={!!errors.address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    if (errors.address) {
                      setErrors((p) => {
                        const n = { ...p };
                        delete n.address;
                        return n;
                      });
                    }
                  }}
                />
              </Field>

              <div className="rounded-md bg-muted px-3 py-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Товаров</span>
                  <span>{items.length}</span>
                </div>
                <div className="mt-1 flex justify-between border-t pt-1 font-bold">
                  <span>К оплате</span>
                  <span>{formatPrice(total)}</span>
                </div>
              </div>

              <Button type="submit" size="lg" loading={loading}>
                Подтвердить заказ
              </Button>
            </form>
          </Card>
        </section>

        <aside className="flex flex-col" aria-label="Итого">
          <Card className="sticky top-20 gap-3 p-4">
            <h2 className="text-lg font-semibold">{state.orderTitle ?? "Ваш заказ"}</h2>
            <div className="flex flex-col">
              {Array.isArray(items) && items.length > 0 ? (
                items.map((it, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 border-b py-2 text-sm"
                  >
                    <span className={it.name ? "" : "text-muted-foreground"}>
                      {it.name || "—"}
                    </span>
                    <span className="whitespace-nowrap">{formatPrice(it.price)}</span>
                  </div>
                ))
              ) : (
                <p className="py-2 text-sm text-muted-foreground">Состав недоступен.</p>
              )}
              <div className="flex items-center justify-between pt-2 font-bold">
                <span>Итого</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}