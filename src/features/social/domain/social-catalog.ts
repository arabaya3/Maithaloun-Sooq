import { z } from "zod";

import { formatIls } from "@/shared/lib/format-currency";

/**
 * The social engine reads the same public catalog the storefront API serves: published products only,
 * without costs, SKUs or stock. Everything a post says about a product comes from here.
 */
const publicImageSchema = z
  .object({
    src: z.string().min(1),
    alt: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .nullable();

const publicProductSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  brand: z.string().nullable(),
  categoryCode: z.string().min(1),
  available: z.boolean(),
  priceAgorot: z.number().int().nonnegative(),
  image: publicImageSchema,
  description: z.string().nullable(),
  usageNotes: z.string().nullable().optional(),
  variants: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      available: z.boolean(),
      image: publicImageSchema,
      sellingUnits: z.array(
        z.object({
          priceAgorot: z.number().int().positive(),
          isDefault: z.boolean(),
        }),
      ),
    }),
  ),
});

export const publicCatalogSchema = z.object({
  ok: z.literal(true),
  store: z.object({
    name: z.string(),
    whatsAppE164: z.string().nullable(),
    delivery: z.object({
      area: z.string(),
      feeAgorot: z.number().int().nonnegative(),
      freeFromAgorot: z.number().int().nonnegative(),
      payment: z.string(),
    }),
  }),
  categories: z.array(z.object({ code: z.string(), name: z.string() })),
  products: z.array(publicProductSchema),
});

export type PublicCatalog = z.infer<typeof publicCatalogSchema>;
type PublicProduct = PublicCatalog["products"][number];

export interface SocialVariant {
  id: string;
  label: string;
  priceAgorot: number;
  imageUrl: string | null;
}

export interface SocialProduct {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  categoryCode: string;
  categoryName: string;
  /** The lowest price among available variants, from each variant's default selling unit. */
  priceAgorot: number;
  /** True when available variants differ in price, so a post must say «ابتداءً من». */
  priceVaries: boolean;
  imageUrl: string;
  description: string | null;
  usageNotes: string | null;
  variants: SocialVariant[];
}

export interface StoreFacts {
  name: string;
  whatsAppE164: string | null;
  deliveryAreaAr: string;
  deliveryFeeAgorot: number;
  freeDeliveryFromAgorot: number;
  cashOnDelivery: boolean;
}

export interface SocialCatalog {
  store: StoreFacts;
  products: SocialProduct[];
  /** Every published product id, available or not, so a post can be checked against the live catalog. */
  knownProductIds: ReadonlySet<string>;
}

function variantPrice(
  variant: PublicProduct["variants"][number],
): number | null {
  const unit =
    variant.sellingUnits.find((candidate) => candidate.isDefault) ??
    variant.sellingUnits[0];
  return unit?.priceAgorot ?? null;
}

/**
 * A product can be advertised only when it is available, has a real photo (never a placeholder)
 * and every price we would print is known.
 */
export function toSocialProduct(
  product: PublicProduct,
  categoryName: string,
): SocialProduct | null {
  // Only a public https photo can be rendered and fetched by Meta; placeholders and local files are skipped.
  if (!product.available || !product.image?.src.startsWith("https://")) {
    return null;
  }
  const variants: SocialVariant[] = [];
  for (const variant of product.variants) {
    if (!variant.available) continue;
    const price = variantPrice(variant);
    if (price === null) continue;
    variants.push({
      id: variant.id,
      label: variant.label,
      priceAgorot: price,
      imageUrl: variant.image?.src ?? null,
    });
  }
  if (!variants.length) return null;
  const prices = variants.map((variant) => variant.priceAgorot);
  const lowest = Math.min(...prices);
  return {
    id: product.id,
    slug: product.slug,
    name: product.nameAr.replace(/\s+/g, " ").trim(),
    brand: product.brand,
    categoryCode: product.categoryCode,
    categoryName,
    priceAgorot: lowest,
    priceVaries: prices.some((price) => price !== lowest),
    imageUrl: product.image.src,
    description: product.description?.trim() || null,
    usageNotes: product.usageNotes?.trim() || null,
    variants,
  };
}

export function toSocialCatalog(catalog: PublicCatalog): SocialCatalog {
  const categoryNames = new Map(
    catalog.categories.map((category) => [category.code, category.name]),
  );
  const products: SocialProduct[] = [];
  for (const product of catalog.products) {
    const social = toSocialProduct(
      product,
      categoryNames.get(product.categoryCode) ?? "",
    );
    if (social) products.push(social);
  }
  return {
    store: {
      name: catalog.store.name,
      whatsAppE164: catalog.store.whatsAppE164,
      deliveryAreaAr:
        catalog.store.delivery.area === "maythalun"
          ? "ميثلون"
          : catalog.store.delivery.area,
      deliveryFeeAgorot: catalog.store.delivery.feeAgorot,
      freeDeliveryFromAgorot: catalog.store.delivery.freeFromAgorot,
      cashOnDelivery: catalog.store.delivery.payment === "cash_on_delivery",
    },
    products,
    knownProductIds: new Set(catalog.products.map((product) => product.id)),
  };
}

export function formatSocialPrice(product: SocialProduct): string {
  const price = formatIls(product.priceAgorot);
  return product.priceVaries ? `ابتداءً من ${price}` : price;
}

/** Every price a post about these products may print; the caption guard rejects any other figure. */
export function allowedPrices(
  products: readonly SocialProduct[],
  store: StoreFacts,
): Set<string> {
  const prices = new Set<string>([
    formatIls(store.deliveryFeeAgorot),
    formatIls(store.freeDeliveryFromAgorot),
  ]);
  for (const product of products) {
    prices.add(formatIls(product.priceAgorot));
    for (const variant of product.variants) {
      prices.add(formatIls(variant.priceAgorot));
    }
  }
  return prices;
}

/** The owner's own product names and variant labels, which a caption may quote verbatim. */
export function catalogText(products: readonly SocialProduct[]): string[] {
  return products.flatMap((product) => [
    product.name,
    ...product.variants.map((variant) => variant.label),
  ]);
}

export function productUrl(origin: string, product: { slug: string }): string {
  return `${origin.replace(/\/$/, "")}/products/${encodeURIComponent(product.slug)}`;
}
