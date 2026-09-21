import { productRepository } from "@/features/catalog/infrastructure/mock-product-repository";
import { Storefront } from "@/features/storefront/components/storefront";

export default async function HomePage() {
  const products = await productRepository.list();
  return <Storefront products={products} />;
}
