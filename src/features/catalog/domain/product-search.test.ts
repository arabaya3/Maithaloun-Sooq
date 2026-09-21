import { describe, expect, it } from "vitest";

import { filterProducts, normalizeSearchText } from "./product-search";
import { MockProductRepository } from "../infrastructure/mock-product-repository";

describe("product search", () => {
  it("normalizes whitespace, Arabic variants, and Latin case", () => {
    expect(normalizeSearchText("  مُنظّف   عام  ")).toBe("منظف عام");
    expect(normalizeSearchText("SECRET")).toBe("secret");
    expect(normalizeSearchText("أرضيات")).toBe("ارضيات");
  });

  it("finds Arabic and Latin terms and combines category filtering", async () => {
    const products = await new MockProductRepository().list();

    expect(
      filterProducts(products, { query: "secret", categoryId: "all" }),
    ).toHaveLength(1);
    expect(
      filterProducts(products, { query: "مزيل دهون", categoryId: "all" }),
    ).toHaveLength(2);
    expect(
      filterProducts(products, { query: "ArAr", categoryId: "kitchen" }),
    ).toHaveLength(1);
    expect(
      filterProducts(products, { query: "ArAr", categoryId: "laundry" }),
    ).toHaveLength(0);
  });
});
