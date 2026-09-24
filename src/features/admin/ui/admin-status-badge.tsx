import {
  getPrimaryNextActionLabel,
  getPrimaryNextStatus,
  orderStatusLabels,
  type OrderStatus,
} from "@/features/orders/domain/order-status";

export function shortenOrderReference(reference: string): string {
  if (!reference.startsWith("MS-") || reference.length < 10) return reference;
  return `MS-…${reference.slice(-8)}`;
}

export function formatAdminRelativeTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  const formatter = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });
  if (absMinutes < 60) {
    return formatter.format(Math.round(diffMs / 60_000), "minute");
  }
  const absHours = Math.round(Math.abs(diffMs) / 3_600_000);
  if (absHours < 24) {
    return formatter.format(Math.round(diffMs / 3_600_000), "hour");
  }
  return formatter.format(Math.round(diffMs / 86_400_000), "day");
}

export function AdminStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`admin-status-badge admin-status-badge--${status}`}>
      <span className="admin-status-dot" aria-hidden="true" />
      {orderStatusLabels[status]}
    </span>
  );
}

export function AdminNextActionLabel({ status }: { status: OrderStatus }) {
  const label = getPrimaryNextActionLabel(status);
  if (!label) {
    return <span className="admin-muted admin-next-idle">مكتمل</span>;
  }
  return <span className="admin-next-label">{label}</span>;
}

export function getNextActionHref(
  publicReference: string,
  status: OrderStatus,
): string | null {
  const next = getPrimaryNextStatus(status);
  if (!next) return null;
  return `/admin/orders/${publicReference}`;
}
