import { toLatinDigits } from "@/shared/lib/digits";

export const MILLI = 1000;
export const MAX_QUANTITY_MILLI = 1_000_000_000;

const QUANTITY_PATTERN = /^\d{1,7}(?:[.,]\d{1,3})?$/;

export function parseQuantityToMilli(input: string): number | null {
  const trimmed = toLatinDigits(input).trim();
  if (!QUANTITY_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.replace(",", ".").split(".");
  const milli = Number(whole) * MILLI + Number(fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(milli) || milli > MAX_QUANTITY_MILLI) return null;
  return milli;
}

export function unitsToMilli(units: number): number {
  if (!Number.isInteger(units)) throw new RangeError("INVALID_QUANTITY");
  return units * MILLI;
}

export function formatQuantity(milli: number): string {
  const sign = milli < 0 ? "-" : "";
  const absolute = Math.abs(milli);
  const whole = Math.trunc(absolute / MILLI);
  const fraction = String(absolute % MILLI)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
