import { describe, expect, it } from "vitest";

import { statusImpact, type ImpactLine } from "./status-impact";

const line = (overrides: Partial<ImpactLine> = {}): ImpactLine => ({
  name: "منظف عام",
  pieces: 2,
  tracked: true,
  reservation: null,
  availableMilli: 10_000,
  ...overrides,
});

describe("status change impact", () => {
  it("confirming reserves tracked stock and leaves untracked lines alone", () => {
    const impact = statusImpact(
      "confirmed",
      [line(), line({ name: "فرشاة", tracked: false, availableMilli: null })],
      1_400,
    );
    expect(impact.blocked).toBe(false);
    expect(impact.stock).toEqual([
      "يُحجز 2 من «منظف عام» (لا يُخصم قبل التسليم).",
      "«فرشاة» غير متتبَّع في المخزون، فلا يتغير.",
    ]);
    expect(impact.money).toBe("لا يُحصَّل أي مبلغ الآن؛ الدفع عند التسليم.");
  });

  it("blocks a confirm the stock cannot cover, naming the shortage", () => {
    const impact = statusImpact(
      "confirmed",
      [line({ availableMilli: 1_000 })],
      1_400,
    );
    expect(impact.blocked).toBe(true);
    expect(impact.stock[0]).toBe("«منظف عام»: يحتاج 2 والمتوفر 1 فقط.");
  });

  it("delivery deducts and collects the order total", () => {
    const impact = statusImpact(
      "delivered",
      [line({ reservation: "active" })],
      1_400,
    );
    expect(impact.stock).toEqual([
      "يُخصم 2 من «منظف عام» نهائياً وتُحسب تكلفته.",
    ]);
    expect(impact.money).toBe(
      "يُحصَّل 14 ₪ من الزبون عند التسليم ويدخل في مبيعات اليوم.",
    );
  });

  it("cancelling releases only active reservations and refunds nothing on cash on delivery", () => {
    expect(
      statusImpact("cancelled", [line({ reservation: "active" })], 1_400).stock,
    ).toEqual(["يُفك حجز 2 من «منظف عام» ويعود متاحاً للبيع."]);
    expect(statusImpact("cancelled", [line()], 1_400)).toMatchObject({
      stock: ["لا يوجد حجز لهذا الطلب، فلا يتغير المخزون."],
      money: "لا يوجد مبلغ مدفوع لإرجاعه؛ الطلب بالدفع عند التسليم.",
      blocked: false,
    });
  });

  it("preparing and dispatch change nothing", () => {
    expect(
      statusImpact("preparing", [line({ reservation: "active" })], 1_400).stock,
    ).toEqual(["لا يتغير المخزون؛ تبقى الكميات محجوزة لهذا الطلب."]);
    expect(
      statusImpact("out_for_delivery", [line({ tracked: false })], null).stock,
    ).toEqual(["لا يتغير المخزون."]);
  });
});
