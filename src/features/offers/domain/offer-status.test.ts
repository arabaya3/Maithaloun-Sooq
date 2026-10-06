import { describe, expect, it } from "vitest";

import { readOfferForm } from "@/features/offers/application/offer-form";
import { startOfStoreDay } from "@/shared/lib/store-time";

import { describeOfferValue, offerStatus } from "./offer-status";

const now = new Date("2026-10-06T12:00:00Z");
const base = { enabled: true, archived: false, startsAt: null, endsAt: null };

describe("offer status", () => {
  it("places an offer in exactly one group", () => {
    expect(offerStatus(base, now)).toBe("active");
    expect(offerStatus({ ...base, enabled: false }, now)).toBe("draft");
    expect(
      offerStatus({ ...base, startsAt: "2026-10-07T00:00:00Z" }, now),
    ).toBe("upcoming");
    expect(offerStatus({ ...base, archived: true }, now)).toBe("archived");
  });

  it("counts an ended window as expired even when still switched on or off", () => {
    const ended = { ...base, endsAt: "2026-10-06T12:00:00Z" };
    expect(offerStatus(ended, now)).toBe("expired");
    expect(offerStatus({ ...ended, enabled: false }, now)).toBe("expired");
  });

  it("describes the rule in shekels per piece", () => {
    expect(
      describeOfferValue({ kind: "amount_off", value: 250, minQuantity: 1 }),
    ).toBe("خصم 2.50 ₪ للقطعة");
    expect(
      describeOfferValue({ kind: "percentage", value: 15, minQuantity: 3 }),
    ).toBe("خصم 15٪ عند شراء 3 أو أكثر");
  });
});

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value])
      data.append(key, item);
  }
  return data;
}

const valid = {
  nameAr: "خصم الشتاء",
  kind: "fixed_price",
  value: "5.50",
  minQuantity: "2",
  startDate: "2026-11-01",
  endDate: "2026-11-07",
  enabled: "on",
  categoryCodes: ["kitchen"],
  productIds: ["general-cleaner", "BAD ID"],
};

describe("offer editor form", () => {
  it("reads shekels as agorot and makes the end date inclusive", () => {
    const read = readOfferForm(form(valid));
    expect(read).toEqual({
      input: {
        nameAr: "خصم الشتاء",
        displayText: null,
        kind: "fixed_price",
        value: 550,
        minQuantity: 2,
        startsAt: startOfStoreDay("2026-11-01"),
        endsAt: startOfStoreDay("2026-11-08"),
        enabled: true,
        targets: {
          productIds: ["general-cleaner"],
          variantIds: [],
          categoryCodes: ["kitchen"],
        },
      },
    });
  });

  it("names the field that is wrong", () => {
    expect(
      readOfferForm(form({ ...valid, kind: "percentage", value: "95" })),
    ).toEqual({ message: "أعلى نسبة خصم مسموحة 90٪." });
    expect(readOfferForm(form({ ...valid, value: "5 دولار ونص؟" }))).toEqual({
      message: "اكتبي المبلغ بالشيكل، مثل 5 أو 2.50.",
    });
    expect(readOfferForm(form({ ...valid, endDate: "2026-10-30" }))).toEqual({
      message: "تاريخ النهاية قبل تاريخ البداية.",
    });
    expect(readOfferForm(form({ ...valid, nameAr: "x" }))).toEqual({
      message: "اكتبي اسماً للعرض من 2 إلى 80 حرفاً.",
    });
  });
});
