import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CreditCard } from "lucide-react";

import { Breadcrumbs, Button, Card, EmptyState, Field, Input, useToast } from "../components/ui";
import { ConfigPartsTable } from "../components/shared/ConfigPartsTable";
import { InstallmentPlan } from "../components/shared/InstallmentPlan";
import { formatPrice } from "../lib/format";
import { configStats } from "../lib/compatibility";
import { saveOrderRemote } from "../lib/api";
import { useAuth } from "../lib/auth";
import { uid } from "../lib/session";
import type { ComponentCategory, Config, Order, OrderItem, Part } from "../types";

interface InstallmentState {
  orderTitle?: string;
  total?: number;
  config?: Config;
  line?: { kind: "ready" | "config"; refId: string; name: string; price: number; count: number };
}

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

export default function InstallmentCheckout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const state = (location.state ?? {}) as InstallmentState;

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.name ? "" : "");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const [loading, setLoading] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);

  const config = state.config;
  const parts = config?.parts ?? (state.line ? [] : []);
  const stats = config ? configStats({ parts }) : { totalPrice: state.total ?? 0, totalTdp: 0 };
  const total = stats.totalPrice;
  const items: OrderItem[] = state.line
    ? [
        {
          kind: state.line.kind,
          refId: state.line.refId,
          name: state.line.name,
          price: state.line.price,
          count: state.line.count,
        },
      ]
    : parts.filter((cp): cp is { category: ComponentCategory; part: Part } => !!cp.part).map(({ part }) => ({
        kind: "config" as const,
        refId: part.id,
        name: part.name,
        price: part.price,
        count: 1,
      }));

  const validate = () => {
    const next: { [k: string]: string } = {};
    if (name.trim().length < 2) next.name = "Укажите имя (минимум 2 символа).";
    if (!/^[+()\d\s-]{6,}$/.test(phone)) next.phone = "Укажите корректный телефон.";
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Укажите корректный e-mail.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (!user) {
      toast("Войдите, чтобы оформить заявку", "info");
      navigate("/auth");
      return;
    }
    setLoading(true);
    const order: Order = {
      id: uid("ord"),
      createdAt: Date.now(),
      items: items.map((it) => ({
        kind: it.kind,
        refId: it.refId,
        name: it.name,
        price: it.price,
        count: it.count,
      })),
      total,
      status: "alpha",
      address: email,
      userName: name.trim(),
    };
    try {
      await saveOrderRemote(order, user.id);
      setPlaced(order);
      toast("Заявка отправлена!");
    } catch {
      toast("Не удалось отправить заявку", "error");
    } finally {
      setLoading(false);
    }
  };

  const count = 4;
  const payments = Array.from({ length: count }, (_, i) => {
    if (i === count - 1) return total - Math.floor(total / count) * (count - 1);
    return Math.floor(total / count);
  });

  if (placed) {
    return (
      <div className="container">
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Рассрочка" }]} />
        <div className="flex items-center justify-center py-6">
          <Card className="w-full max-w-md items-center gap-4 border-red-200 bg-red-50 p-8 text-center dark:border-red-900/50 dark:bg-red-950/40">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white">
              <CreditCard className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold">Заявка отправлена</h1>
            <p className="text-muted-foreground">
              Заявка № <strong className="text-foreground">{placed.id}</strong>. Менеджер
              Альфа-Банка свяжется с вами для подтверждения рассрочки.
            </p>
            <div className="w-full border-t border-red-200 pt-4 text-left">
              <Row label="Сумма" value={formatPrice(placed.total)} />
              <Row label="Платеж" value={`4 × ${formatPrice(Math.round(placed.total / 4))}`} />
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
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Рассрочка" }]} />
        <EmptyState
          title="Нет данных для рассрочки"
          description="Выберите сборку или сконфигурируйте ПК, чтобы оформить рассрочку."
          actionLabel="К готовым ПК"
          onAction={() => navigate("/ready")}
        />
      </div>
    );
  }

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Рассрочка от Альфа-Банка" }]} />

      <h1 className="text-3xl font-bold">Покупка в рассрочку от Альфа-Банка</h1>
      <p className="mt-1 text-muted-foreground">
        4 равных платежа по {formatPrice(Math.round(total / 4))} без переплат, начиная со
        следующего месяца.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
        <section className="flex flex-col gap-5" aria-label="Данные заявки">
          {parts.length > 0 ? (
            <Card className="gap-4 p-4">
              <h2 className="text-lg font-semibold">Состав</h2>
              <ConfigPartsTable parts={parts} />
            </Card>
          ) : null}

          <Card className="gap-4 border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/40">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white">
                <CreditCard className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-semibold">Заявка на рассрочку</h2>
            </div>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Field label="Имя" htmlFor="inst-name" required error={errors.name}>
                <Input
                  id="inst-name"
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
              <Field label="Телефон" htmlFor="inst-phone" required error={errors.phone}>
                <Input
                  id="inst-phone"
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
              <Field label="E-mail" htmlFor="inst-email" required error={errors.email}>
                <Input
                  id="inst-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  invalid={!!errors.email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) {
                      setErrors((p) => {
                        const n = { ...p };
                        delete n.email;
                        return n;
                      });
                    }
                  }}
                />
              </Field>

              <div className="rounded-md bg-white/70 px-3 py-2 dark:bg-black/20">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Товаров</span>
                  <span>1</span>
                </div>
                <div className="mt-1 flex flex-col gap-1 border-t border-red-100 pt-1 dark:border-red-900/50">
                  {payments.map((p, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{monthLabel(i + 1)}</span>
                      <span className="font-semibold">{formatPrice(p)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between border-t border-red-100 pt-1 font-bold dark:border-red-900/50">
                  <span>Итого</span>
                  <span>{formatPrice(total)}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? "Отправка..." : "Отправить заявку на покупку в рассрочку"}
              </button>
            </form>
          </Card>
        </section>

        <aside className="flex flex-col" aria-label="План платежей">
          <Card className="sticky top-20 gap-3 border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/40">
            <h2 className="text-lg font-semibold">{state.orderTitle ?? "Ваш заказ"}</h2>
            <div className="flex flex-col gap-2">
              {parts.length > 0 ? (
                parts.map(({ category, part }) => {
                  if (!part) {
                    return (
                      <div key={category} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-muted-foreground">
                          Компонент более недоступен для заказа
                        </span>
                        <span className="whitespace-nowrap">—</span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={category}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate text-muted-foreground">{part.name}</span>
                      <span className="whitespace-nowrap">{formatPrice(part.price)}</span>
                    </div>
                  );
                })
              ) : state.line ? (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-muted-foreground">{state.line.name}</span>
                  <span className="whitespace-nowrap">{formatPrice(state.line.price)}</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Состав недоступен.</p>
              )}
              <div className="flex items-center justify-between border-t border-red-200 pt-2 font-bold dark:border-red-900/50">
                <span>Итого</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>
            <InstallmentPlan total={total} />
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