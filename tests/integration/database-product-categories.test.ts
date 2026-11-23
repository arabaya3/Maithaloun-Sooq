import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import {
  categoryProductCounts,
  productsInCategory,
} from "@/features/catalog/domain/product-categories";
import { sortProducts } from "@/features/catalog/domain/product-sort";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const catalog = new AdminCatalogService(db);
const authoring = new CatalogAuthoringService(db);
const storefront = new PostgresProductRepository(db);

let owner: AdminActor;

const baseUpdate = {
  domainId: "general-cleaner",
  nameAr: "منظف عام",
  latinName: "Secret",
  priceAgorot: 700,
  categoryId: "home",
  availability: "available" as const,
  sortOrder: 1,
  detailsStatus: "verified" as const,
  placeholderVariant: "general-cleaner" as const,
};

async function linksOf(domainId: string) {
  const rows = await db
    .select({ code: schema.productCategoryLinks.categoryCode })
    .from(schema.productCategoryLinks)
    .innerJoin(
      schema.products,
      eq(schema.products.id, schema.productCategoryLinks.productId),
    )
    .where(eq(schema.products.domainId, domainId));
  return rows.map((row) => row.code).sort();
}

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

describe("products in several categories", () => {
  it("backfills every product's current category as a listing", async () => {
    const [missing] = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from products p
      where not exists (select 1 from product_category_links l
        where l.product_id = p.id and l.category_code = p.category_id)`);
    expect(missing?.count).toBe(0);
  });

  it("shows one product in two categories, once in all products, with the right counts", async () => {
    await catalog.update(owner, {
      ...baseUpdate,
      extraCategoryIds: ["kitchen"],
    });
    const products = await storefront.list();
    const ids = products.map((product) => product.id);
    expect(new Set(ids).size).toBe(ids.length);

    const cleaner = products.find(
      (product) => product.id === "general-cleaner",
    )!;
    expect(cleaner.categoryId).toBe("home");
    expect(cleaner.categoryIds).toEqual(["home", "kitchen"]);
    expect(
      productsInCategory(products, "kitchen").map((product) => product.id),
    ).toContain("general-cleaner");
    expect(
      productsInCategory(products, "home").map((product) => product.id),
    ).toContain("general-cleaner");

    const counts = categoryProductCounts(products);
    const kitchenRows = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.categoryId, "kitchen"));
    expect(counts.get("kitchen")).toBe(kitchenRows.length + 1);

    // The admin's category list counts it in both, once each.
    const listed = await authoring.listCategories();
    expect(listed.find((row) => row.code === "kitchen")?.productCount).toBe(
      kitchenRows.length + 1,
    );
  });

  it("keeps the extra categories when a save does not send them, and replaces them when it does", async () => {
    await catalog.update(owner, {
      ...baseUpdate,
      extraCategoryIds: ["kitchen", "laundry"],
    });
    // The assistant, quick edits and older forms save without the list.
    await catalog.update(owner, { ...baseUpdate, priceAgorot: 900 });
    expect(await linksOf("general-cleaner")).toEqual([
      "home",
      "kitchen",
      "laundry",
    ]);

    // Moving the primary keeps the extras and drops the old primary.
    await catalog.update(owner, { ...baseUpdate, categoryId: "bathroom" });
    expect(await linksOf("general-cleaner")).toEqual([
      "bathroom",
      "kitchen",
      "laundry",
    ]);

    await catalog.update(owner, {
      ...baseUpdate,
      categoryId: "bathroom",
      extraCategoryIds: ["home"],
    });
    expect(await linksOf("general-cleaner")).toEqual(["bathroom", "home"]);

    await catalog.update(owner, {
      ...baseUpdate,
      categoryId: "bathroom",
      extraCategoryIds: [],
    });
    expect(await linksOf("general-cleaner")).toEqual(["bathroom"]);
  });

  it("refuses an extra category that does not exist", async () => {
    await expect(
      catalog.update(owner, {
        ...baseUpdate,
        extraCategoryIds: ["no-such-category"],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await linksOf("general-cleaner")).toEqual(["home"]);
  });

  it("moves extra listings with a category merge", async () => {
    await catalog.update(owner, {
      ...baseUpdate,
      extraCategoryIds: ["laundry"],
    });
    await authoring.mergeCategories(owner, {
      sourceCode: "laundry",
      targetCode: "kitchen",
    });
    expect(await linksOf("general-cleaner")).toEqual(["home", "kitchen"]);
  });
});

describe("newest first", () => {
  it("orders by the original creation time and does not move a product when it is edited", async () => {
    await db.execute(sql`
      update products set created_at = now() - (interval '1 day' * sort_order)`);
    const before = sortProducts(await storefront.list(), "newest").map(
      (product) => product.id,
    );
    const last = before.at(-1)!;
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, last));
    await catalog.update(owner, {
      ...baseUpdate,
      domainId: last,
      nameAr: row!.nameAr,
      latinName: row!.latinName ?? undefined,
      categoryId: row!.categoryId,
      sortOrder: row!.sortOrder,
      priceAgorot: row!.priceAgorot + 100,
    });
    const after = sortProducts(await storefront.list(), "newest").map(
      (product) => product.id,
    );
    expect(after).toEqual(before);
  });
});
