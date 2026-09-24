import {
  productIdSchema,
  productSchema,
  productSlugSchema,
  type Product,
} from "@/features/catalog/domain/product";
import type { ProductRepository } from "@/features/catalog/domain/product-repository";

export function withDefaultVariant(
  product: Omit<Product, "defaultVariantId" | "variants" | "specifications"> & {
    specifications?: Product["specifications"];
  },
): Product {
  const defaultVariantId = `${product.id}--default`;
  return productSchema.parse({
    ...product,
    defaultVariantId,
    variants: [
      {
        id: defaultVariantId,
        productId: product.id,
        labelAr: product.unit ?? "الافتراضي",
        attributes: product.unit ? { الوحدة: product.unit } : {},
        priceAgorot: product.priceAgorot,
        availability: product.availability,
        image: product.image,
        sortOrder: 0,
        isDefault: true,
      },
    ],
    specifications: product.specifications ?? [],
  });
}

const catalog = productSchema.array().parse([
  withDefaultVariant({
    id: "general-cleaner",
    slug: "general-cleaner-secret",
    nameAr: "منظف عام",
    latinName: "Secret",
    priceAgorot: 700,
    categoryId: "home",
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "dolphin-bleach",
    slug: "dolphin-bleach",
    nameAr: "مبيض",
    latinName: "Dolphin",
    priceAgorot: 800,
    categoryId: "laundry",
    image: { kind: "placeholder", variant: "bleach" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "carpet-brush",
    slug: "carpet-brush",
    nameAr: "فرشاة سجاد",
    priceAgorot: 500,
    categoryId: "tools",
    image: { kind: "placeholder", variant: "brush" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "arar-dish-liquid",
    slug: "arar-dish-liquid",
    nameAr: "سائل جلي",
    latinName: "Arar",
    priceAgorot: 1200,
    categoryId: "kitchen",
    image: { kind: "placeholder", variant: "dish-liquid" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "smart-floor-cleaner",
    slug: "smart-floor-cleaner",
    nameAr: "منظف أرضيات",
    latinName: "Smart",
    priceAgorot: 1000,
    categoryId: "home",
    image: { kind: "placeholder", variant: "floor-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "musk-floor-cleaner",
    slug: "musk-floor-cleaner",
    nameAr: "منظف أرضيات",
    latinName: "Musk",
    priceAgorot: 1000,
    categoryId: "home",
    image: { kind: "placeholder", variant: "floor-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "lilac-floor-cleaner",
    slug: "lilac-floor-cleaner",
    nameAr: "منظف أرضيات",
    latinName: "Lilac",
    priceAgorot: 1000,
    categoryId: "home",
    image: { kind: "placeholder", variant: "floor-cleaner" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "degreaser-8",
    slug: "degreaser-8",
    nameAr: "مزيل دهون",
    priceAgorot: 800,
    categoryId: "kitchen",
    image: { kind: "placeholder", variant: "degreaser" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  withDefaultVariant({
    id: "degreaser-10",
    slug: "degreaser-10",
    nameAr: "مزيل دهون",
    priceAgorot: 1000,
    categoryId: "kitchen",
    image: { kind: "placeholder", variant: "degreaser" },
    availability: "available",
    detailsStatus: "placeholder",
  }),
  // Deterministic multi-variant fixture for unit/UI tests only.
  {
    id: "test-multi-weight",
    slug: "test-multi-weight",
    nameAr: "منظف اختبار بأوزان",
    latinName: "Test Multi Weight",
    priceAgorot: 1500,
    categoryId: "home",
    image: { kind: "placeholder", variant: "general-cleaner" },
    availability: "available",
    detailsStatus: "verified",
    description: "منتج اختباري متعدد الأوزان فقط.",
    defaultVariantId: "test-multi-weight--1kg",
    variants: [
      {
        id: "test-multi-weight--1kg",
        productId: "test-multi-weight",
        labelAr: "1 كغ",
        attributes: { الوزن: "1 كغ" },
        priceAgorot: 1500,
        availability: "available",
        image: { kind: "placeholder", variant: "general-cleaner" },
        sortOrder: 0,
        isDefault: true,
      },
      {
        id: "test-multi-weight--5kg",
        productId: "test-multi-weight",
        labelAr: "5 كغ",
        attributes: { الوزن: "5 كغ" },
        priceAgorot: 4500,
        availability: "available",
        image: { kind: "placeholder", variant: "floor-cleaner" },
        sortOrder: 1,
        isDefault: false,
      },
    ],
    specifications: [
      {
        id: "11111111-1111-4111-8111-111111111101",
        labelAr: "الاستخدام",
        valueAr: "للاختبار فقط",
        sortOrder: 0,
      },
    ],
  },
]);

const productsById = new Map(catalog.map((product) => [product.id, product]));

export class MockProductRepository implements ProductRepository {
  async list(): Promise<readonly Product[]> {
    return catalog;
  }

  async getById(id: string): Promise<Product | null> {
    if (!productIdSchema.safeParse(id).success) return null;
    return productsById.get(id) ?? null;
  }

  async getBySlug(slug: string): Promise<Product | null> {
    if (!productSlugSchema.safeParse(slug).success) return null;
    return catalog.find((product) => product.slug === slug) ?? null;
  }

  async getByIds(ids: readonly string[]): Promise<readonly Product[]> {
    return ids.flatMap((id) => {
      if (!productIdSchema.safeParse(id).success) return [];
      const product = productsById.get(id);
      return product ? [product] : [];
    });
  }
}

export const productRepository: ProductRepository = new MockProductRepository();
