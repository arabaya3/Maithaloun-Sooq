import { describe, expect, it } from "vitest";

import {
  isOfferLive,
  offerLabel,
  offerUnitPrice,
  offerForSellingUnit,
  priceForQuantity,
  priceSellingUnit,
  windowsOverlap,
  type VariantOffer,
} from "./offer-pricing";

const offer = (overrides: Partial<VariantOffer> = {}): VariantOffer => ({
  offerId: "o1",
  nameAr: "عرض",
  displayText: null,
  kind: "percentage",
  value: 10,
  minQuantity: 1,
  endsAt: null,
  ...overrides,
});

describe("offer pricing", () => {
  it("computes integer prices that stay above zero and below the list price", () => {
    expect(offerUnitPrice(1_250, { kind: "percentage", value: 10 })).toBe(
      1_125,
    );
    expect(offerUnitPrice(999, { kind: "percentage", value: 33 })).toBe(669);
    expect(offerUnitPrice(1_000, { kind: "amount_off", value: 250 })).toBe(750);
    expect(offerUnitPrice(1_000, { kind: "fixed_price", value: 800 })).toBe(
      800,
    );
    expect(
      offerUnitPrice(1_000, { kind: "amount_off", value: 1_000 }),
    ).toBeNull();
    expect(
      offerUnitPrice(1_000, { kind: "amount_off", value: 1_500 }),
    ).toBeNull();
    expect(
      offerUnitPrice(1_000, { kind: "fixed_price", value: 1_000 }),
    ).toBeNull();
  });

  it("applies a minimum-quantity offer only from that quantity", () => {
    const variant = { priceAgorot: 1_000, offer: offer({ minQuantity: 3 }) };
    expect(priceForQuantity(variant, 2)).toEqual({
      unitPriceAgorot: 1_000,
      listUnitPriceAgorot: 1_000,
      offerId: null,
    });
    expect(priceForQuantity(variant, 3)).toEqual({
      unitPriceAgorot: 900,
      listUnitPriceAgorot: 1_000,
      offerId: "o1",
    });
    expect(offerLabel(variant.offer)).toBe("خصم 10٪ عند شراء 3 أو أكثر");
  });

  it("treats the start as inclusive and the end as exclusive", () => {
    const startsAt = new Date("2026-10-10T00:00:00Z");
    const endsAt = new Date("2026-10-20T00:00:00Z");
    const live = { enabled: true, archivedAt: null, startsAt, endsAt };
    expect(isOfferLive(live, new Date("2026-10-09T23:59:59Z"))).toBe(false);
    expect(isOfferLive(live, startsAt)).toBe(true);
    expect(isOfferLive(live, endsAt)).toBe(false);
    expect(isOfferLive({ ...live, enabled: false }, startsAt)).toBe(false);
  });

  it("detects overlapping windows, treating open ends as unbounded", () => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day));
    expect(
      windowsOverlap(
        { startsAt: at(1), endsAt: at(10) },
        { startsAt: at(10), endsAt: at(20) },
      ),
    ).toBe(false);
    expect(
      windowsOverlap(
        { startsAt: at(1), endsAt: at(11) },
        { startsAt: at(10), endsAt: null },
      ),
    ).toBe(true);
    expect(
      windowsOverlap(
        { startsAt: null, endsAt: null },
        { startsAt: at(5), endsAt: at(6) },
      ),
    ).toBe(true);
  });
});

describe("selling unit pricing", () => {
  it("applies variant offers to the one-piece unit and never once per piece of a pack", () => {
    const tenPercent = offer({ kind: "percentage", value: 10 });
    expect(
      priceSellingUnit({ priceAgorot: 400, unitsPerSale: 1 }, tenPercent, 2),
    ).toEqual({
      unitPriceAgorot: 360,
      listUnitPriceAgorot: 400,
      offerId: "o1",
    });
    expect(
      priceSellingUnit({ priceAgorot: 1000, unitsPerSale: 3 }, tenPercent, 2),
    ).toEqual({
      unitPriceAgorot: 1000,
      listUnitPriceAgorot: 1000,
      offerId: null,
    });
    // A per-piece fixed price must not become the price of a whole pack.
    const fixed = offer({ kind: "fixed_price", value: 300 });
    expect(
      priceSellingUnit({ priceAgorot: 1000, unitsPerSale: 3 }, fixed, 1)
        .unitPriceAgorot,
    ).toBe(1000);
    expect(offerForSellingUnit({ unitsPerSale: 3 }, fixed)).toBeUndefined();
    expect(offerForSellingUnit({ unitsPerSale: 1 }, fixed)).toBe(fixed);
  });

  it("keeps the minimum-quantity rule for singles", () => {
    const bulk = offer({ minQuantity: 3 });
    expect(
      priceSellingUnit({ priceAgorot: 400, unitsPerSale: 1 }, bulk, 2).offerId,
    ).toBeNull();
    expect(
      priceSellingUnit({ priceAgorot: 400, unitsPerSale: 1 }, bulk, 3).offerId,
    ).toBe("o1");
  });
});
