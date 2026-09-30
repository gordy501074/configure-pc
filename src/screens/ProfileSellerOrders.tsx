import { useCallback, useEffect, useState } from "react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "../components/ui";
import { cn } from "../lib/utils";
import { formatDate, formatPrice } from "../lib/format";
import {
  approveInstallment,
  fetchAlphaOrders,
  fetchSellerOrders,
  fetchSellerSummaries,
  rejectInstallment,
  updateSellerOrderStatus,
} from "../lib/api";
import {
  isInstallmentPending,
  isInstallmentRejected,
  orderStatusLabel,
  orderStatusTone,
  sellerOrderActions,
} from "../lib/orderStatus";
import type { Order, SellerSummary } from "../types";

type Mode = "orders" | "installments";

export function ProfileSellerOrders({
  sellerId,
  isAdmin = false,
}: {
  sellerId: string;
  isAdmin?: boolean;
}) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellers, setSellers] = useState<SellerSummary[]>([]);
  const [activeSellerId, setActiveSellerId] = useState(sellerId);
  const [mode, setMode] = useState<Mode>("orders");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    fetchSellerSummaries()
      .then((list) => {
        setSellers(list);
        setActiveSellerId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ""));
      })
      .catch(() => setSellers([]));
  }, [isAdmin]);

  const reload = useCallback(async () => {
    try {
      if (isAdmin && mode === "installments") {
        setOrders(await fetchAlphaOrders());
      } else {
        if (!activeSellerId) {
          setOrders([]);
          return;
        }
        setOrders(await fetchSellerOrders(activeSellerId));
      }
    } catch {
      toast("Не удалось загрузить заказы покупателей", "error");
    } finally {
      setLoading(false);
    }
  }, [activeSellerId, isAdmin, mode, toast]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const changeStatus = async (orderId: string, status: Order["status"], label: string) => {
    try {
      await updateSellerOrderStatus(activeSellerId, orderId, status);
      await reload();
      toast(`Статус изменён: ${label}`);
    } catch {
      toast("Не удалось изменить статус заказа", "error");
    }
  };

  const decideInstallment = async (orderId: string, approve: boolean) => {
    try {
      if (approve) await approveInstallment(orderId);
      else await rejectInstallment(orderId);
      await reload();
      toast(approve ? "Рассрочка одобрена" : "Рассрочка отклонена");
    } catch {
      toast("Не удалось обработать заявку", "error");
    }
  };

  if (loading) return <EmptyState title="Загрузка…" description="Пожалуйста, подождите." />;

  return (
    <section aria-label="Заказы покупателей" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Заказы покупателей</h2>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin ? (
            <>
              <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Режим заказов">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "orders"}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === "orders"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setMode("orders")}
                >
                  Все заказы
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "installments"}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === "installments"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setMode("installments")}
                >
                  Заявки на рассрочку
                </button>
              </div>
              {mode === "orders" ? (
                <Select value={activeSellerId} onValueChange={setActiveSellerId}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Выберите продавца" />
                  </SelectTrigger>
                  <SelectContent>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.company ? ` · ${s.company}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title={mode === "installments" ? "Заявок на рассрочку нет" : "Заказов покупателей пока нет"}
          description={
            mode === "installments"
              ? "Новые заявки на рассрочку 0-0-4 появятся здесь."
              : "Как только покупатель оформит заказ с вашей позицией, он появится в этом разделе."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              installments={isAdmin && mode === "installments"}
              allowSellerActions={!isAdmin}
              onChangeStatus={changeStatus}
              onDecideInstallment={decideInstallment}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function OrderCard({
  order,
  installments,
  allowSellerActions,
  onChangeStatus,
  onDecideInstallment,
}: {
  order: Order;
  installments: boolean;
  allowSellerActions: boolean;
  onChangeStatus: (orderId: string, status: Order["status"], label: string) => void;
  onDecideInstallment: (orderId: string, approve: boolean) => void;
}) {
  const actions = allowSellerActions ? sellerOrderActions(order.status) : [];
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">#{order.id.slice(-6)}</span>
        <span className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</span>
        <Badge variant={orderStatusTone(order.status)}>{orderStatusLabel(order.status)}</Badge>
      </div>
      <div className="flex flex-col">
        {order.items.map((it, i) => (
          <div key={i} className="flex items-center justify-between border-b py-1.5 text-sm">
            <span>{it.name}</span>
            <span className="text-muted-foreground">
              {formatPrice(it.price)} × {it.count}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-sm text-muted-foreground">
          {installments ? "Итого по заказу" : "Итого по вашим позициям"}
        </span>
        <span className="font-bold">{formatPrice(order.total)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{order.userName}</span>
        {order.address ? <span>· {order.address}</span> : null}
      </div>

      {installments && isInstallmentPending(order.status) ? (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button size="sm" onClick={() => onDecideInstallment(order.id, true)}>
            Одобрить
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDecideInstallment(order.id, false)}
          >
            Отклонить
          </Button>
        </div>
      ) : actions.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          {isInstallmentRejected(order.status) ? (
            <span className="mr-auto self-center text-sm text-muted-foreground">
              Рассрочка недоступна
            </span>
          ) : null}
          {actions.map((a) => (
            <Button
              key={a.target}
              variant={a.destructive ? "destructive" : "secondary"}
              size="sm"
              onClick={() => onChangeStatus(order.id, a.target, a.label)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}