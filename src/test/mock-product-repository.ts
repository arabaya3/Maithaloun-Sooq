import {
  productIdSchema,
  productSchema,
  productSlugSchema,
  type Product,
} from "@/features/catalog/domain/product";
import type { ProductRepository } from "@/features/catalog/domain/product-repository";
import {
  emptyPresentation,
  type ProductPresentation,
} from "@/features/catalog/domain/product-presentation";

// Stable UUIDs for fixture selling units, derived from a readable key.
export function fixtureUuid(key: string): string {
  let hash = BigInt("0xcbf29ce484222325");
  for (const char of key) {
    hash ^= BigInt(char.codePointAt(0)!);
    hash = (hash * BigInt("0x100000001b3")) & BigInt("0xffffffffffffffff");
  }
  const hex = hash.toString(16).padStart(16, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8000-${hex.slice(0, 12)}`;
}

export function singleSellingUnit(
  variantId: string,
  priceAgorot: number,
  maxQuantity = 9,
) {
  return {
    id: fixtureUuid(`${variantId}:single`),
    labelAr: "حبة واحدة",
    unitsPerSale: 1,
    priceAgorot,
    isDefault: true,
    maxQuantity,
  };
}

export function withDefaultVariant(
  product: Omit<
    Product,
    "defaultVariantId" | "variants" | "specifications" | "publication"
  > & {
    specifications?: Product["specifications"];
    publication?: Product["publication"];
  },
): Product {
  const defaultVariantId = `${product.id}--default`;
  return productSchema.parse({
    publication: "published",
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
        sellingUnits: [
          singleSellingUnit(defaultVariantId, product.priceAgorot),
        ],
      },
    ],
    specifications: product.specifications ?? [],
  });
}

// Cleaning cloths sold singly (4 ₪) or as a 3-pack (10 ₪); the green colour sells singles and a 6-carton.
export function multipackClothFixture(
  options: { blueFreePieces?: number; greenFreePieces?: number } = {},
): Product {
  const cap = (pieces: number | undefined, units: number) =>
    pieces === undefined ? 9 : Math.min(9, Math.floor(pieces / units));
  const unit = (
    variantId: string,
    key: string,
    labelAr: string,
    unitsPerSale: number,
    priceAgorot: number,
    isDefault: boolean,
    pieces: number | undefined,
  ) => ({
    id: fixtureUuid(`${variantId}:${key}`),
    labelAr,
    unitsPerSale,
    priceAgorot,
    isDefault,
    maxQuantity: cap(pieces, unitsPerSale),
  });
  return productSchema.parse({
    id: "test-cloth",
    slug: "test-cloth",
    nameAr: "ممسحة تنظيف",
    priceAgorot: 400,
    categoryId: "tools",
    image: { kind: "placeholder", variant: "brush" },
    availability: "available",
    publication: "published",
    detailsStatus: "placeholder",
    defaultVariantId: "test-cloth--blue",
    variants: [
      {
        id: "test-cloth--blue",
        productId: "test-cloth",
        labelAr: "أزرق",
        attributes: { اللون: "أزرق" },
        priceAgorot: 400,
        availability: "available",
        image: { kind: "placeholder", variant: "brush" },
        sortOrder: 0,
        isDefault: true,
        sellingUnits: [
          unit(
            "test-cloth--blue",
            "single",
            "حبة واحدة",
            1,
            400,
            true,
            options.blueFreePieces,
          ),
          unit(
            "test-cloth--blue",
            "pack3",
            "باكيج 3 حبات",
            3,
            1000,
            false,
            options.blueFreePieces,
          ),
        ],
      },
      {
        id: "test-cloth--green",
        productId: "test-cloth",
        labelAr: "أخضر",
        attributes: { اللون: "أخضر" },
        priceAgorot: 450,
        availability: "available",
        image: { kind: "placeholder", variant: "brush" },
        sortOrder: 1,
        isDefault: false,
        sellingUnits: [
          unit(
            "test-cloth--green",
            "single",
            "حبة واحدة",
            1,
            450,
            true,
            options.greenFreePieces,
          ),
          unit(
            "test-cloth--green",
            "carton6",
            "كرتونة 6 حبات",
            6,
            2400,
            false,
            options.greenFreePieces,
          ),
        ],
      },
    ],
    specifications: [],
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
    publication: "published",
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
        sellingUnits: [singleSellingUnit("test-multi-weight--1kg", 1500)],
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
        sellingUnits: [singleSellingUnit("test-multi-weight--5kg", 4500)],
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
  async presentation(): Promise<ProductPresentation> {
    return emptyPresentation;
  }

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
