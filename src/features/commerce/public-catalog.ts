import {
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import {
  isProductAvailable,
  localizedProductName,
  localizedProductText,
  type Product,
} from "@/features/catalog/domain/product";
import { cardPriceAgorot } from "@/features/catalog/domain/product-sort";
import {
  FREE_DELIVERY_THRESHOLD_AGOROT,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "@/features/delivery/delivery-policy";

export const PUBLIC_API_VERSION = 1;

type Locale = "ar" | "en";

function image(
  value: Product["image"] | Product["variants"][number]["image"],
  name: string,
) {
  return value.kind === "image"
    ? {
        src: value.src,
        alt: value.alt || name,
        width: value.width,
        height: value.height,
      }
    : null;
}

/**
 * The public shape of a product for the app, the assistant and other channels.
 * It leaves out SKUs, barcodes, costs and exact stock: quantities are already capped at the cart limit.
 */
export function publicProduct(product: Product, locale: Locale) {
  const name = localizedProductName(product, locale);
  const text = localizedProductText(product, locale);
  return {
    id: product.id,
    slug: product.slug,
    name,
    nameAr: product.nameAr,
    brand: product.brand ?? null,
    categoryCode: product.categoryId,
    available: isProductAvailable(product),
    priceAgorot: cardPriceAgorot(product),
    image: image(product.image, name),
    description: text.description ?? null,
    usageNotes: text.usageNotes ?? null,
    defaultVariantId: product.defaultVariantId,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      label: variant.labelAr,
      attributes: variant.attributes,
      available: variant.availability === "available",
      image: image(variant.image, name),
      offer: variant.offer
        ? {
            kind: variant.offer.kind,
            value: variant.offer.value,
            minQuantity: variant.offer.minQuantity,
          }
        : null,
      sellingUnits: variant.sellingUnits.map((unit) => ({
        id: unit.id,
        label: unit.labelAr,
        unitsPerSale: unit.unitsPerSale,
        priceAgorot: unit.priceAgorot,
        isDefault: unit.isDefault,
        maxQuantity: unit.maxQuantity,
      })),
    })),
  };
}

export function publicCategory(category: ProductCategory, locale: Locale) {
  return {
    code: category.code,
    name: localizedCategoryName(category, locale),
    icon: category.icon,
  };
}

export function publicStoreInfo(whatsAppE164: string | null) {
  return {
    name: "MAYTHA MARKET",
    currency: "ILS",
    whatsAppE164,
    delivery: {
      area: "maythalun",
      feeAgorot: STANDARD_DELIVERY_FEE_AGOROT,
      freeFromAgorot: FREE_DELIVERY_THRESHOLD_AGOROT,
      payment: "cash_on_delivery",
    },
  };
}
