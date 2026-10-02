import { connection } from "next/server";

import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { Storefront } from "@/features/storefront/components/storefront";

export default async function HomePage() {
  await connection();
  const [products, categories] = await Promise.all([
    productRepository.list(),
    storefrontCategories(),
  ]);
  return <Storefront products={products} categories={categories} />;
}
