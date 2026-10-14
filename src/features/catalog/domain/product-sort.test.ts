import { describe, expect, it } from "vitest";

import { parseProductSort, sortProducts } from "./product-sort";
import { withDefaultVariant } from "@/test/mock-product-repository";

const product = (id: string, priceAgorot: number) =>
  withDefaultVariant({
    id,
    slug: id,
    nameAr: id,
    priceAgorot,
    categoryId: "home",
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  });

describe("product sorting", () => {
  const list = [product("a", 900), product("b", 300), product("c", 900)];

  it("keeps the owner's order by default and sorts by the shown price otherwise", () => {
    expect(sortProducts(list, "featured").map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortProducts(list, "price-asc").map((p) => p.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortProducts(list, "price-desc").map((p) => p.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("treats unknown values as the default", () => {
    expect(parseProductSort("price-asc")).toBe("price-asc");
    expect(parseProductSort("cheapest")).toBe("featured");
    expect(parseProductSort(undefined)).toBe("featured");
  });
});
