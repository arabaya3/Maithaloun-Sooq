import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductOptionsService } from "@/features/admin/application/product-options-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { OrderService } from "@/features/orders/application/order-service";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const PRODUCT = "general-cleaner";
const authoring = new CatalogAuthoringService(db);
const options = new ProductOptionsService(db, authoring);
const storefront = new PostgresProductRepository(db);
const orders = new OrderService(db);

let owner: AdminActor;
let variantIds: string[];

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

function request(variantId: string) {
  return checkoutRequestSchema.parse({
    idempotencyKey: crypto.randomUUID(),
    customerName: "عميل تجريبي",
    whatsappCountryCode: "970",
    whatsappNationalNumber: "0591234567",
    serviceAreaCode: "maythalun",
    deliveryAddress: "عنوان محلي مفصل للاختبار",
    paymentMethod: "cash_on_delivery",
    honeypot: "",
    items: [{ productId: PRODUCT, variantId, quantity: 1 }],
  });
}

async function internalVariant(domainId: string) {
  return (
    await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.domainId, domainId))
  )[0]!;
}

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  ({ variantIds } = await options.applyOptionPlan(
    owner,
    PRODUCT,
    plan,
    crypto.randomUUID(),
  ));
});

describe("exact variant orders", () => {
  it("snapshots the variant's own picture and its option values on the order line", async () => {
    const rose1l = variantIds[2]!;
    const variant = await internalVariant(rose1l);
    await db.insert(schema.productImages).values({
      productId: variant.productId,
      variantId: variant.id,
      scope: "variant",
      src: "/images/test/rose-1l.webp",
      altAr: "الورد الأبيض 1 لتر",
      width: 800,
      height: 800,
      sortOrder: 0,
    });

    const confirmation = await orders.create(request(rose1l));
    const [line] = await db
      .select()
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(eq(schema.orders.publicReference, confirmation.publicReference));

    expect(line!.order_items.imageSnapshot).toEqual({
      src: "/images/test/rose-1l.webp",
      alt: "الورد الأبيض 1 لتر",
    });
    expect(line!.order_items.optionValuesSnapshot).toEqual([
      { option: "الرائحة", value: "الورد الأبيض" },
      { option: "الحجم", value: "1 لتر" },
    ]);
  });

  it("keeps the product available while any variant can be sold, and refuses the closed variant", async () => {
    const [defaultId, otherId, lastId] = variantIds as [string, string, string];
    await authoring.updateVariant(owner, defaultId, {
      availability: "unavailable",
    });
    expect((await storefront.getById(PRODUCT))!.availability).toBe("available");
    await expect(orders.create(request(defaultId))).rejects.toMatchObject({
      code: "unavailable_product",
    });

    for (const id of [otherId, lastId]) {
      await authoring.updateVariant(owner, id, { availability: "unavailable" });
    }
    expect((await storefront.getById(PRODUCT))!.availability).toBe(
      "unavailable",
    );
  });
});
