import type { Product } from "./product";

export interface ProductRepository {
  list(): Promise<readonly Product[]>;
}
