import "server-only";

import { cache } from "react";

import type { ProductRepository } from "@/features/catalog/domain/product-repository";
import { db } from "@/server/db/db";

import { PostgresProductRepository } from "./postgres-product-repository";

const repository = new PostgresProductRepository(db);

// One catalog read per request: the store layout and the page share it.
const listOnce = cache(() => repository.list());
// Same visibility rules as getBySlug, answered from the catalog this request already loaded.
const bySlugOnce = cache(
  async (slug: string) =>
    (await listOnce()).find((product) => product.slug === slug) ?? null,
);

export const productRepository: ProductRepository = {
  list: listOnce,
  getById: (id) => repository.getById(id),
  getBySlug: bySlugOnce,
  getByIds: (ids) => repository.getByIds(ids),
};
