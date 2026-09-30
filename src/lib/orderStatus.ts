// Shared order-status helpers used by the customer profile (Profile.tsx), the
// seller/admin customer-orders screen (ProfileSellerOrders.tsx) and the API
// (src/server/index.ts). Kept dependency-free so it can be imported from both
// the browser bundle and the Node server without pulling in client code.

export type OrderStatus =
  | "new"
  | "confirmed"
  | "delivery"
  | "done"
  | "alpha"
  | "alpha_rejected"
  | "cancelled";

export type BadgeTone = "success" | "warning" | "info" | "neutral" | "destructive";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  delivery: "В доставке",
  done: "Выполнен",
  alpha: "На рассмотрении в Альфа-Банке",
  alpha_rejected: "Рассрочка отклонена",
  cancelled: "Отменён",
};

/**
 * Canonical whole-order status transitions a seller may perform. Shared by the
 * server (validation) and the client (which actions to render) so the two can
 * never drift and offer a button the server would reject.
 */
export const SELLER_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "cancelled"],
  alpha_rejected: ["confirmed", "cancelled"],
  confirmed: ["delivery", "cancelled"],
  delivery: ["done", "cancelled"],
  done: [],
  alpha: [],
  cancelled: [],
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export function orderStatusTone(status: OrderStatus): BadgeTone {
  switch (status) {
    case "new":
      return "warning";
    case "confirmed":
    case "delivery":
    case "alpha":
      return "info";
    case "done":
      return "success";
    case "alpha_rejected":
      return "warning";
    case "cancelled":
      return "destructive";
    default:
      return "neutral";
  }
}

export function isInstallmentPending(status: OrderStatus): boolean {
  return status === "alpha";
}

export function isInstallmentRejected(status: OrderStatus): boolean {
  return status === "alpha_rejected";
}

export interface SellerOrderAction {
  /** Target order status to apply when the button is pressed. */
  target: OrderStatus;
  label: string;
  destructive?: boolean;
}

/** Presentational labels for the seller transition targets. */
const SELLER_ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  confirmed: "Передать в сборку",
  delivery: "В доставку",
  done: "Завершить",
  cancelled: "Аннулировать",
};

/**
 * The actions a seller may perform on an order in the given status, derived from
 * the canonical `SELLER_ORDER_TRANSITIONS` so the UI matches server validation.
 */
export function sellerOrderActions(status: OrderStatus): SellerOrderAction[] {
  return (SELLER_ORDER_TRANSITIONS[status] ?? []).map((target) => ({
    target,
    label: SELLER_ACTION_LABELS[target] ?? target,
    destructive: target === "cancelled",
  }));
}