import { productSchema, type Product } from "@/features/catalog/domain/product";
import { products } from "@/server/db/schema";

type ProductRow = typeof products.$inferSelect;

export function mapProductRow(row: ProductRow): Product {
  const image =
    row.imageKind === "placeholder"
      ? {
          kind: "placeholder" as const,
          variant: row.placeholderVariant,
        }
      : {
          kind: "image" as const,
          src: row.imageSrc,
          alt: row.imageAlt,
          width: row.imageWidth,
          height: row.imageHeight,
        };

  return productSchema.parse({
    id: row.domainId,
    slug: row.slug,
    nameAr: row.nameAr,
    latinName: row.latinName ?? undefined,
    priceAgorot: row.priceAgorot,
    categoryId: row.categoryId,
    image,
    availability: row.availability,
    description: row.description ?? undefined,
    usageNotes: row.usageNotes ?? undefined,
    unit: row.unit ?? undefined,
    detailsStatus: row.detailsStatus,
  });
}
