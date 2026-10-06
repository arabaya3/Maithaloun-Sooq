import { describe, expect, it } from "vitest";

import {
  availableSaleQuantity,
  baseUnitsFor,
  defaultSellingUnit,
  deductionText,
  labelStatesCount,
  matchSellingUnit,
  maxOrderQuantity,
  parseUnitsPerSale,
  perPieceAgorot,
  piecesText,
  presetLabel,
  sellingLineText,
  sellingUnitAfterVariantChange,
  stockInterpretation,
  unitComparison,
  type SellingUnit,
} from "./selling-unit";

const unit = (
  id: string,
  unitsPerSale: number,
  priceAgorot: number,
  extra: Partial<SellingUnit> = {},
): SellingUnit => ({
  id,
  labelAr: unitsPerSale === 1 ? "حبة واحدة" : `باكيج ${unitsPerSale} حبات`,
  unitsPerSale,
  priceAgorot,
  isDefault: unitsPerSale === 1,
  maxQuantity: 9,
  ...extra,
});

describe("selling unit availability", () => {
  it("fills whole selling units from free base stock", () => {
    expect(availableSaleQuantity(10_000, 3)).toBe(3);
    expect(availableSaleQuantity(10_000, 1)).toBe(10);
    expect(availableSaleQuantity(2_000, 3)).toBe(0);
    expect(availableSaleQuantity(2_000, 1)).toBe(2);
    expect(availableSaleQuantity(0, 1)).toBe(0);
    expect(availableSaleQuantity(-1_000, 1)).toBe(0);
    // Fractional base stock (weighed goods) never rounds up into a unit.
    expect(availableSaleQuantity(2_999, 1)).toBe(2);
    expect(availableSaleQuantity(null, 3)).toBeNull();
  });

  it("caps the orderable quantity at the cart limit", () => {
    expect(maxOrderQuantity(10_000, 1, 9)).toBe(9);
    expect(maxOrderQuantity(10_000, 3, 9)).toBe(3);
    expect(maxOrderQuantity(2_000, 3, 9)).toBe(0);
    expect(maxOrderQuantity(null, 3, 9)).toBe(9);
  });

  it("converts selling units to base units and rejects invalid multipliers", () => {
    expect(baseUnitsFor(2, 3)).toBe(6);
    expect(baseUnitsFor(1, 1)).toBe(1);
    for (const bad of [0, -3, 1.5, 1_001, Number.NaN]) {
      expect(() => baseUnitsFor(1, bad)).toThrow(RangeError);
      expect(() => availableSaleQuantity(1_000, bad)).toThrow(RangeError);
    }
    expect(() => baseUnitsFor(0, 3)).toThrow(RangeError);
  });
});

describe("selling unit display", () => {
  it("states the per-piece price and calls a pack cheaper only when it is", () => {
    const single = unit("a", 1, 400);
    expect(perPieceAgorot(1000, 3)).toBe(333);
    expect(unitComparison(unit("b", 3, 1000), single)).toEqual({
      perPiece: "3.33 ₪ للحبة",
      cheaper: true,
    });
    expect(unitComparison(unit("c", 3, 1200), single)).toEqual({
      perPiece: "4 ₪ للحبة",
      cheaper: false,
    });
    expect(unitComparison(unit("d", 3, 1300), single)?.cheaper).toBe(false);
    expect(unitComparison(unit("e", 3, 1000), null)?.cheaper).toBe(false);
    expect(unitComparison(single, single)).toBeNull();
  });

  it("names packs and pieces without mixing them up", () => {
    expect(sellingLineText("باكيج 3 حبات", 2)).toBe("باكيج 3 حبات × 2");
    expect(piecesText(1)).toBe("حبة واحدة");
    expect(piecesText(2)).toBe("حبتان");
    expect(piecesText(6)).toBe("6 حبات");
    expect(piecesText(12)).toBe("12 حبة");
    expect(deductionText("باكيج 3 حبات", 3)).toBe(
      "بيع «باكيج 3 حبات» مرة واحدة يخصم 3 حبات من المخزون.",
    );
    expect(stockInterpretation(10_000, "باكيج 3 حبات", 3)).toBe(
      "المتاح حالياً: 10 حبات = 3 × «باكيج 3 حبات»، وتبقى حبة واحدة.",
    );
    expect(stockInterpretation(2_000, "باكيج 3 حبات", 3)).toBe(
      "المتاح حالياً: حبتان، وهذا أقل من «باكيج 3 حبات» واحد.",
    );
    expect(stockInterpretation(null, "باكيج 3 حبات", 3)).toBe(
      "هذا الصنف غير متتبَّع بالمخزون.",
    );
  });

  it("builds preset labels the owner can still edit", () => {
    expect(presetLabel("باكيج", 3)).toBe("باكيج 3 حبات");
    expect(presetLabel("كرتونة", 12)).toBe("كرتونة 12 حبة");
    expect(presetLabel("باكيج", null)).toBe("باكيج");
    expect(presetLabel("باكيج 4", 4)).toBe("باكيج 4");
  });

  it("parses typed counts strictly", () => {
    expect(parseUnitsPerSale("3")).toBe(3);
    expect(parseUnitsPerSale(" ٣ ")).toBe(3);
    expect(parseUnitsPerSale("0")).toBeNull();
    expect(parseUnitsPerSale("2.5")).toBeNull();
    expect(parseUnitsPerSale("-1")).toBeNull();
    expect(parseUnitsPerSale("1001")).toBeNull();
    expect(parseUnitsPerSale("ثلاث")).toBeNull();
  });
});

