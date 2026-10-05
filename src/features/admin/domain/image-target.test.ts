import { describe, expect, it } from "vitest";

import { imageTargetValue, parseImageTarget } from "./image-target";

describe("image targets", () => {
  it("round-trips every scope", () => {
    const value = "6f1c2c1e-6b4f-4b1a-9a52-0d3a5b8f2c11";
    expect(parseImageTarget("product")).toEqual({ scope: "product" });
    expect(parseImageTarget("unassigned")).toEqual({ scope: "unassigned" });
    expect(parseImageTarget(`value:${value}`)).toEqual({
      scope: "option_value",
      valueId: value,
    });
    expect(parseImageTarget("variant:loyal--blue-small")).toEqual({
      scope: "variant",
      variantDomainId: "loyal--blue-small",
    });
    expect(
      imageTargetValue({
        scope: "option_value",
        variantId: null,
        optionValueId: value,
      }),
    ).toBe(`value:${value}`);
    expect(
      imageTargetValue({
        scope: "variant",
        variantId: "v-1",
        optionValueId: null,
      }),
    ).toBe("variant:v-1");
  });

  it("rejects anything else", () => {
    for (const text of [
      "",
      null,
      "value:not-a-uuid",
      "variant:Bad Id",
      "shared",
      "value",
    ]) {
      expect(parseImageTarget(text)).toBeNull();
    }
  });
});
