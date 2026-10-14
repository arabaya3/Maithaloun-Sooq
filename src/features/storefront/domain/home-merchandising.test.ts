import { describe, expect, it } from "vitest";

import type { Product } from "@/features/catalog/domain/product";
import { withDefaultVariant } from "@/test/mock-product-repository";

import {
  bestSellers,
  brandPath,
  catalogBrands,
  pickHeroProducts,
} from "./home-merchandising";

function product(
  id: string,
  categoryId: string,
  extra: Partial<Product> = {},
  photo = true,
): Product {
  return withDefaultVariant({
    id,
    slug: id,
    nameAr: id,
    priceAgorot: 1000,
    categoryId,
    image: photo
      ? {
          kind: "image",
          src: `/p/${id}.webp`,
          alt: id,
          width: 800,
          height: 800,
        }
      : { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "verified",
    ...extra,
  });
}

describe("home merchandising", () => {
  it("picks one real photo per category for the hero, branded products first", () => {
    const picked = pickHeroProducts([
      product("a", "laundry"),
      product("b", "laundry", { brand: "Ariel" }),
      product("c", "kitchen", {}, false),
      product("d", "kitchen"),
      product("e", "personal-care", { availability: "unavailable" }),
      product("f", "bathroom"),
    ]);
    expect(picked.map((item) => item.id)).toEqual(["b", "d", "f"]);
  });

  it("lists only brands the owner entered, most stocked first", () => {
    const brands = catalogBrands([
      product("a", "home", { brand: "Finish" }),
      product("b", "home", { brand: " Finish " }),
      product("c", "home", { brand: "Arar" }),
      product("d", "home"),
    ]);
    expect(brands).toEqual([
      { name: "Finish", productCount: 2 },
      { name: "Arar", productCount: 1 },
    ]);
    expect(brandPath("Head & Shoulders")).toBe(
      "/brands/Head%20%26%20Shoulders",
    );
  });

  it("keeps the order ranking and drops products no longer on sale", () => {
    const products = [
      product("a", "home"),
      product("b", "home", { availability: "unavailable" }),
      product("c", "home"),
    ];
    expect(
      bestSellers(products, ["c", "gone", "b", "a"]).map((item) => item.id),
    ).toEqual(["c", "a"]);
  });
});
