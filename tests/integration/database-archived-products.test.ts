import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const catalog = new AdminCatalogService(db);

let owner: AdminActor;

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

describe("archived products list", () => {
  it("still lists a product whose every variant is archived instead of failing the whole page", async () => {
    // Found by the final QA pass: a test fixture retired this way made the whole products page fail.
    // The services cannot produce it (the default variant is never archived), but one such row must not
    // take the products page down.
    const [product] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.domainId, "general-cleaner"));
    const now = new Date();
    await db
      .update(schema.productVariants)
      .set({ archivedAt: now, isDefault: false })
      .where(eq(schema.productVariants.productId, product!.id));
    await db
      .update(schema.products)
      .set({ archivedAt: now })
      .where(eq(schema.products.id, product!.id));

    const archived = await catalog.listArchived(owner);
    expect(archived.map((row) => row.id)).toContain("general-cleaner");
    expect(
      archived.find((row) => row.id === "general-cleaner")!.variants.length,
    ).toBeGreaterThan(0);
    // The live list is unaffected and still excludes it.
    expect((await catalog.list(owner)).map((row) => row.id)).not.toContain(
      "general-cleaner",
    );
  });
});
