import { describe, expect, it } from "vitest";

import { parseMoneyInput } from "@/shared/lib/money-input";

import {
  analyzeAmounts,
  checkStatedAmounts,
  conflictingAmountQuestion,
  isAmbiguousSource,
  suppliedAmounts,
} from "./amount-guard";

describe("money parser signs and zero", () => {
  it("rejects every negative form and zero", () => {
    for (const text of [
      "سالب خمسة",
      "-5",
      "ناقص خمسة",
      "خمسة بالسالب",
      "سالب 5 شيكل",
    ]) {
      expect(parseMoneyInput(text)).toEqual({
        ok: false,
        code: "price_negative",
      });
    }
    expect(parseMoneyInput("صفر")).toEqual({ ok: false, code: "price_zero" });
    expect(parseMoneyInput("0 شيكل")).toEqual({
      ok: false,
      code: "price_zero",
    });
    expect(parseMoneyInput("50 ولا 70")).toEqual({
      ok: false,
      code: "price_ambiguous",
    });
  });
});

describe("amounts the owner actually stated", () => {
  it("reads digits, Arabic-Indic digits, spoken prices and prefixes", () => {
    const values = (text: string) =>
      analyzeAmounts(text).amounts.map((row) => row.agorot);
    expect(values("أم محمد دفعت مية وخمسين شيكل")).toEqual([15_000]);
    expect(values("ضيفي ليفة بعشرة ونص شيكل")).toEqual([1_050]);
    expect(values("خلي سعره ١٦ شيكل")).toEqual([1_600]);
    expect(values("بسعر 4,5 شيكل")).toEqual([450]);
    expect(values("السعر ₪ 18")).toEqual([1_800]);
  });

  it("ignores sizes, counts, percentages, codes and barcodes", () => {
    const values = (text: string) =>
      analyzeAmounts(text).amounts.map((row) => row.agorot);
    expect(values("فينيسيا الأزرق ٢٥٠ مل ١٦ شيكل")).toEqual([1_600]);
    expect(values("خصم 10 بالمية")).toEqual([]);
    expect(values("حطي SKU GC-001 وباركود 7290099998888")).toEqual([]);
    expect(values("نص كيلو")).toEqual([]);
  });

  it("flags negative, conflicting and uncertain amounts", () => {
    for (const text of ["سالب خمسة", "-5", "ناقص خمسة", "خمسة بالسالب"]) {
      expect(analyzeAmounts(text).negative).toBe(true);
    }
    expect(
      analyzeAmounts("دفعت 50 شيكل، لا 70، مش متأكدة 50 ولا 70").conflicting,
    ).toBe(true);
    expect(analyzeAmounts("دفعت 50 أو 70").conflicting).toBe(true);
    expect(analyzeAmounts("لا، خلي سعره 12 بدل 10").conflicting).toBe(false);
    expect(analyzeAmounts("دفعت تقريباً 50").uncertain).toBe(true);
    expect(analyzeAmounts("بعت 2 بسعر 7 ودفعت 14 شيكل").conflicting).toBe(
      false,
    );
  });
});

describe("checkStatedAmounts", () => {
  it("refuses whatever the model sends when the owner's message is unclear", () => {
    expect(
      checkStatedAmounts("أم محمد دفعت 50 شيكل، لا 70، مش متأكدة", ["50"]),
    ).toEqual({ problem: "amount_conflict", values: ["50 ₪", "70 ₪"] });
    expect(checkStatedAmounts("خلي سعر منظف عام سالب 5 شيكل", ["5"])).toEqual({
      problem: "amount_negative",
      values: ["5 ₪"],
    });
    expect(checkStatedAmounts("سعره خمسة بالسالب", ["خمسة"])?.problem).toBe(
      "amount_negative",
    );
    expect(checkStatedAmounts("دفعت تقريباً 50", ["50"])?.problem).toBe(
      "amount_uncertain",
    );
    expect(checkStatedAmounts("خلي السعر صفر", ["0"])?.problem).toBe(
      "amount_zero",
    );
    expect(
      checkStatedAmounts("دفعت 50 شيكل وبعدين 70 شيكل", ["70"])?.problem,
    ).toBe("amount_conflict");
  });

  it("refuses an amount the owner never said", () => {
    expect(checkStatedAmounts("أم محمد دفعت 50 شيكل", ["70"])).toEqual({
      problem: "amount_mismatch",
      values: ["50 ₪"],
    });
  });

  it("accepts a single clear amount in any written form", () => {
    expect(checkStatedAmounts("أم محمد دفعت مية وخمسين شيكل", ["150"])).toBe(
      null,
    );
    expect(
      checkStatedAmounts("خلي سعر فينيسيا الأزرق ٢٥٠ مل ١٦ شيكل", ["16"]),
    ).toBe(null);
    expect(checkStatedAmounts("بعت 2 بسعر 7 ودفعت 14 شيكل", ["7", "14"])).toBe(
      null,
    );
    expect(checkStatedAmounts("غيري اسم المنتج", [])).toBe(null);
  });
});

describe("pre-model conflict question", () => {
  it("asks which amount, listing both, only for real alternatives", () => {
    expect(
      conflictingAmountQuestion("أم محمد دفعت 50 شيكل، لا 70، مش متأكدة"),
    ).toEqual({
      question: "ذكرتِ أكثر من مبلغ. أي مبلغ هو الصحيح؟ (50 ₪ أو 70 ₪)",
      values: ["50 ₪", "70 ₪"],
    });
    expect(conflictingAmountQuestion("لا، خلي سعره 12 بدل 10")).toBeNull();
    expect(conflictingAmountQuestion("بعت 2 بسعر 7 ودفعت 14 شيكل")).toBeNull();
  });
});

describe("confirmation-layer source check", () => {
  it("treats negative, conflicting and uncertain messages as ambiguous", () => {
    expect(isAmbiguousSource("دفعت 50 ولا 70")).toBe(true);
    expect(isAmbiguousSource("سالب 5 شيكل")).toBe(true);
    expect(isAmbiguousSource("دفعت يمكن 50")).toBe(true);
    expect(isAmbiguousSource("دفعت 50 شيكل")).toBe(false);
  });

  it("finds every amount field, including nested lines", () => {
    expect(
      suppliedAmounts({
        customer: "أم محمد",
        lines: [{ product: "مبيض", unitPriceIls: "8" }],
        paidIls: "16",
        note: "50",
      }),
    ).toEqual(["8", "16"]);
  });
});
