import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { publicQuote } from "@/features/commerce/public-quote";
import {
  CartPricingError,
  priceCart,
} from "@/features/orders/application/cart-pricing";
import { OrderService } from "@/features/orders/application/order-service";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import {
  inventoryItems,
  orders,
  productSellingUnits,
  productVariants,
  products,
  serviceAreas,
} from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { db, client } = testDatabaseConnection;

const item = (productId: string, quantity: number) => ({
  productId,
  variantId: `${productId}--default`,
  quantity,
});

beforeAll(async () => {
  await resetTestDatabase();
});

beforeEach(async () => {
  await client.unsafe("TRUNCATE TABLE orders CASCADE");
  await db.update(products).set({ availability: "available" });
  await db.update(productVariants).set({ availability: "available" });
  await db
    .update(serviceAreas)
    .set({ enabled: true, deliveryFeeAgorot: null })
    .where(eq(serviceAreas.code, "maythalun"));
});

afterAll(async () => {
  await client.end();
});

describe("shared cart pricing", () => {
  it("prices a cart with server prices and the delivery rule, and changes nothing", async () => {
    const [ordersBefore] = await db.select({ value: count() }).from(orders);
    const stockBefore = await db.select().from(inventoryItems);

    const small = await priceCart(db, [item("general-cleaner", 1)]);
    expect(small.itemsSubtotalAgorot).toBeLessThan(5000);
    expect(small.deliveryFeeAgorot).toBe(500);
    expect(small.finalTotalAgorot).toBe(small.itemsSubtotalAgorot + 500);

    const large = await priceCart(db, [
      item("general-cleaner", 5),
      item("arar-dish-liquid", 4),
    ]);
    expect(large.itemsSubtotalAgorot).toBeGreaterThanOrEqual(5000);
    expect(large.deliveryFeeAgorot).toBe(0);

    const quote = publicQuote(small, "ar");
    expect(quote.lines[0]).toMatchObject({
      productId: "general-cleaner",
      quantity: 1,
    });
    expect(quote.totalAgorot).toBe(small.finalTotalAgorot);

    const [ordersAfter] = await db.select({ value: count() }).from(orders);
    expect(ordersAfter!.value).toBe(ordersBefore!.value);
    expect(await db.select().from(inventoryItems)).toEqual(stockBefore);
  });

  it("rejects unknown or unavailable products with the same codes as checkout", async () => {
    await expect(
      priceCart(db, [
        { productId: "no-such", variantId: "no-such--default", quantity: 1 },
      ]),
    ).rejects.toMatchObject({ code: "unknown_product" });

    await db
      .update(productVariants)
      .set({ availability: "unavailable" })
      .where(eq(productVariants.domainId, "general-cleaner--default"));
    const failure = await priceCart(db, [item("general-cleaner", 1)]).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CartPricingError);
    expect((failure as CartPricingError).code).toBe("unavailable_product");
  });

  it("matches the totals of a real order created from the same cart", async () => {
    const cart = [item("general-cleaner", 2), item("arar-dish-liquid", 1)];
    const quote = await priceCart(db, cart);
    const order = await new OrderService(db).create(
      checkoutRequestSchema.parse({
        idempotencyKey: crypto.randomUUID(),
        customerName: "عميل تجريبي",
        whatsappCountryCode: "970",
        whatsappNationalNumber: "0591234567",
        serviceAreaCode: "maythalun",
        paymentMethod: "cash_on_delivery",
        honeypot: "",
        items: cart,
      }),
    );
    expect(order.finalTotalAgorot).toBe(quote.finalTotalAgorot);
    expect(order.deliveryFeeAgorot).toBe(quote.deliveryFeeAgorot);
  });

  it.each([
    [4999, 500],
    [5000, 0],
    [5001, 0],
  ])(
    "at the 50 ₪ boundary a %i agorot cart pays %i agorot delivery in the quote and the order",
    async (priceAgorot, deliveryFeeAgorot) => {
      const [variant] = await db
        .update(productVariants)
        .set({ priceAgorot })
        .where(eq(productVariants.domainId, "general-cleaner--default"))
        .returning({ id: productVariants.id });
      await db
        .update(productSellingUnits)
        .set({ priceAgorot })
        .where(eq(productSellingUnits.variantId, variant!.id));
      try {
        const cart = [item("general-cleaner", 1)];
        const quote = await priceCart(db, cart);
        expect(quote.itemsSubtotalAgorot).toBe(priceAgorot);
        expect(quote.deliveryFeeAgorot).toBe(deliveryFeeAgorot);
        expect(quote.finalTotalAgorot).toBe(priceAgorot + deliveryFeeAgorot);

        const order = await new OrderService(db).create(
          checkoutRequestSchema.parse({
            idempotencyKey: crypto.randomUUID(),
            customerName: "عميل تجريبي",
            whatsappCountryCode: "970",
            whatsappNationalNumber: "0591234567",
            serviceAreaCode: "maythalun",
            paymentMethod: "cash_on_delivery",
            honeypot: "",
            items: cart,
          }),
        );
        expect(order.itemsSubtotalAgorot).toBe(priceAgorot);
        expect(order.deliveryFeeAgorot).toBe(deliveryFeeAgorot);
        expect(order.finalTotalAgorot).toBe(priceAgorot + deliveryFeeAgorot);
      } finally {
        await resetTestDatabase();
      }
    },
  );
});
