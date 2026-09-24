import {
  getPrimaryNextStatus,
  orderStatusLabels,
  type OrderStatus,
} from "@/features/orders/domain/order-status";

export function AdminStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`admin-status-badge admin-status-badge--${status}`}>
      <span className="admin-status-dot" aria-hidden="true" />
      {orderStatusLabels[status]}
    </span>
  );
}

export function AdminNextActionLabel({ status }: { status: OrderStatus }) {
  const next = getPrimaryNextStatus(status);
  if (!next) return <span className="admin-muted">لا إجراء</span>;
  return <span>التالي: {orderStatusLabels[next]}</span>;
}
