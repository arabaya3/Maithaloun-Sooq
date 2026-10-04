import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  QA_PROBE_PRODUCT_ID,
  QA_PROBE_VARIANT_ID,
  QaSimulationError,
  QaStockSimulationService,
} from "@/features/admin/application/qa-stock-simulation";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { postStockAdjustment } from "@/features/inventory/application/inventory-service";
import {
  OrderCreationError,
  OrderService,
  QA_ORDER_PHONE,
} from "@/features/orders/application/order-service";
import {
  adminAuditEvents,
  orders,
  productVariants,
  products,
  qaSimulationRuns,
} from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  OPERATIONS_TABLES,
  checkoutRequest,
  createOperatorActor,
  createOwnerActor,
} from "./support";

const { db, client } = testDatabaseConnection;
const enabled = new QaStockSimulationService(db, { enabled: () => true });
const disabled = new QaStockSimulationService(db, { enabled: () => false });
const faulty = new QaStockSimulationService(db, {
  enabled: () => true,
  faultAfterCancel: true,
});

let owner: AdminActor;
let operator: AdminActor;

// Every business table a run could write, dumped whole: equal dumps mean nothing persisted.
const BUSINESS_TABLES = [
  "orders",
  "order_items",
  "order_status_history",
  "customer_order_links",
  "stock_reservations",
  "stock_movements",
  "inventory_items",
  "inventory_adjustments",
  "admin_notifications",
  "customers",
  "customer_ledger_entries",
  "customer_invoices",
  "customer_payments",
  "supplier_ledger_entries",
  "customer_reminders",
  "report_snapshots",
];

async function businessState(): Promise<string> {
  const existing = await client.unsafe<{ name: string }[]>(
    `select table_name as name from information_schema.tables
      where table_schema = 'public' and table_name in (${BUSINESS_TABLES.map((name) => `'${name}'`).join(",")})
      order by table_name`,
  );
  const dumps: Record<string, unknown> = {};
  for (const { name } of existing) {
    const rows = await client.unsafe<{ value: unknown }[]>(
      `select coalesce(json_agg(row_to_json(t) order by row_to_json(t)::text), '[]'::json) as value from "${name}" t`,
    );
    dumps[name] = rows[0]!.value;
  }
  return JSON.stringify(dumps);
}

async function code(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof QaSimulationError ? error.code : String(error);
  }
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
  await client.unsafe(`TRUNCATE TABLE qa_simulation_runs`);
  await enabled.ensureProbe(owner);
});

