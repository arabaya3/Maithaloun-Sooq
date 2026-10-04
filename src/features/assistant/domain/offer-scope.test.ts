import { describe, expect, it } from "vitest";

import { describeOfferScope, specificVariantNamed } from "./offer-scope";

const scents = [
  { id: "musk--lavender", labelAr: "لافندر" },
  { id: "musk--rose", labelAr: "ورد" },
  { id: "musk--lemon", labelAr: "ليمون" },
  { id: "musk--ocean", labelAr: "نسيم البحر" },
];

describe("offer scope", () => {
  it("targets the one variant the owner named, not the whole product", () => {
    expect(specificVariantNamed("مسك لافندر", scents)).toBe("musk--lavender");
    expect(specificVariantNamed("مسك نسيم البحر", scents)).toBe("musk--ocean");
  });

  it("keeps product scope when no single variant is named", () => {
    expect(specificVariantNamed("مسك", scents)).toBeNull();
    expect(specificVariantNamed("مسك لافندر ورد", scents)).toBeNull();
    expect(specificVariantNamed("مسك لافندر", [scents[0]!])).toBeNull();
  });

  it("states the real reach of a product-wide offer", () => {
    const scope = describeOfferScope(
      { productIds: ["musk"], variantIds: [], categoryCodes: [] },
      4,
      ["«مسك» بكل أصنافه"],
    );
    expect(scope).toContain("بكل أصنافه");
    expect(scope).toContain("المجموع 4 أصناف");
  });

  it("states a single-variant offer as that variant only", () => {
    expect(
      describeOfferScope(
        { productIds: [], variantIds: ["musk--lavender"], categoryCodes: [] },
        1,
        ["«مسك — لافندر» فقط"],
      ),
    ).toBe("1 صنف محدد فقط: «مسك — لافندر» فقط — المجموع 1 صنف");
  });
});
