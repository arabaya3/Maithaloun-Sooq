import { describe, expect, it } from "vitest";

import { MockProductRepository } from "./mock-product-repository";

describe("MockProductRepository", () => {
  it("provides distinct local placeholder variants for the catalog", async () => {
    const products = await new MockProductRepository().list();
    const variants = products.flatMap((product) =>
      product.image.kind === "placeholder" ? [product.image.variant] : [],
    );

    expect(new Set(variants)).toEqual(
      new Set([
        "general-cleaner",
        "bleach",
        "brush",
        "dish-liquid",
        "floor-cleaner",
        "degreaser",
      ]),
    );
  });
});
