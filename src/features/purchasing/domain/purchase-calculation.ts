import {
  lineTotalAgorot,
  proportionAgorot,
  sumAgorot,
  unitAmountAgorot,
} from "@/shared/lib/money-math";

import type { PurchasePaymentStatus } from "./purchase-constants";

export type PurchaseCalculationErrorCode =
  | "line_discount_exceeds_line"
  | "discount_exceeds_subtotal"
  | "paid_exceeds_total";

export class PurchaseCalculationError extends Error {
  constructor(
    readonly code: PurchaseCalculationErrorCode,
    readonly lineIndex?: number,
  ) {
    super(code);
    this.name = "PurchaseCalculationError";
  }
}

export interface PurchaseLineAmounts {
  quantityMilli: number;
  packQuantity: number;
  unitCostAgorot: number;
  lineDiscountAgorot: number;
}

export interface PurchaseLineTotals {
  stockQuantityMilli: number;
  lineTotalAgorot: number;
  costAgorot: number;
  stockUnitCostAgorot: number;
}

export interface PurchaseTotals {
  lines: PurchaseLineTotals[];
  subtotalAgorot: number;
  discountAgorot: number;
  taxAgorot: number | null;
  totalAgorot: number;
}

// Invoice-level discount and tax are spread over the lines so stock value rises by exactly the invoice total.
function allocateAdjustment(
  lineTotals: readonly number[],
  subtotal: number,
  adjustment: number,
): number[] {
  if (adjustment === 0 || subtotal === 0) {
    const costs = [...lineTotals];
    if (adjustment !== 0 && costs.length) costs[0] = costs[0]! + adjustment;
    return costs;
  }
  const costs = lineTotals.map(
    (total) => total + proportionAgorot(adjustment, total, subtotal),
  );
  const residue = subtotal + adjustment - sumAgorot(costs);
  if (residue !== 0) {
    const largest = lineTotals.indexOf(Math.max(...lineTotals));
    costs[largest] = costs[largest]! + residue;
  }
  return costs;
}

export function calculatePurchase(input: {
  lines: readonly PurchaseLineAmounts[];
  discountAgorot: number;
  taxAgorot: number | null;
}): PurchaseTotals {
  const lineTotals = input.lines.map((line, index) => {
    const gross = lineTotalAgorot(line.quantityMilli, line.unitCostAgorot);
    if (line.lineDiscountAgorot > gross) {
      throw new PurchaseCalculationError("line_discount_exceeds_line", index);
    }
    return gross - line.lineDiscountAgorot;
  });
  const subtotalAgorot = sumAgorot(lineTotals);
  if (input.discountAgorot > subtotalAgorot) {
    throw new PurchaseCalculationError("discount_exceeds_subtotal");
  }
  const totalAgorot =
    subtotalAgorot - input.discountAgorot + (input.taxAgorot ?? 0);
  const costs = allocateAdjustment(
    lineTotals,
    subtotalAgorot,
    totalAgorot - subtotalAgorot,
  );

  return {
    subtotalAgorot,
    discountAgorot: input.discountAgorot,
    taxAgorot: input.taxAgorot,
    totalAgorot,
    lines: input.lines.map((line, index) => {
      const stockQuantityMilli = line.quantityMilli * line.packQuantity;
      const costAgorot = costs[index]!;
      return {
        stockQuantityMilli,
        lineTotalAgorot: lineTotals[index]!,
        costAgorot,
        stockUnitCostAgorot: unitAmountAgorot(costAgorot, stockQuantityMilli),
      };
    }),
  };
}

export function resolvePaymentStatus(
  totalAgorot: number,
  paidAgorot: number,
): PurchasePaymentStatus {
  if (paidAgorot > totalAgorot) {
    throw new PurchaseCalculationError("paid_exceeds_total");
  }
  if (paidAgorot === totalAgorot) return "paid";
  return paidAgorot === 0 ? "unpaid" : "partially_paid";
}

export function printedTotalDifference(
  calculatedTotalAgorot: number,
  printedTotalAgorot: number | null,
): number | null {
  if (printedTotalAgorot === null) return null;
  return calculatedTotalAgorot - printedTotalAgorot;
}
