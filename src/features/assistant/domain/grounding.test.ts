import { describe, expect, it } from "vitest";

import { checkGrounding } from "./grounding";

const card = JSON.stringify({
  status: "awaiting_confirmation",
  summary: "تعديل سعر منظف عام من 7 ₪ إلى 9.5 ₪",
});

describe("checkGrounding", () => {
  it("allows figures that come from this request's tool results or the owner's message", () => {
    expect(
      checkGrounding({
        text: "سعر منظف عام الحالي 7 ₪ وسيصبح 9.5 ₪ بعد التأكيد.",
        evidence: [card],
      }),
    ).toBeNull();
    expect(
      checkGrounding({
        text: "تمام، السعر الجديد 12 شيكل؟",
        evidence: ["غيري سعر المنظف إلى 12 شيكل"],
      }),
    ).toBeNull();
    expect(
      checkGrounding({
        text: "المخزون 24 حبة.",
        evidence: [JSON.stringify({ quantityMilli: 24000, onHand: 24 })],
      }),
    ).toBeNull();
    expect(
      checkGrounding({
        text: "الرصيد 150 ₪",
        evidence: [JSON.stringify({ balanceAgorot: 15000 })],
      }),
    ).toBeNull();
    expect(
      checkGrounding({
        text: "صافي المبيعات 1,250.5 ₪",
        evidence: [JSON.stringify({ netSales: "1,250.5 ₪" })],
      }),
    ).toBeNull();
  });

  it("blocks invented money and quantities", () => {
    expect(checkGrounding({ text: "سعر المنظف 15 ₪.", evidence: [] })).toBe(
      "ungrounded_figure",
    );
    expect(
      checkGrounding({
        text: "عندك ٣٠ حبة من المنظف.",
        evidence: [JSON.stringify({ onHand: 12 })],
      }),
    ).toBe("ungrounded_figure");
    expect(
      checkGrounding({ text: "ربحك هذا الأسبوع ₪ 420", evidence: [card] }),
    ).toBe("ungrounded_figure");
  });

  it("blocks completion claims in chat", () => {
    for (const text of [
      "تم تعديل السعر.",
      "تمت إضافة المنتج بنجاح",
      "خلص انضاف المنتج",
      "المنتج انحذف",
      "تم الدفع",
      "تم التنفيذ ✅",
    ]) {
      expect(checkGrounding({ text, evidence: [card] })).toBe(
        "premature_success",
      );
    }
  });

  it("keeps ordinary guidance untouched", () => {
    expect(
      checkGrounding({
        text: "جهزت التعديل، بانتظار تأكيدك في البطاقة.",
        evidence: [],
      }),
    ).toBeNull();
    expect(
      checkGrounding({ text: "شو اسم المنتج اللي بدك تعدليه؟", evidence: [] }),
    ).toBeNull();
  });
});
