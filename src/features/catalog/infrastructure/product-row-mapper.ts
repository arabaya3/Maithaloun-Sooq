import { MAX_CART_QUANTITY } from "@/features/cart/cart-store";
import type { VariantOffer } from "@/features/catalog/domain/offer-pricing";
import { productSchema, type Product } from "@/features/catalog/domain/product";
import {
  productSpecificationSchema,
  productVariantSchema,
  type ProductSpecification,
  type ProductVariant,
  variantAttributesSchema,
} from "@/features/catalog/domain/product-variant";
import {
  maxOrderQuantity,
  type SellingUnit,
} from "@/features/catalog/domain/selling-unit";
import {
  productSellingUnits,
  productSpecifications,
  productVariants,
  products,
} from "@/server/db/schema";

type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof productVariants.$inferSelect;
type SpecRow = typeof productSpecifications.$inferSelect;
export type SellingUnitRow = typeof productSellingUnits.$inferSelect;

// What the storefront needs to sell a variant, keyed by the variant UUID.
export interface VariantCommerce {
  units: readonly SellingUnitRow[];
  // Unreserved stock in base milli-units; null when the variant is not stock-tracked.
  freeBaseMilli: number | null;
}

export function mapSellingUnits(
  commerce: VariantCommerce | undefined,
): SellingUnit[] {
  if (!commerce) return [];
  return commerce.units
    .filter((unit) => !unit.archivedAt)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.unitsPerSale - right.unitsPerSale,
    )
    .map((unit) => ({
      id: unit.id,
      labelAr: unit.labelAr,
      unitsPerSale: unit.unitsPerSale,
      priceAgorot: unit.priceAgorot,
      isDefault: unit.isDefault,
      ...(unit.sku ? { sku: unit.sku } : {}),
      ...(unit.barcode ? { barcode: unit.barcode } : {}),
      maxQuantity: maxOrderQuantity(
        commerce.freeBaseMilli,
        unit.unitsPerSale,
        MAX_CART_QUANTITY,
      ),
    }));
}

function mapImage(row: {
  imageKind: ProductRow["imageKind"];
  placeholderVariant: ProductRow["placeholderVariant"];
  imageSrc: ProductRow["imageSrc"];
  imageAlt: ProductRow["imageAlt"];
  imageWidth: ProductRow["imageWidth"];
  imageHeight: ProductRow["imageHeight"];
}) {
  return row.imageKind === "placeholder"
    ? {
        kind: "placeholder" as const,
        variant: row.placeholderVariant!,
      }
    : {
        kind: "image" as const,
        src: row.imageSrc!,
        alt: row.imageAlt!,
        width: row.imageWidth!,
        height: row.imageHeight!,
      };
}

export function mapVariantRow(
  row: VariantRow,
  productDomainId: string,
  offer?: VariantOffer,
  commerce?: VariantCommerce,
): ProductVariant {
  return productVariantSchema.parse({
    id: row.domainId,
    productId: productDomainId,
    labelAr: row.labelAr,
    attributes: variantAttributesSchema.parse(row.attributes ?? {}),
    priceAgorot: row.priceAgorot,
    availability: row.availability,
    image: mapImage(row),
    sku: row.sku ?? undefined,
    barcode: row.barcode ?? undefined,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    ...(offer ? { offer } : {}),
    sellingUnits: mapSellingUnits(commerce),
  });
}

export function mapSpecificationRow(row: SpecRow): ProductSpecification {
  return productSpecificationSchema.parse({
    id: row.id,
    labelAr: row.labelAr,
    valueAr: row.valueAr,
    sortOrder: row.sortOrder,
  });
}

export function mapProductRow(
  row: ProductRow,
  variants: readonly VariantRow[],
  specifications: readonly SpecRow[] = [],
  offers: ReadonlyMap<string, VariantOffer> = new Map(),
  commerce: ReadonlyMap<string, VariantCommerce> = new Map(),
): Product {
  const mappedVariants = variants
    .filter((variant) => !variant.archivedAt)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((variant) =>
      mapVariantRow(
        variant,
        row.domainId,
        offers.get(variant.id),
        commerce.get(variant.id),
      ),
    );

  if (!mappedVariants.length) {
    throw new Error(`Product ${row.domainId} has no variants`);
  }

  const defaultVariant =
    mappedVariants.find((variant) => variant.isDefault) ?? mappedVariants[0]!;

  const mappedSpecs = [...specifications]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(mapSpecificationRow);

  return productSchema.parse({
    id: row.domainId,
    slug: row.slug,
    nameAr: row.nameAr,
    latinName: row.latinName ?? undefined,
    priceAgorot: defaultVariant.priceAgorot,
    categoryId: row.categoryId,
    image: defaultVariant.image,
    availability: defaultVariant.availability,
    publication: row.publication,
    description: row.description ?? undefined,
    usageNotes: row.usageNotes ?? undefined,
    unit: row.unit ?? undefined,
    detailsStatus: row.detailsStatus,
    defaultVariantId: defaultVariant.id,
    variants: mappedVariants,
    specifications: mappedSpecs,
  });
}