describe("owner QA stock-path simulation", () => {
  it("runs the real order, reserve, cancel, restock and delivery paths and leaves no business row behind", async () => {
    const before = await businessState();
    const { token } = await enabled.issue(owner, QA_PROBE_VARIANT_ID);
    const result = await enabled.run(owner, token);

    expect(result).toMatchObject({
      passed: true,
      failedStep: null,
      rollbackVerified: true,
      supportReference: expect.stringMatching(/^[0-9A-F]{8}$/),
    });
    expect(result.checkpoints).toEqual({
      initialAvailableMilli: 0,
      initialOnHandMilli: 0,
      seededMilli: 2_000,
      availableAfterOrderMilli: 1_000,
      availableAfterCancelMilli: 2_000,
      onHandAfterDeliveryMilli: 1_000,
      exactVariant: true,
      exactPrice: true,
      duplicateOrderReplayed: true,
      repeatedCancelRejected: true,
    });
    expect(await businessState()).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(
      /qa-test|token|phone|محاكاة داخلية/i,
    );

    const [run] = await db.select().from(qaSimulationRuns);
    expect(run).toMatchObject({
      status: "passed",
      durationMs: expect.any(Number),
    });
    const audits = await db
      .select()
      .from(adminAuditEvents)
      .where(eq(adminAuditEvents.actionType, "qa_stock_simulation"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      adminUserId: owner.id,
      entityId: QA_PROBE_VARIANT_ID,
      afterState: {
        passed: true,
        durationMs: expect.any(Number),
        supportReference: result.supportReference,
      },
    });
    expect(JSON.stringify(audits[0]!.afterState)).not.toMatch(
      /price|phone|address|agorot/i,
    );
  });

  it("uses existing persisted stock without changing it", async () => {
    await db.transaction((transaction) =>
      postStockAdjustment(transaction, owner, {
        idempotencyKey: crypto.randomUUID(),
        variantId: QA_PROBE_VARIANT_ID,
        reason: "opening_balance",
        quantityMilli: 5_000,
        unitCostAgorot: 40,
      }),
    );
    const before = await businessState();
    const { token } = await enabled.issue(owner, QA_PROBE_VARIANT_ID);
    const result = await enabled.run(owner, token);
    expect(result.checkpoints).toMatchObject({
      initialAvailableMilli: 5_000,
      seededMilli: 0,
      availableAfterOrderMilli: 4_000,
      availableAfterCancelMilli: 5_000,
      onHandAfterDeliveryMilli: 4_000,
    });
    expect(await businessState()).toBe(before);
  });

  it("is off by default and owner-only", async () => {
    expect(await code(disabled.issue(owner, QA_PROBE_VARIANT_ID))).toBe(
      "disabled",
    );
    expect(await code(enabled.issue(operator, QA_PROBE_VARIANT_ID))).toBe(
      "forbidden",
    );
    expect(
      await code(
        enabled.issue({ ...owner, active: false }, QA_PROBE_VARIANT_ID),
      ),
    ).toBe("forbidden");
    const { token } = await enabled.issue(owner, QA_PROBE_VARIANT_ID);
    expect(await code(enabled.run(operator, token))).toBe("forbidden");
    expect(await code(disabled.run(owner, token))).toBe("disabled");
  });

  it("fails closed for a variant that is not QA-owned or is published", async () => {
    expect(await code(enabled.issue(owner, "general-cleaner--default"))).toBe(
      "not_qa_owned",
    );
    expect(await code(enabled.issue(owner, "missing--variant"))).toBe(
      "not_qa_owned",
    );
    await db
      .update(products)
      .set({ publication: "published" })
      .where(eq(products.domainId, QA_PROBE_PRODUCT_ID));
    try {
      expect(await code(enabled.issue(owner, QA_PROBE_VARIANT_ID))).toBe(
        "not_qa_owned",
      );
      // Even published by mistake, public checkout refuses the QA variant.
      await expect(
        new OrderService(db).create(
          checkoutRequest([
            {
              productId: QA_PROBE_PRODUCT_ID,
              variantId: QA_PROBE_VARIANT_ID,
              quantity: 1,
            },
          ]),
        ),
      ).rejects.toMatchObject({
        code: "unavailable_product",
      } satisfies Partial<OrderCreationError>);
    } finally {
      await db
        .update(products)
        .set({ publication: "hidden" })
        .where(eq(products.domainId, QA_PROBE_PRODUCT_ID));
    }
    expect(await db.select().from(qaSimulationRuns)).toHaveLength(0);
  });

  it("rejects a replayed or expired token", async () => {
    const { token } = await enabled.issue(owner, QA_PROBE_VARIANT_ID);
    expect((await enabled.run(owner, token)).passed).toBe(true);
    expect(await code(enabled.run(owner, token))).toBe("invalid_token");
    expect(await code(enabled.run(owner, "x".repeat(43)))).toBe(
      "invalid_token",
    );

    const late = await enabled.issue(owner, QA_PROBE_VARIANT_ID);
    await db
      .update(qaSimulationRuns)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(qaSimulationRuns.status, "issued"));
    expect(await code(enabled.run(owner, late.token))).toBe("invalid_token");
  });

  it("refuses a second run on the same QA variant while one is running", async () => {
    const [variant] = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.domainId, QA_PROBE_VARIANT_ID));
    await db.insert(qaSimulationRuns).values({
      adminUserId: owner.id,
      variantId: variant!.id,
      tokenHash: "0".repeat(64),
      status: "running",
      supportReference: "LOCKED00",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const before = await businessState();
    const { token } = await enabled.issue(owner, QA_PROBE_VARIANT_ID);
    expect(await code(enabled.run(owner, token))).toBe("busy");
    expect(await businessState()).toBe(before);
  });

  it("rolls everything back when a step fails after the cancellation", async () => {
    const before = await businessState();
    const { token } = await faulty.issue(owner, QA_PROBE_VARIANT_ID);
    const result = await faulty.run(owner, token);
    expect(result).toMatchObject({
      passed: false,
      checkpoints: null,
      failedStep: "injected_fault",
      rollbackVerified: true,
    });
    expect(await businessState()).toBe(before);
    const [run] = await db.select().from(qaSimulationRuns);
    expect(run!.status).toBe("failed");
  });

  it("limits each owner to ten runs an hour", async () => {
    for (let index = 0; index < 10; index += 1) {
      await enabled.issue(owner, QA_PROBE_VARIANT_ID);
    }
    expect(await code(enabled.issue(owner, QA_PROBE_VARIANT_ID))).toBe(
      "rate_limited",
    );
  });

  it("keeps a persisted QA order from ever being fulfilled outside the simulation", async () => {
    const order = await new OrderService(db).create(
      {
        ...checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
        whatsappPhoneE164: QA_ORDER_PHONE,
        normalizedPhone: QA_ORDER_PHONE,
      },
      { customerAccountId: null },
      { test: true },
    );
    await expect(
      db
        .update(orders)
        .set({ status: "confirmed" })
        .where(eq(orders.publicReference, order.publicReference)),
    ).rejects.toThrow();
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.status, "confirmed"));
    expect(row!.total).toBe(0);
  });
});
