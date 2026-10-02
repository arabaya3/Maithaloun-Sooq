import { describe, expect, it } from "vitest";

import { categoryCodeFrom, categoryCodeSchema } from "./category";

describe("category codes", () => {
  it("builds a unique ASCII code and never uses the reserved all", () => {
    expect(categoryCodeFrom("Air fresheners", new Set())).toBe(
      "air-fresheners",
    );
    expect(
      categoryCodeFrom("Air fresheners", new Set(["air-fresheners"])),
    ).toBe("air-fresheners-2");
    expect(categoryCodeFrom("معطرات", new Set())).toBe("category");
    expect(categoryCodeSchema.safeParse("all").success).toBe(false);
    expect(categoryCodeSchema.safeParse("Kitchen").success).toBe(false);
  });
});
