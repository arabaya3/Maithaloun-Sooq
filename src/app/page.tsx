import { connection } from "next/server";

import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { Storefront } from "@/features/storefront/components/storefront";

export default async function HomePage() {
  await connection();
  const products = await productRepository.list();
  return <Storefront products={products} />;
}
