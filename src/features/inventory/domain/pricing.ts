import {
  percentChangeBasisPoints,
  ratioBasisPoints,
} from "@/shared/lib/money-math";

export interface UnitMargin {
  profitAgorot: number;
  marginBasisPoints: number | null;
}

export function unitMargin(
  salePriceAgorot: number,
  costAgorot: number,
): UnitMargin {
  const profitAgorot = salePriceAgorot - costAgorot;
  return {
    profitAgorot,
    marginBasisPoints: ratioBasisPoints(profitAgorot, salePriceAgorot),
  };
}

export type PriceReviewAdvice = "loss" | "thin_margin" | "cost_increase" | "ok";

export const LOW_MARGIN_BASIS_POINTS = 1_000;
export const COST_INCREASE_REVIEW_BASIS_POINTS = 500;

export const priceReviewAdviceLabels: Record<PriceReviewAdvice, string> = {
  loss: "البيع بخسارة — راجعي السعر",
  thin_margin: "هامش ربح ضعيف",
  cost_increase: "ارتفعت التكلفة",
  ok: "لا يحتاج مراجعة",
};

export interface CostComparison {
  previousCostAgorot: number | null;
  newCostAgorot: number;
  costChangeBasisPoints: number | null;
  salePriceAgorot: number;
  profitAgorot: number;
  marginBasisPoints: number | null;
  advice: PriceReviewAdvice;
}

export function compareCostToSalePrice(input: {
  previousCostAgorot: number | null;
  newCostAgorot: number;
  salePriceAgorot: number;
}): CostComparison {
  const margin = unitMargin(input.salePriceAgorot, input.newCostAgorot);
  const costChangeBasisPoints = percentChangeBasisPoints(
    input.previousCostAgorot,
    input.newCostAgorot,
  );
  let advice: PriceReviewAdvice = "ok";
  if (margin.profitAgorot <= 0) advice = "loss";
  else if (
    margin.marginBasisPoints !== null &&
    margin.marginBasisPoints < LOW_MARGIN_BASIS_POINTS
  ) {
    advice = "thin_margin";
  } else if (
    costChangeBasisPoints !== null &&
    costChangeBasisPoints >= COST_INCREASE_REVIEW_BASIS_POINTS
  ) {
    advice = "cost_increase";
  }
  return {
    previousCostAgorot: input.previousCostAgorot,
    newCostAgorot: input.newCostAgorot,
    costChangeBasisPoints,
    salePriceAgorot: input.salePriceAgorot,
    profitAgorot: margin.profitAgorot,
    marginBasisPoints: margin.marginBasisPoints,
    advice,
  };
}
