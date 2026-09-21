import { productSchema, type Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

const catalog = [
  {
    id: "general-cleaner",
    name: "منظف عام Secret",
    priceIls: 7,
    categoryId: "home",
    image: { kind: "placeholder", variant: "general-cleaner" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "dolphin-bleach",
    name: "مبيض Dolphin",
    priceIls: 8,
    categoryId: "laundry",
    image: { kind: "placeholder", variant: "bleach" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "carpet-brush",
    name: "فرشاة سجاد",
    priceIls: 5,
    categoryId: "tools",
    image: { kind: "placeholder", variant: "brush" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "arar-dish-liquid",
    name: "سائل جلي Arar",
    priceIls: 12,
    categoryId: "kitchen",
    image: { kind: "placeholder", variant: "dish-liquid" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "smart-floor-cleaner",
    name: "منظف أرضيات Smart",
    priceIls: 10,
    categoryId: "home",
    image: { kind: "placeholder", variant: "floor-cleaner" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "musk-floor-cleaner",
    name: "منظف أرضيات Musk",
    priceIls: 10,
    categoryId: "home",
    image: { kind: "placeholder", variant: "floor-cleaner" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "lilac-floor-cleaner",
    name: "منظف أرضيات Lilac",
    priceIls: 10,
    categoryId: "home",
    image: { kind: "placeholder", variant: "floor-cleaner" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "degreaser-8",
    name: "مزيل دهون",
    priceIls: 8,
    categoryId: "kitchen",
    image: { kind: "placeholder", variant: "degreaser" },
    detailsStatus: "unknown",
    purchasable: true,
  },
  {
    id: "degreaser-10",
    name: "مزيل دهون",
    priceIls: 10,
    categoryId: "kitchen",
    image: { kind: "placeholder", variant: "degreaser" },
    detailsStatus: "unknown",
    purchasable: true,
  },
] satisfies Product[];

export class MockProductRepository implements ProductRepository {
  async list(): Promise<readonly Product[]> {
    return productSchema.array().parse(catalog);
  }
}

export const productRepository: ProductRepository = new MockProductRepository();
