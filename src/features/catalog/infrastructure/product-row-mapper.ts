import { productSchema, type Product } from "@/features/catalog/domain/product";
import {
  productSpecificationSchema,
  productVariantSchema,
  type ProductSpecification,
  type ProductVariant,
  variantAttributesSchema,
} from "@/features/catalog/domain/product-variant";
import {
  productSpecifications,
  productVariants,
  products,
} from "@/server/db/schema";

type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof productVariants.$inferSelect;
type SpecRow = typeof productSpecifications.$inferSelect;

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
): Product {
  const mappedVariants = [...variants]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((variant) => mapVariantRow(variant, row.domainId));

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
    description: row.description ?? undefined,
    usageNotes: row.usageNotes ?? undefined,
    unit: row.unit ?? undefined,
    detailsStatus: row.detailsStatus,
    defaultVariantId: defaultVariant.id,
    variants: mappedVariants,
    specifications: mappedSpecs,
  });
}
