import { and, eq, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOperatorActor, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const authoring = new CatalogAuthoringService(db);
const inventory = new InventoryService(db);
const HOME = ["general-cleaner", "smart-floor-cleaner"];

let owner: AdminActor;

async function categoriesOf(ids: string[]) {
  const rows = await db
    .select({
      id: schema.products.domainId,
      category: schema.products.categoryId,
    })
    .from(schema.products)
    .where(inArray(schema.products.domainId, ids));
  return Object.fromEntries(rows.map((row) => [row.id, row.category]));
}

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

describe("moving products between categories", () => {
  it("moves the chosen products with their stock, audits each one, and frees the category for archiving", async () => {
    await inventory.adjust(owner, {
      idempotencyKey: crypto.randomUUID(),
      variantId: "general-cleaner--default",
      reason: "opening_balance",
      quantityMilli: 3_000,
      unitCostAgorot: 250,
    });
    await expect(
      authoring.archiveCategory(owner, "home"),
    ).rejects.toMatchObject({ code: "category_not_empty" });

    const home = (
      await db
        .select({ id: schema.products.domainId })
        .from(schema.products)
        .where(
          and(
            eq(schema.products.categoryId, "home"),
            isNull(schema.products.archivedAt),
          ),
        )
    ).map((row) => row.id);
    expect(home).toEqual(expect.arrayContaining(HOME));
    const result = await authoring.moveProducts(owner, {
      productDomainIds: home,
      targetCode: "kitchen",
    });
    expect(result).toEqual({ moved: home.length });
    expect(new Set(Object.values(await categoriesOf(home)))).toEqual(
      new Set(["kitchen"]),
    );

    const stock = await inventory.listStock(owner);
    expect(
      stock.find((item) => item.variantId === "general-cleaner--default")
        ?.onHandMilli,
    ).toBe(3_000);

    const audits = await db
      .select()
      .from(schema.adminAuditEvents)
      .where(
        and(
          eq(schema.adminAuditEvents.actionType, "product_category_move"),
          inArray(schema.adminAuditEvents.entityId, HOME),
        ),
      );
    expect(audits).toHaveLength(HOME.length);

    await authoring.archiveCategory(owner, "home");
    expect(
      (await authoring.listCategories(true)).find(
        (category) => category.code === "home",
      )?.archived,
    ).toBe(true);
  });

  it("refuses an archived or unknown target and changes nothing", async () => {
    await authoring.moveProducts(owner, {
      productDomainIds: ["carpet-brush"],
      targetCode: "kitchen",
    });
    await authoring.archiveCategory(owner, "tools");
    const before = await categoriesOf(HOME);
    await expect(
      authoring.moveProducts(owner, {
        productDomainIds: HOME,
        targetCode: "tools",
      }),
    ).rejects.toMatchObject({ code: "category_unavailable" });

    await expect(
      authoring.moveProducts(owner, {
        productDomainIds: HOME,
        targetCode: "no-such-category",
      }),
    ).rejects.toMatchObject({ code: "category_unavailable" });
    expect(await categoriesOf(HOME)).toEqual(before);
  });

  it("names no offers for a category without one", async () => {
    expect(await authoring.offersNamingCategory("tools")).toEqual([]);
  });

  it("is for the owner only", async () => {
    const operator = await createOperatorActor();
    await expect(
      authoring.moveProducts(operator, {
        productDomainIds: HOME,
        targetCode: "kitchen",
      }),
    ).rejects.toThrow();
    expect(await categoriesOf(HOME)).toEqual({
      "general-cleaner": "home",
      "smart-floor-cleaner": "home",
    });
  });
});
