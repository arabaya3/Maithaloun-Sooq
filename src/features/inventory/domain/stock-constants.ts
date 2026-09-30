export const stockUnits = [
  "piece",
  "carton",
  "pack",
  "dozen",
  "kg",
  "gram",
  "liter",
  "ml",
] as const;
export type StockUnit = (typeof stockUnits)[number];

export const stockUnitLabels: Record<StockUnit, string> = {
  piece: "حبة",
  carton: "كرتونة",
  pack: "رزمة",
  dozen: "دزينة",
  kg: "كغم",
  gram: "غرام",
  liter: "لتر",
  ml: "مل",
};

export const stockMovementReasons = [
  "purchase_receipt",
  "order_reservation",
  "reservation_release",
  "order_fulfillment",
  "manual_sale",
  "customer_return",
  "supplier_return",
  "damaged",
  "expired",
  "correction",
  "opening_balance",
] as const;
export type StockMovementReason = (typeof stockMovementReasons)[number];

export const stockMovementReasonLabels: Record<StockMovementReason, string> = {
  purchase_receipt: "استلام شراء",
  order_reservation: "حجز لطلب",
  reservation_release: "إلغاء حجز",
  order_fulfillment: "تسليم طلب",
  manual_sale: "بيع مباشر",
  customer_return: "مرتجع من زبون",
  supplier_return: "مرتجع للمورد",
  damaged: "تالف",
  expired: "منتهي الصلاحية",
  correction: "تصحيح جرد",
  opening_balance: "رصيد افتتاحي",
};

export const adjustmentReasons = [
  "opening_balance",
  "correction",
  "damaged",
  "expired",
  "customer_return",
  "supplier_return",
] as const;
export type AdjustmentReason = (typeof adjustmentReasons)[number];

export const stockInAdjustmentReasons: readonly AdjustmentReason[] = [
  "opening_balance",
  "customer_return",
];
export const stockOutAdjustmentReasons: readonly AdjustmentReason[] = [
  "damaged",
  "expired",
  "supplier_return",
];
