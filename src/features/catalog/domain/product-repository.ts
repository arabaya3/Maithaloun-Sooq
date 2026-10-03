import type { Product } from "./product";
import type { ProductPresentation } from "./product-presentation";

export interface ProductRepository {
  list(): Promise<readonly Product[]>;
  getById(id: string): Promise<Product | null>;
  getBySlug(slug: string): Promise<Product | null>;
  getByIds(ids: readonly string[]): Promise<readonly Product[]>;
  presentation(productId: string): Promise<ProductPresentation>;
}
