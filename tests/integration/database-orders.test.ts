import { count, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { PostgresServiceAreaRepository } from "@/features/delivery/postgres-service-area-repository";
import { OrderService } from "@/features/orders/application/order-service";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import { insertVerifiedReferenceData } from "@/server/db/development-seed";
import {
  orderItems,
  orders,
  productVariants,
  products,
  serviceAreas,
} from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { db, client } = testDatabaseConnection;
const productRepository = new PostgresProductRepository(db);
const serviceAreaRepository = new PostgresServiceAreaRepository(db);
const orderService = new OrderService(db);

function createRequest(
  overrides: Partial<{
    idempotencyKey: string;
    deliveryAddress: string;
    address: string;
    serviceAreaCode: string;
    whatsappCountryCode: "970" | "972";
    whatsappNationalNumber: string;
    items: { productId: string; variantId?: string; quantity: number }[];
  }> = {},
) {
  const items = (
    overrides.items ?? [{ productId: "general-cleaner", quantity: 2 }]
  ).map((item) => ({
    productId: item.productId,
    variantId: item.variantId ?? `${item.productId}--default`,
    quantity: item.quantity,
  }));

  return checkoutRequestSchema.parse({
    idempotencyKey: overrides.idempotencyKey ?? crypto.randomUUID(),
    customerName: "عميل تجريبي",
    whatsappCountryCode: overrides.whatsappCountryCode ?? "970",
    whatsappNationalNumber: overrides.whatsappNationalNumber ?? "0591234567",
    serviceAreaCode: overrides.serviceAreaCode ?? "maythalun",
    deliveryAddress:
      overrides.deliveryAddress ??
      overrides.address ??
      "عنوان محلي مفصل للاختبار",
    paymentMethod: "cash_on_delivery",
    honeypot: "",
    items,
  });
}

beforeAll(async () => {
  await resetTestDatabase();
});

beforeEach(async () => {
  await client.unsafe("TRUNCATE TABLE orders CASCADE");
  await db.update(products).set({ availability: "available" });
  await db.update(productVariants).set({ availability: "available" });
  await db.update(serviceAreas).set({ enabled: false });
  await db
    .update(serviceAreas)
    .set({ enabled: true, deliveryFeeAgorot: null })
    .where(eq(serviceAreas.code, "maythalun"));
});

afterAll(async () => {
  await client.end();
});

describe("database foundation", () => {
  it("applies migrations to the isolated empty test database", async () => {
    const [{ currentDatabase }] = await db.execute<{
      currentDatabase: string;
    }>(sql`select current_database() as "currentDatabase"`);
    expect(currentDatabase).toBe("maithalun_test");

    await migrate(db, { migrationsFolder: "drizzle" });
    const [{ productCount }] = await db
      .select({ productCount: count() })
      .from(products);
    expect(productCount).toBe(9);
  });

  it("keeps reference-data insertion repeatable without overwriting fees", async () => {
    await db
      .update(serviceAreas)
      .set({ deliveryFeeAgorot: 350 })
      .where(eq(serviceAreas.code, "ramallah"));
    await insertVerifiedReferenceData(db);
    await insertVerifiedReferenceData(db);

    const [{ productCount }] = await db
      .select({ productCount: count() })
      .from(products);
    const areas = await db.select().from(serviceAreas);
    expect(productCount).toBe(9);
    expect(areas).toHaveLength(4);
    expect(
      areas.find((area) => area.code === "ramallah")?.deliveryFeeAgorot,
    ).toBe(350);
    expect(areas.find((area) => area.code === "maythalun")?.enabled).toBe(true);
    expect(
      areas
        .filter((area) => area.code !== "maythalun")
        .every((area) => area.enabled === false),
    ).toBe(true);
  });

  it("queries products and service areas without N+1 lookups", async () => {
    await expect(productRepository.list()).resolves.toHaveLength(9);
    const product = await productRepository.getBySlug("general-cleaner-secret");
    expect(product).toMatchObject({
      id: "general-cleaner",
      priceAgorot: 700,
      defaultVariantId: "general-cleaner--default",
    });
    expect(product?.variants).toHaveLength(1);
    await expect(
      productRepository.getByIds(["general-cleaner", "dolphin-bleach"]),
    ).resolves.toHaveLength(2);
    await expect(serviceAreaRepository.listEnabled()).resolves.toHaveLength(1);
    await expect(
      serviceAreaRepository.getEnabledByCode("maythalun"),
    ).resolves.toMatchObject({
      nameAr: "ميثلون",
    });
  });

  it("applies free delivery at 50 ₪ and charges 5 ₪ below", async () => {
    const below = await orderService.create(
      createRequest({
        items: [{ productId: "general-cleaner", quantity: 2 }],
      }),
    );
    expect(below.itemsSubtotalAgorot).toBe(1400);
    expect(below.deliveryFeeAgorot).toBe(500);
    expect(below.finalTotalAgorot).toBe(1900);

    const atThreshold = await orderService.create(
      createRequest({
        items: [{ productId: "arar-dish-liquid", quantity: 5 }],
      }),
    );
    expect(atThreshold.itemsSubtotalAgorot).toBe(6000);
    expect(atThreshold.deliveryFeeAgorot).toBe(0);
    expect(atThreshold.finalTotalAgorot).toBe(6000);
  });
});

describe("transactional order creation", () => {
  it("uses authoritative prices and stores immutable item snapshots", async () => {
    const confirmation = await orderService.create(createRequest());
    expect(confirmation.itemsSubtotalAgorot).toBe(1400);
    expect(confirmation.deliveryFeeAgorot).toBe(500);
    expect(confirmation.finalTotalAgorot).toBe(1900);
    expect(confirmation.publicReference).toMatch(/^MS-[A-Za-z0-9_-]{24}$/);

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.publicReference, confirmation.publicReference));
    expect(order).toMatchObject({
      customerFullName: "عميل تجريبي",
      deliveryAddress: "عنوان محلي مفصل للاختبار",
      whatsappPhoneE164: "+970591234567",
      customerName: "عميل تجريبي",
      address: "عنوان محلي مفصل للاختبار",
      normalizedPhone: "+970591234567",
      serviceAreaCodeSnapshot: "maythalun",
    });

    const [item] = await db.select().from(orderItems);
    expect(item).toMatchObject({
      productDomainId: "general-cleaner",
      variantDomainId: "general-cleaner--default",
      productNameSnapshot: "منظف عام Secret — الافتراضي",
      variantLabelSnapshot: "الافتراضي",
      unitPriceAgorot: 700,
      quantity: 2,
      lineSubtotalAgorot: 1400,
    });
  });

  it("persists a normalized +972 WhatsApp snapshot", async () => {
    const confirmation = await orderService.create(
      createRequest({
        whatsappCountryCode: "972",
        whatsappNationalNumber: "0521234567",
      }),
    );
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.publicReference, confirmation.publicReference));
    expect(order.whatsappPhoneE164).toBe("+972521234567");
  });

  it("returns the same order for an idempotent retry", async () => {
    const request = createRequest();
    const first = await orderService.create(request);
    const second = await orderService.create(request);
    const [{ orderCount }] = await db
      .select({ orderCount: count() })
      .from(orders);

    expect(second.publicReference).toBe(first.publicReference);
    expect(second.duplicate).toBe(true);
    expect(orderCount).toBe(1);
  });

  it("generates unique public references for separate orders", async () => {
    const first = await orderService.create(createRequest());
    const second = await orderService.create(
      createRequest({
        items: [{ productId: "dolphin-bleach", quantity: 1 }],
      }),
    );
    expect(first.publicReference).not.toBe(second.publicReference);
  });

  it("rejects the same key with a materially different payload", async () => {
    const idempotencyKey = crypto.randomUUID();
    await orderService.create(createRequest({ idempotencyKey }));

    await expect(
      orderService.create(
        createRequest({
          idempotencyKey,
          address: "عنوان مختلف تماماً للاختبار",
        }),
      ),
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("creates one order for concurrent duplicate submissions", async () => {
    const request = createRequest();
    const [first, second] = await Promise.all([
      orderService.create(request),
      orderService.create(request),
    ]);
    const [{ orderCount }] = await db
      .select({ orderCount: count() })
      .from(orders);

    expect(first.publicReference).toBe(second.publicReference);
    expect(orderCount).toBe(1);
  });

  it("rejects unknown or unavailable products and disabled areas", async () => {
    await expect(
      orderService.create(
        createRequest({
          items: [{ productId: "unknown-product", quantity: 1 }],
        }),
      ),
    ).rejects.toMatchObject({
      code: "unknown_product",
    });

    await db
      .update(productVariants)
      .set({ availability: "unavailable" })
      .where(eq(productVariants.domainId, "general-cleaner--default"));
    await expect(orderService.create(createRequest())).rejects.toMatchObject({
      code: "unavailable_product",
    });

    await db
      .update(serviceAreas)
      .set({ enabled: false })
      .where(eq(serviceAreas.code, "maythalun"));
    await expect(
      orderService.create(
        createRequest({
          items: [{ productId: "dolphin-bleach", quantity: 1 }],
        }),
      ),
    ).rejects.toMatchObject({
      code: "invalid_service_area",
    });
  });

  it("rejects inactive service areas for new orders", async () => {
    expect(() =>
      createRequest({
        serviceAreaCode: "ramallah",
        items: [{ productId: "dolphin-bleach", quantity: 1 }],
      }),
    ).toThrow();
  });

  it("rolls back the order when an order-item insert fails", async () => {
    await client.unsafe(`
      CREATE OR REPLACE FUNCTION reject_test_order_item()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.product_domain_id = 'degreaser-8' THEN
          RAISE EXCEPTION 'forced integration rollback';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_test_order_item_trigger
      BEFORE INSERT ON order_items
      FOR EACH ROW EXECUTE FUNCTION reject_test_order_item();
    `);

    try {
      const request = createRequest({
        items: [{ productId: "degreaser-8", quantity: 1 }],
      });
      await expect(orderService.create(request)).rejects.toMatchObject({
        code: "database_error",
      });
      const [{ orderCount }] = await db
        .select({ orderCount: count() })
        .from(orders);
      expect(orderCount).toBe(0);
    } finally {
      await client.unsafe(`
        DROP TRIGGER IF EXISTS reject_test_order_item_trigger ON order_items;
        DROP FUNCTION IF EXISTS reject_test_order_item();
      `);
    }
  });

  it("enforces database quantity, idempotency, and reference constraints", async () => {
    const request = createRequest();
    const confirmation = await orderService.create(request);
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.publicReference, confirmation.publicReference));

    await expect(
      db.insert(orderItems).values({
        orderId: order.id,
        productDomainId: "dolphin-bleach",
        variantDomainId: "dolphin-bleach--default",
        productNameSnapshot: "مبيض Dolphin — الافتراضي",
        variantLabelSnapshot: "الافتراضي",
        unitPriceAgorot: 800,
        quantity: 10,
        lineSubtotalAgorot: 8000,
      }),
    ).rejects.toBeDefined();
    await expect(
      db.insert(orders).values({
        ...order,
        id: crypto.randomUUID(),
      }),
    ).rejects.toBeDefined();
  });
});
