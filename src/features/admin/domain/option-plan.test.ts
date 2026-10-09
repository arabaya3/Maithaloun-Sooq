import { describe, expect, it } from "vitest";

import {
  allCombinations,
  optionsForShape,
  planProblem,
  withValue,
  type PlannedOption,
} from "./option-plan";
import { newProductId } from "./product-identity";

const option = (nameAr: string, values: string[]): PlannedOption => ({
  key: nameAr,
  nameAr,
  kind: "other",
  values,
});

describe("option plan", () => {
  it("starts each shape with the matching presets", () => {
    expect(optionsForShape("single")).toEqual([]);
    expect(optionsForShape("fragrance").map((item) => item.nameAr)).toEqual([
      "الرائحة",
    ]);
    expect(optionsForShape("several").map((item) => item.kind)).toEqual([
      "fragrance",
      "size",
    ]);
  });

  it("lists every combination in option order, and none until each option has a value", () => {
    expect(
      allCombinations([
        option("الرائحة", ["لافندر", "ورد"]),
        option("الحجم", ["1 لتر"]),
      ]),
    ).toEqual([
      ["لافندر", "1 لتر"],
      ["ورد", "1 لتر"],
    ]);
    expect(
      allCombinations([option("الرائحة", ["لافندر"]), option("الحجم", [])]),
    ).toEqual([]);
  });

  it("ignores repeated values even when spelled with a different alef", () => {
    const fragrance = withValue(
      withValue(option("الرائحة", []), "الورد"),
      "  ",
    );
    expect(withValue(fragrance, "ألورد").values).toEqual(["الورد"]);
  });

  it("names the first thing to fix", () => {
    expect(planProblem([], [])).toMatch(/أضيفي خياراً واحداً/);
    expect(
      planProblem([option("الرائحة", []), option("الحجم", ["1 لتر"])], []),
    ).toBe("أضيفي قيمة واحدة على الأقل لـ «الرائحة».");
    expect(
      planProblem(
        [option("الحجم", ["1"]), option("الحجم", ["2"])],
        [["1", "2"]],
      ),
    ).toBe("نوع الخيار «الحجم» مكرر.");
    expect(planProblem([option("الحجم", ["1"])], [])).toBe(
      "اختاري صنفاً واحداً على الأقل من القائمة.",
    );
    expect(planProblem([option("الحجم", ["1"])], [["1"]])).toBeNull();
  });
});

describe("new product id", () => {
  it("uses the Latin name when there is one and always ends in a short unique suffix", () => {
    expect(newProductId("Secret Air Freshener", "A1B2C3D4-xyz")).toBe(
      "secret-air-freshener-a1b2c3d4",
    );
    expect(newProductId("", "9f8e7d6c")).toBe("product-9f8e7d6c");
    expect(newProductId("منظف", "9f8e7d6c")).toBe("product-9f8e7d6c");
    expect(newProductId("---", "")).toBe("product-new");
  });
});
