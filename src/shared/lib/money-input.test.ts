import { describe, expect, it } from "vitest";

import { parseMoneyInput } from "./money-input";

describe("parseMoneyInput", () => {
  it.each([
    ["10", 1_000],
    ["10 شيكل", 1_000],
    ["10 ش", 1_000],
    ["10ش", 1_000],
    ["₪10", 1_000],
    ["₪ 15", 1_500],
    ["15 ₪", 1_500],
    ["10.5", 1_050],
    ["10.50", 1_050],
    ["10,5", 1_050],
    ["10,50", 1_050],
    ["١٠", 1_000],
    ["١٢٫٥ شيكل", 1_250],
    ["عشرة", 1_000],
    ["عشره شيكل", 1_000],
    ["خمستعش", 1_500],
    ["خمسطعش شيكل", 1_500],
    ["خمسة عشر", 1_500],
    ["خمسة عشر شيكل", 1_500],
    ["عشرين شيكل", 2_000],
    ["خمسة وعشرين", 2_500],
    ["واحد", 100],
    ["اطنعش", 1_200],
    ["مية", 10_000],
    ["مية وخمسين", 15_000],
    ["تلات مية", 30_000],
    ["عشرة ونص", 1_050],
    ["  7 شواكل ", 700],
  ])("%s → %i agorot", (input, agorot) => {
    expect(parseMoneyInput(input)).toEqual({ ok: true, agorot });
  });

  it.each([
    ["", "price_missing"],
    ["شيكل", "price_missing"],
    ["-5", "price_negative"],
    ["سالب 5", "price_negative"],
    ["0", "price_zero"],
    ["10.555", "price_precision"],
    ["1,000", "price_ambiguous"],
    ["10 أو 12", "price_ambiguous"],
    ["10-12", "price_ambiguous"],
    ["10+5", "price_ambiguous"],
    ["200000", "price_out_of_range"],
    ["شوي", "price_invalid"],
    ["عشرة دولار", "price_invalid"],
    ["خمسة ستة", "price_invalid"],
  ])("rejects %s with %s", (input, code) => {
    expect(parseMoneyInput(input)).toEqual({ ok: false, code });
  });

  it("allows zero only when the caller asks", () => {
    expect(parseMoneyInput("0", { allowZero: true })).toEqual({
      ok: true,
      agorot: 0,
    });
  });
});
