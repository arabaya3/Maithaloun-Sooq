export const orderStatuses = [
  "pending",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export const terminalOrderStatuses = ["delivered", "cancelled"] as const;
export type TerminalOrderStatus = (typeof terminalOrderStatuses)[number];

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "جديد",
  confirmed: "مؤكّد",
  preparing: "قيد التجهيز",
  out_for_delivery: "خرج للتوصيل",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

/** Next primary action label for operational queues (non-cancel). */
export function getPrimaryNextStatus(status: OrderStatus): OrderStatus | null {
  const next = allowedTransitions[status].find(
    (candidate) => candidate !== "cancelled",
  );
  return next ?? null;
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (orderStatuses as readonly string[]).includes(value);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return (terminalOrderStatuses as readonly OrderStatus[]).includes(status);
}

export function getAllowedTransitions(
  status: OrderStatus,
): readonly OrderStatus[] {
  return allowedTransitions[status];
}

export function canTransitionOrderStatus(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}
