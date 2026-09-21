import type { Product } from "./product";

export interface ProductRepository {
  list(): Promise<readonly Product[]>;
  getById(id: string): Promise<Product | null>;
  getBySlug(slug: string): Promise<Product | null>;
  getByIds(ids: readonly string[]): Promise<readonly Product[]>;
}
