const MILLI = BigInt(1000);
const TWO = BigInt(2);
const ZERO = BigInt(0);
const BASIS_POINTS = BigInt(10_000);

// Half-up integer division for non-negative numerators; money never uses floats.
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= ZERO) throw new RangeError("INVALID_DENOMINATOR");
  if (numerator < ZERO) return -roundDiv(-numerator, denominator);
  return (numerator * TWO + denominator) / (denominator * TWO);
}

function toSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError("AMOUNT_OVERFLOW");
  return result;
}

export function lineTotalAgorot(
  quantityMilli: number,
  unitAgorot: number,
): number {
  return toSafeNumber(
    roundDiv(BigInt(quantityMilli) * BigInt(unitAgorot), MILLI),
  );
}

export function unitAmountAgorot(
  totalAgorot: number,
  quantityMilli: number,
): number {
  return toSafeNumber(
    roundDiv(BigInt(totalAgorot) * MILLI, BigInt(quantityMilli)),
  );
}

export function proportionAgorot(
  totalAgorot: number,
  part: number,
  whole: number,
): number {
  return toSafeNumber(
    roundDiv(BigInt(totalAgorot) * BigInt(part), BigInt(whole)),
  );
}

export function ratioBasisPoints(
  numerator: number,
  denominator: number,
): number | null {
  if (denominator <= 0) return null;
  return toSafeNumber(
    roundDiv(BigInt(numerator) * BASIS_POINTS, BigInt(denominator)),
  );
}

export function percentChangeBasisPoints(
  previous: number | null,
  next: number,
): number | null {
  if (previous === null || previous <= 0) return null;
  return ratioBasisPoints(next - previous, previous);
}

export function formatBasisPoints(basisPoints: number): string {
  const sign = basisPoints < 0 ? "-" : "";
  const absolute = Math.abs(basisPoints);
  const whole = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  const digits =
    fraction === 0
      ? ""
      : `.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
  return `${sign}${whole}${digits}%`;
}

export function sumAgorot(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError("AMOUNT_OVERFLOW");
  return total;
}
