export type StockStatus = "out" | "low" | "ok";

export const stockStatusLabels: Record<StockStatus, string> = {
  out: "نفد",
  low: "قارب على النفاد",
  ok: "متوفر",
};

export function availableMilli(input: {
  onHandMilli: number;
  reservedMilli: number;
}): number {
  return input.onHandMilli - input.reservedMilli;
}

export function resolveStockStatus(input: {
  onHandMilli: number;
  reservedMilli: number;
  reorderThresholdMilli: number | null;
}): StockStatus {
  const available = availableMilli(input);
  if (available <= 0) return "out";
  if (
    input.reorderThresholdMilli !== null &&
    available <= input.reorderThresholdMilli
  ) {
    return "low";
  }
  return "ok";
}
