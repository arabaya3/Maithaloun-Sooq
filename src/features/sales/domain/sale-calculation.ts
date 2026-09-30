import {
  lineTotalAgorot,
  proportionAgorot,
  ratioBasisPoints,
  sumAgorot,
} from "@/shared/lib/money-math";

export type SaleCalculationErrorCode =
  "discount_exceeds_subtotal" | "paid_exceeds_total" | "cash_sale_must_be_paid";

export class SaleCalculationError extends Error {
  constructor(readonly code: SaleCalculationErrorCode) {
    super(code);
    this.name = "SaleCalculationError";
  }
}

export interface SaleLineAmounts {
  quantityMilli: number;
  unitPriceAgorot: number;
}

export interface SaleTotals {
  lineTotalsAgorot: number[];
  subtotalAgorot: number;
  discountAgorot: number;
  totalAgorot: number;
  paidAgorot: number;
  remainingAgorot: number;
}

export function calculateSale(input: {
  lines: readonly SaleLineAmounts[];
  discountAgorot: number;
  paidAgorot: number;
  hasCustomer: boolean;
}): SaleTotals {
  const lineTotalsAgorot = input.lines.map((line) =>
    lineTotalAgorot(line.quantityMilli, line.unitPriceAgorot),
  );
  const subtotalAgorot = sumAgorot(lineTotalsAgorot);
  if (input.discountAgorot > subtotalAgorot) {
    throw new SaleCalculationError("discount_exceeds_subtotal");
  }
  const totalAgorot = subtotalAgorot - input.discountAgorot;
  if (input.paidAgorot > totalAgorot) {
    throw new SaleCalculationError("paid_exceeds_total");
  }
  // Credit needs a named customer; an anonymous sale cannot leave a balance behind.
  if (!input.hasCustomer && input.paidAgorot !== totalAgorot) {
    throw new SaleCalculationError("cash_sale_must_be_paid");
  }
  return {
    lineTotalsAgorot,
    subtotalAgorot,
    discountAgorot: input.discountAgorot,
    totalAgorot,
    paidAgorot: input.paidAgorot,
    remainingAgorot: totalAgorot - input.paidAgorot,
  };
}

export interface SaleProfit {
  complete: boolean;
  revenueAgorot: number;
  cogsAgorot: number;
  grossProfitAgorot: number;
  marginBasisPoints: number | null;
}

// Profit uses the cost recorded on each line at sale time, never today's cost.
// Lines without a recorded cost are excluded and the result is marked incomplete.
export function saleProfit(input: {
  lines: ReadonlyArray<{ lineTotalAgorot: number; cogsAgorot: number | null }>;
  subtotalAgorot: number;
  discountAgorot: number;
}): SaleProfit {
  const known = input.lines.filter((line) => line.cogsAgorot !== null);
  const complete = known.length === input.lines.length;
  const knownRevenue = sumAgorot(known.map((line) => line.lineTotalAgorot));
  const discountShare =
    input.subtotalAgorot > 0
      ? proportionAgorot(
          input.discountAgorot,
          knownRevenue,
          input.subtotalAgorot,
        )
      : 0;
  const revenueAgorot = knownRevenue - discountShare;
  const cogsAgorot = sumAgorot(known.map((line) => line.cogsAgorot ?? 0));
  const grossProfitAgorot = revenueAgorot - cogsAgorot;
  return {
    complete,
    revenueAgorot,
    cogsAgorot,
    grossProfitAgorot,
    marginBasisPoints: ratioBasisPoints(grossProfitAgorot, revenueAgorot),
  };
}