describe("selling unit choice", () => {
  const blue = [unit("b1", 1, 400), unit("b3", 3, 1000)];
  const green = [unit("g1", 1, 450), unit("g6", 6, 2400)];

  it("keeps an equivalent unit after a variant change, otherwise the default", () => {
    expect(sellingUnitAfterVariantChange(blue[1]!, blue)?.id).toBe("b3");
    expect(sellingUnitAfterVariantChange(blue[0]!, green)?.id).toBe("g1");
    // Green has no 3-pack: fall back to its default rather than guessing.
    expect(sellingUnitAfterVariantChange(blue[1]!, green)?.id).toBe("g1");
    expect(sellingUnitAfterVariantChange(null, green)?.id).toBe("g1");
  });

  it("skips units that cannot be bought now", () => {
    const lowStock = [
      unit("b1", 1, 400, { maxQuantity: 2 }),
      unit("b3", 3, 1000, { maxQuantity: 0 }),
    ];
    expect(sellingUnitAfterVariantChange(blue[1]!, lowStock)?.id).toBe("b1");
    expect(
      defaultSellingUnit([
        unit("b1", 1, 400, { isDefault: true, maxQuantity: 0 }),
        unit("b3", 3, 1000, { isDefault: false, maxQuantity: 2 }),
      ])?.id,
    ).toBe("b3");
    expect(defaultSellingUnit([])).toBeNull();
  });

  it("matches what the owner said to exactly one unit or none", () => {
    const units = [
      { labelAr: "حبة واحدة", unitsPerSale: 1 },
      { labelAr: "باكيج 3 حبات", unitsPerSale: 3 },
      { labelAr: "كرتونة 12 حبة", unitsPerSale: 12 },
    ];
    expect(matchSellingUnit(units, "باكيج 3 حبات")?.unitsPerSale).toBe(3);
    expect(matchSellingUnit(units, "باكيج")?.unitsPerSale).toBe(3);
    expect(matchSellingUnit(units, "12")?.unitsPerSale).toBe(12);
    expect(matchSellingUnit(units, "الكرتونة")?.unitsPerSale).toBe(12);
    // «حبة» appears in two labels, so the owner is asked instead.
    expect(matchSellingUnit(units, "حبة")).toBeNull();
    expect(matchSellingUnit(units, "كرتونه")?.unitsPerSale).toBe(12);
    expect(matchSellingUnit(units, "دزينة")).toBeNull();
    expect(matchSellingUnit(units, "")).toBeNull();
  });

  it("reads spoken pack sizes and duals, and refuses when two packs fit", () => {
    const units = [
      { labelAr: "حبة واحدة", unitsPerSale: 1 },
      { labelAr: "باكيج 3 حبات", unitsPerSale: 3 },
      { labelAr: "كرتونة 12 حبة", unitsPerSale: 12 },
    ];
    expect(matchSellingUnit(units, "عرض الثلاث حبات")?.unitsPerSale).toBe(3);
    expect(matchSellingUnit(units, "باكيجين")?.unitsPerSale).toBe(3);
    expect(matchSellingUnit(units, "كل باكيج 3 حبات")?.unitsPerSale).toBe(3);
    expect(matchSellingUnit(units, "باكيج 5 حبات")).toBeNull();
    const twoPacks = [...units, { labelAr: "باكيج 6 حبات", unitsPerSale: 6 }];
    expect(matchSellingUnit(twoPacks, "باكيج")).toBeNull();
    expect(matchSellingUnit(twoPacks, "باكيجين")).toBeNull();
    expect(matchSellingUnit(twoPacks, "عرض الست حبات")?.unitsPerSale).toBe(6);
  });
});

describe("pack labels state their size", () => {
  it("accepts digits and Arabic count words and rejects a bare pack name", () => {
    expect(labelStatesCount("باكيج 3 حبات", 3)).toBe(true);
    expect(labelStatesCount("باكيج ثلاث حبات", 3)).toBe(true);
    expect(labelStatesCount("كرتونة ستة", 6)).toBe(true);
    expect(labelStatesCount("باكيج حبتين", 2)).toBe(true);
    expect(labelStatesCount("دزينة", 12)).toBe(true);
    expect(labelStatesCount("باكيج", 3)).toBe(false);
    expect(labelStatesCount("باكيج 4 حبات", 3)).toBe(false);
    expect(labelStatesCount("كرتونة", 6)).toBe(false);
    expect(labelStatesCount("حبة واحدة", 1)).toBe(true);
    expect(labelStatesCount("علبة", 1)).toBe(true);
    // A pack word on a one-piece unit is a pack whose size was never said.
    expect(labelStatesCount("باكيج", 1)).toBe(false);
    expect(labelStatesCount("الكرتونة", 1)).toBe(false);
  });
});
