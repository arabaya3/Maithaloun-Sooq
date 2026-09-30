import { describe, expect, it } from "vitest";

import { toLatinDigits } from "./digits";
import {
  formatBasisPoints,
  lineTotalAgorot,
  percentChangeBasisPoints,
  proportionAgorot,
  ratioBasisPoints,
  roundDiv,
  unitAmountAgorot,
} from "./money-math";
import { normalizeArabicText, normalizeReference } from "./normalize-arabic";

describe("money math", () => {
  it("rounds half up without floating point", () => {
    expect(roundDiv(BigInt(5), BigInt(2))).toBe(BigInt(3));
    expect(roundDiv(BigInt(4), BigInt(3))).toBe(BigInt(1));
    expect(roundDiv(BigInt(-5), BigInt(2))).toBe(BigInt(-3));
    expect(() => roundDiv(BigInt(1), BigInt(0))).toThrow(RangeError);
  });

  it("multiplies decimal quantities by integer prices", () => {
    expect(lineTotalAgorot(2_000, 1_250)).toBe(2_500);
    expect(lineTotalAgorot(1_500, 333)).toBe(500);
    expect(lineTotalAgorot(250, 1_999)).toBe(500);
    expect(lineTotalAgorot(1_000_000_000, 10_000_000)).toBe(10_000_000_000_000);
  });

  it("derives a unit amount from a total", () => {
    expect(unitAmountAgorot(4_000, 12_000)).toBe(333);
    expect(unitAmountAgorot(1_000, 3_000)).toBe(333);
    expect(unitAmountAgorot(2_000, 3_000)).toBe(667);
  });

  it("splits a total proportionally", () => {
    expect(proportionAgorot(1_000, 1, 3)).toBe(333);
    expect(proportionAgorot(1_000, 3, 3)).toBe(1_000);
  });

  it("expresses ratios in basis points", () => {
    expect(ratioBasisPoints(25, 100)).toBe(2_500);
    expect(ratioBasisPoints(1, 0)).toBeNull();
    expect(percentChangeBasisPoints(800, 1_000)).toBe(2_500);
    expect(percentChangeBasisPoints(1_000, 900)).toBe(-1_000);
    expect(percentChangeBasisPoints(null, 900)).toBeNull();
    expect(formatBasisPoints(2_500)).toBe("25%");
    expect(formatBasisPoints(1_250)).toBe("12.5%");
    expect(formatBasisPoints(-333)).toBe("-3.33%");
  });
});

describe("text normalisation", () => {
  it("converts Arabic digits to Latin", () => {
    expect(toLatinDigits("١٢٫٥")).toBe("12.5");
    expect(toLatinDigits("۴۵")).toBe("45");
  });

  it("matches Arabic names regardless of hamza, taa marbuta and diacritics", () => {
    expect(normalizeArabicText("أُمّ مُحمَّد")).toBe(
      normalizeArabicText("ام محمد"),
    );
    expect(normalizeArabicText("منظّف  أرضيات")).toBe("منظف ارضيات");
    expect(normalizeArabicText("كرتونة")).toBe(normalizeArabicText("كرتونه"));
    expect(normalizeArabicText("Arar  Dish")).toBe("arar dish");
  });

  it("normalises invoice references", () => {
    expect(normalizeReference(" inv-٠٠١٢ / a ")).toBe("INV0012A");
  });
});
