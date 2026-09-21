import type { Product } from "./product";

export interface ProductRepository {
  list(): Promise<readonly Product[]>;
  getBySlug(slug: string): Promise<Product | null>;
  getByIds(ids: readonly string[]): Promise<readonly Product[]>;
}
