import { describe, expect, it } from "vitest";

import { MockProductRepository } from "./mock-product-repository";

describe("MockProductRepository", () => {
  it("looks up validated products by stable slug", async () => {
    const repository = new MockProductRepository();

    await expect(
      repository.getBySlug("general-cleaner-secret"),
    ).resolves.toMatchObject({
      id: "general-cleaner",
      nameAr: "منظف عام",
      latinName: "Secret",
      priceAgorot: 700,
    });
    await expect(repository.getBySlug("missing-product")).resolves.toBeNull();
    await expect(repository.getBySlug("../unsafe")).resolves.toBeNull();
  });

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
