import "server-only";

import type { ProductRepository } from "@/features/catalog/domain/product-repository";
import { db } from "@/server/db/db";

import { PostgresProductRepository } from "./postgres-product-repository";

export const productRepository: ProductRepository =
  new PostgresProductRepository(db);
