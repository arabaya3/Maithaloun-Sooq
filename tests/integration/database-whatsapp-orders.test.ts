import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { OrderService } from "@/features/orders/application/order-service";
import { StoreContactService } from "@/features/orders/application/store-contact-service";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOperatorActor, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const orders = new OrderService(db);
const admin = new AdminOrderService(db);
const inventory = new InventoryService(db);
const contact = new StoreContactService(db);
// Never contacted: tests only check stored values and generated links.
const TEST_NUMBER = "0590000000";

let owner: AdminActor;

function request(overrides: Record<string, unknown> = {}) {
  return checkoutRequestSchema.parse({
    idempotencyKey: crypto.randomUUID(),
    customerName: "عميل تجريبي",
    whatsappCountryCode: "970",
    whatsappNationalNumber: "0591234567",
    serviceAreaCode: "maythalun",
    deliveryAddress: "عنوان محلي مفصل للاختبار",
    landmark: "قرب المسجد الكبير",
    paymentMethod: "cash_on_delivery",
    honeypot: "",
    items: [
      {
        productId: "general-cleaner",
        variantId: "general-cleaner--default",
        quantity: 2,
      },
    ],
    ...overrides,
  });
}

async function storedOrder(reference: string) {
  return (
    await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.publicReference, reference))
  )[0]!;
}

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

describe("store WhatsApp number", () => {
  it("is owner only, validated, audited, and can be turned off", async () => {
    expect(await contact.whatsAppNumber()).toBeNull();
    await expect(
      contact.setWhatsAppNumber(await createOperatorActor(), {
        countryCode: "970",
        nationalNumber: TEST_NUMBER,
      }),
    ).rejects.toThrow();
    await expect(
      contact.setWhatsAppNumber(owner, {
        countryCode: "970",
        nationalNumber: "12345",
      }),
    ).rejects.toMatchObject({ code: "invalid_number" });

    await contact.setWhatsAppNumber(owner, {
      countryCode: "970",
      nationalNumber: TEST_NUMBER,
    });
    expect(await contact.whatsAppNumber()).toBe("+970590000000");
    await contact.setWhatsAppNumber(owner, {
      countryCode: "970",
      nationalNumber: "",
    });
    expect(await contact.whatsAppNumber()).toBeNull();

    const audits = await db
      .select()
      .from(schema.adminAuditEvents)
      .where(eq(schema.adminAuditEvents.entityId, "store_whatsapp_e164"));
    expect(audits).toHaveLength(2);
  });
});

describe("orders sent through WhatsApp", () => {
  it("are refused while the store has no WhatsApp number", async () => {
    await expect(
      orders.create(request({ checkoutChannel: "whatsapp" })),
    ).rejects.toMatchObject({ code: "whatsapp_unavailable" });
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });

  it("wait for confirmation without reserving stock, replay idempotently, and reserve once confirmed", async () => {
    await contact.setWhatsAppNumber(owner, {
      countryCode: "970",
      nationalNumber: TEST_NUMBER,
    });
    await inventory.adjust(owner, {
      idempotencyKey: crypto.randomUUID(),
      variantId: "general-cleaner--default",
      reason: "opening_balance",
      quantityMilli: 5_000,
      unitCostAgorot: 300,
    });
    const sent = request({ checkoutChannel: "whatsapp" });
    const first = await orders.create(sent);
    expect(first.status).toBe("awaiting_whatsapp");
    const replay = await orders.create(sent);
    expect(replay.publicReference).toBe(first.publicReference);
    expect(replay.duplicate).toBe(true);
    await expect(
      orders.create({ ...sent, checkoutChannel: "web" }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });

    const order = await storedOrder(first.publicReference);
    expect(order).toMatchObject({
      checkoutChannel: "whatsapp",
      landmark: "قرب المسجد الكبير",
    });
    const stockBefore = await inventory.listStock(owner);
    expect(
      stockBefore.find((item) => item.variantId === "general-cleaner--default")
        ?.reservedMilli,
    ).toBe(0);

    const lines = await orders.getConfirmationLines(first.publicReference);
    expect(lines!.channel).toBe("whatsapp");
    expect(lines!.lines).toHaveLength(1);
    expect(lines!.lines[0]).toMatchObject({ quantity: 2 });
    expect(JSON.stringify(lines)).not.toMatch(/0591234567|عنوان محلي|عميل/);

    const detail = await admin.getByPublicReference(
      owner,
      first.publicReference,
    );
    await admin.changeStatus(owner, {
      publicReference: first.publicReference,
      nextStatus: "confirmed",
      expectedVersion: detail!.version,
    });
    const stockAfter = await inventory.listStock(owner);
    expect(
      stockAfter.find((item) => item.variantId === "general-cleaner--default")
        ?.reservedMilli,
    ).toBe(2_000);
  });

  it("keeps website orders pending and stores their landmark", async () => {
    const created = await orders.create(request());
    expect(created.status).toBe("pending");
    expect(await storedOrder(created.publicReference)).toMatchObject({
      checkoutChannel: "web",
      landmark: "قرب المسجد الكبير",
    });
  });
});
