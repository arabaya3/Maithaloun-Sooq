import { proportionAgorot, unitAmountAgorot } from "@/shared/lib/money-math";

export interface StockState {
  onHandMilli: number;
  valueAgorot: number;
}

export class InsufficientStockError extends Error {
  constructor() {
    super("INSUFFICIENT_STOCK");
    this.name = "InsufficientStockError";
  }
}

export function averageCostAgorot(state: StockState): number | null {
  if (state.onHandMilli <= 0) return null;
  return unitAmountAgorot(state.valueAgorot, state.onHandMilli);
}

export function receiveStock(
  state: StockState,
  quantityMilli: number,
  costAgorot: number,
): StockState {
  if (quantityMilli <= 0 || costAgorot < 0) {
    throw new RangeError("INVALID_RECEIPT");
  }
  return {
    onHandMilli: state.onHandMilli + quantityMilli,
    valueAgorot: state.valueAgorot + costAgorot,
  };
}

// Issuing the full balance removes the exact remaining value, so no rounding residue stays behind.
export function issueCostAgorot(
  state: StockState,
  quantityMilli: number,
): number {
  if (quantityMilli <= 0) throw new RangeError("INVALID_ISSUE");
  if (quantityMilli > state.onHandMilli) throw new InsufficientStockError();
  return proportionAgorot(state.valueAgorot, quantityMilli, state.onHandMilli);
}

export function issueStock(
  state: StockState,
  quantityMilli: number,
): { state: StockState; costAgorot: number } {
  const costAgorot = issueCostAgorot(state, quantityMilli);
  return {
    costAgorot,
    state: {
      onHandMilli: state.onHandMilli - quantityMilli,
      valueAgorot: state.valueAgorot - costAgorot,
    },
  };
}
