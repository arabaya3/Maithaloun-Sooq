import type { AdminOrderDetail } from "@/features/admin/application/admin-order-service";
import {
  formatQuantity,
  unitsToMilli,
} from "@/features/inventory/domain/quantity";

type Stock = AdminOrderDetail["items"][number]["stock"];

const reservationLabels = {
  active: "محجوز من المخزون",
  released: "أُلغي الحجز",
  fulfilled: "خُصم من المخزون",
} as const;

export function OrderItemStockNote({
  stock,
  baseUnits,
}: {
  stock: Stock;
  // Pieces the line needs from stock, so a 3-pack is compared as three pieces.
  baseUnits: number;
}) {
  if (!stock.tracked) {
    return <small className="admin-stock-note">غير متتبَّع في المخزون</small>;
  }
  if (stock.reservation) {
    return (
      <small className="admin-stock-note">
        {reservationLabels[stock.reservation]}
      </small>
    );
  }
  const available = stock.availableMilli ?? 0;
  const enough = available >= unitsToMilli(baseUnits);
  return (
    <small
      className={
        enough ? "admin-stock-note" : "admin-stock-note admin-stock-note--short"
      }
    >
      {enough ? "المتوفر: " : "غير كافٍ — المتوفر: "}
      <bdi dir="ltr">{formatQuantity(available)}</bdi>
    </small>
  );
}
