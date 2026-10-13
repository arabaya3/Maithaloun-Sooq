import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { resolveStockStatus } from "@/features/inventory/domain/stock-status";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOperatorActor, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const inventory = new InventoryService(db);
let owner: AdminActor;

async function open(variantId: string, pieces: number) {
  await inventory.adjust(owner, {
    idempotencyKey: crypto.randomUUID(),
    variantId,
    reason: "opening_balance",
    quantityMilli: pieces * 1_000,
    unitCostAgorot: 300,
  });
}

async function thresholdOf(variantId: string) {
  const [row] = await db
    .select({ milli: schema.inventoryItems.reorderThresholdMilli })
    .from(schema.inventoryItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.id, schema.inventoryItems.variantId),
    )
    .where(eq(schema.productVariants.domainId, variantId));
  return row?.milli;
}

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

describe("low-stock thresholds", () => {
  it("warns when available stock is at or below the threshold", () => {
    const status = (pieces: number) =>
      resolveStockStatus({
        onHandMilli: pieces * 1_000,
        reservedMilli: 0,
        reorderThresholdMilli: 2_000,
      });
    expect([0, 1, 2, 3].map(status)).toEqual(["out", "low", "low", "ok"]);
  });

  it("gives new stock a threshold of two pieces, per variant", async () => {
    await open("general-cleaner--default", 1);
    await open("dolphin-bleach--default", 5);
    expect(await thresholdOf("general-cleaner--default")).toBe(2_000);
    expect(await thresholdOf("dolphin-bleach--default")).toBe(2_000);
    const rows = await inventory.listStock(owner);
    expect(
      rows.find((row) => row.variantId === "general-cleaner--default")?.status,
    ).toBe("low");
    expect(
      rows.find((row) => row.variantId === "dolphin-bleach--default")?.status,
    ).toBe("ok");
  });

  it("sets every active tracked variant to two once, audits counts, and leaves stock alone", async () => {
    await open("general-cleaner--default", 4);
    await open("dolphin-bleach--default", 6);
    await inventory.setReorderThreshold(owner, {
      variantId: "dolphin-bleach--default",
      thresholdMilli: 5_000,
    });
    const before = await inventory.listStock(owner);
    expect(await inventory.reorderThresholdOverview(owner, 2_000)).toEqual({
      eligible: 2,
      alreadySet: 1,
      changing: 1,
    });

    expect(await inventory.setReorderThresholdForActive(owner, 2_000)).toEqual({
      eligible: 2,
      changed: 1,
    });
    expect(await thresholdOf("dolphin-bleach--default")).toBe(2_000);
    expect(await inventory.setReorderThresholdForActive(owner, 2_000)).toEqual({
      eligible: 2,
      changed: 0,
    });

    const after = await inventory.listStock(owner);
    const stock = (rows: typeof before) =>
      rows.map((row) => [row.variantId, row.onHandMilli, row.avgCostAgorot]);
    expect(stock(after)).toEqual(stock(before));
    const audits = await db
      .select()
      .from(schema.adminAuditEvents)
      .where(
        eq(schema.adminAuditEvents.actionType, "reorder_threshold_bulk_update"),
      );
    expect(audits.map((row) => row.afterState)).toEqual([
      { reorderThresholdMilli: 2_000, changed: 1 },
      { reorderThresholdMilli: 2_000, changed: 0 },
    ]);

    // One variant can still be set on its own afterwards.
    await inventory.setReorderThreshold(owner, {
      variantId: "general-cleaner--default",
      thresholdMilli: 3_000,
    });
    expect(await thresholdOf("general-cleaner--default")).toBe(3_000);
  });

  it("leaves archived products out and refuses operators", async () => {
    await open("general-cleaner--default", 4);
    await db
      .update(schema.products)
      .set({ archivedAt: new Date() })
      .where(eq(schema.products.domainId, "general-cleaner"));
    expect(await inventory.reorderThresholdOverview(owner, 2_000)).toEqual({
      eligible: 0,
      alreadySet: 0,
      changing: 0,
    });
    await expect(
      inventory.setReorderThresholdForActive(
        await createOperatorActor(),
        2_000,
      ),
    ).rejects.toThrow();
  });
});
