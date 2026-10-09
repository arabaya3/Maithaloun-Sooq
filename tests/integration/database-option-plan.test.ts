import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import {
  ProductOptionsError,
  ProductOptionsService,
} from "@/features/admin/application/product-options-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOperatorActor, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const PRODUCT = "general-cleaner";
const authoring = new CatalogAuthoringService(db);
const options = new ProductOptionsService(db, authoring);
const inventory = new InventoryService(db);

let owner: AdminActor;

const plan = {
  options: [
    {
      nameAr: "الرائحة",
      kind: "fragrance" as const,
      values: ["لافندر", "الورد الأبيض"],
    },
    { nameAr: "الحجم", kind: "size" as const, values: ["750 مل", "1 لتر"] },
  ],
  combinations: [
    ["لافندر", "750 مل"],
    ["الورد الأبيض", "750 مل"],
    ["الورد الأبيض", "1 لتر"],
  ],
};

async function counts() {
  const product = (
    await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.domainId, PRODUCT))
  )[0]!;
  const [optionRows, valueRows, variantRows] = await Promise.all([
    db
      .select()
      .from(schema.productOptions)
      .where(eq(schema.productOptions.productId, product.id)),
    db
      .select()
      .from(schema.productOptionValues)
      .where(eq(schema.productOptionValues.productId, product.id)),
    db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, product.id)),
  ]);
  return {
    options: optionRows.length,
    values: valueRows.length,
    variants: variantRows,
  };
}

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

describe("wizard option plan", () => {
  it("creates exactly the chosen combinations; the existing default keeps its stock and stays default", async () => {
    await inventory.adjust(owner, {
      idempotencyKey: crypto.randomUUID(),
      variantId: `${PRODUCT}--default`,
      reason: "opening_balance",
      quantityMilli: 5_000,
      unitCostAgorot: 300,
    });
    const { variantIds } = await options.applyOptionPlan(
      owner,
      PRODUCT,
      plan,
      crypto.randomUUID(),
    );
    expect(variantIds).toHaveLength(3);
    expect(variantIds[0]).toBe(`${PRODUCT}--default`);

    const matrix = (await options.matrix(PRODUCT))!;
    expect(matrix.variants.map((variant) => variant.label).sort()).toEqual(
      [
        "الورد الأبيض · 1 لتر",
        "الورد الأبيض · 750 مل",
        "لافندر · 750 مل",
      ].sort(),
    );
    // Lavender in 1 litre was left out on purpose and must not appear.
    expect(matrix.missing?.length).toBe(1);
    expect(matrix.duplicates).toEqual([]);
    expect(matrix.incomplete).toEqual([]);
    const original = matrix.variants.find(
      (variant) => variant.id === `${PRODUCT}--default`,
    )!;
    expect(original).toMatchObject({ isDefault: true, onHandMilli: 5_000 });
    // New variants start empty; stock is never copied from another variant.
    for (const variant of matrix.variants.filter(
      (item) => item.id !== original.id,
    )) {
      expect(variant.onHandMilli).toBe(0);
      expect(variant.priceAgorot).toBe(original.priceAgorot);
    }
  });

  it("refuses a product that already has options, and rolls back a bad plan completely", async () => {
    await options.applyOptionPlan(owner, PRODUCT, plan, crypto.randomUUID());
    await expect(
      options.applyOptionPlan(owner, PRODUCT, plan, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "already_configured" });

    await resetTestDatabase();
    owner = await createOwnerActor();
    const before = await counts();
    await expect(
      options.applyOptionPlan(
        owner,
        PRODUCT,
        { ...plan, combinations: [...plan.combinations, ["لافندر", "2 لتر"]] },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({
      code: "incomplete_combination",
      detail: "الحجم",
    });
    const after = await counts();
    expect(after.options).toBe(before.options);
    expect(after.values).toBe(before.values);
    expect(after.variants.map((variant) => variant.labelAr)).toEqual(
      before.variants.map((variant) => variant.labelAr),
    );
  });

  it("rejects repeated values and repeated combinations before writing anything", async () => {
    await expect(
      options.applyOptionPlan(
        owner,
        PRODUCT,
        {
          options: [
            {
              nameAr: "الرائحة",
              kind: "fragrance",
              values: ["الورد", "ألورد"],
            },
          ],
          combinations: [["الورد"]],
        },
        crypto.randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ProductOptionsError);
    await expect(
      options.applyOptionPlan(
        owner,
        PRODUCT,
        {
          options: [
            { nameAr: "الرائحة", kind: "fragrance", values: ["لافندر"] },
          ],
          combinations: [["لافندر"], ["لافندر"]],
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "duplicate_combination" });
    expect((await counts()).options).toBe(0);
  });

  it("is for the owner only", async () => {
    const operator = await createOperatorActor();
    await expect(
      options.applyOptionPlan(operator, PRODUCT, plan, crypto.randomUUID()),
    ).rejects.toThrow();
    expect((await counts()).options).toBe(0);
  });
});
