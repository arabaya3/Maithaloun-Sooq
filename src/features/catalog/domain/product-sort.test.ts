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
    expect(parseProductSort("featured")).toBe("featured");
    expect(parseProductSort("cheapest")).toBe("newest");
    expect(parseProductSort(undefined)).toBe("newest");
  });

  it("puts the newest first by original creation time, ties by id, undated last", () => {
    const dated = (id: string, createdAt?: string) => ({
      ...product(id, 500),
      ...(createdAt ? { createdAt } : {}),
    });
    const list = [
      dated("old", "2026-10-01T10:00:00.000Z"),
      dated("undated"),
      dated("b-same", "2026-11-20T08:00:00.000Z"),
      dated("a-same", "2026-11-20T08:00:00.000Z"),
      dated("new", "2026-11-22T08:00:00.000Z"),
    ];
    expect(sortProducts(list, "newest").map((p) => p.id)).toEqual([
      "new",
      "a-same",
      "b-same",
      "old",
      "undated",
    ]);
  });

  it("does not reorder a product when its price or stock is edited", () => {
    // Only createdAt decides; an edit changes price (and updated_at, which products never expose).
    const first = {
      ...product("x", 500),
      createdAt: "2026-11-01T00:00:00.000Z",
    };
    const second = {
      ...product("y", 500),
      createdAt: "2026-11-02T00:00:00.000Z",
    };
    const before = sortProducts([first, second], "newest").map((p) => p.id);
    const edited = { ...first, priceAgorot: 100 };
    const after = sortProducts([edited, second], "newest").map((p) => p.id);
    expect(after).toEqual(before);
    expect(after).toEqual(["y", "x"]);
  });
});
