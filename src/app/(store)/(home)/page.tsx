import { connection } from "next/server";

import { ALL_CATEGORIES } from "@/features/catalog/domain/category";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { Storefront } from "@/features/storefront/components/storefront";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  await connection();
  const [products, categories, { category }] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
    searchParams,
  ]);
  // Unknown, hidden or archived codes fall back to every product.
  const initialCategory =
    categories.find((item) => item.code === category)?.code ?? ALL_CATEGORIES;
  return (
    <Storefront
      products={products}
      categories={categories}
      initialCategory={initialCategory}
    />
  );
}
