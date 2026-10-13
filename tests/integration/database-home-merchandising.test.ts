import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { rankBestSellers } from "@/features/catalog/infrastructure/best-sellers";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { OrderService } from "@/features/orders/application/order-service";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { checkoutRequest, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const catalog = new AdminCatalogService(db);
const orders = new OrderService(db);
const adminOrders = new AdminOrderService(db);
let owner: AdminActor;

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

async function editBrand(domainId: string, brand: string | undefined) {
  const product = (await catalog.getByDomainId(owner, domainId))!;
  await catalog.update(owner, {
    domainId,
    nameAr: product.nameAr,
    latinName: product.latinName,
    brand,
    priceAgorot: product.priceAgorot,
    categoryId: product.categoryId,
    availability: product.availability,
    sortOrder: product.sortOrder,
    description: product.description,
    usageNotes: product.usageNotes,
    unit: product.unit,
    detailsStatus: product.detailsStatus,
    placeholderVariant:
      product.image.kind === "placeholder"
        ? product.image.variant
        : "general-cleaner",
  });
}

describe("product brand", () => {
  it("is optional, saved by the owner and shown on the storefront product", async () => {
    await editBrand("dolphin-bleach", "Dolphin");
    const repository = new PostgresProductRepository(db);
    const product = (await repository.list()).find(
      (row) => row.id === "dolphin-bleach",
    );
    expect(product?.brand).toBe("Dolphin");
    // The display name is untouched: the brand is never appended to it.
    expect(product?.nameAr).toBe("مبيض");

    await editBrand("dolphin-bleach", undefined);
    const [row] = await db
      .select({ brand: schema.products.brand })
      .from(schema.products)
      .where(eq(schema.products.domainId, "dolphin-bleach"));
    expect(row?.brand).toBeNull();
  });
});

describe("best sellers", () => {
  it("ranks by orders that were not cancelled", async () => {
    await orders.create(
      checkoutRequest([{ productId: "arar-dish-liquid", quantity: 1 }]),
    );
    await orders.create(
      checkoutRequest([
        { productId: "arar-dish-liquid", quantity: 1 },
        { productId: "general-cleaner", quantity: 3 },
      ]),
    );
    const cancelled = await orders.create(
      checkoutRequest([
        { productId: "dolphin-bleach", quantity: 1 },
        { productId: "general-cleaner", quantity: 1 },
      ]),
    );
    const detail = await adminOrders.getByPublicReference(
      owner,
      cancelled.publicReference,
    );
    await adminOrders.changeStatus(owner, {
      publicReference: cancelled.publicReference,
      nextStatus: "cancelled",
      expectedVersion: detail!.version,
    });

    expect(await rankBestSellers(db, 10)).toEqual([
      "arar-dish-liquid",
      "general-cleaner",
    ]);
    // Older than the window: nothing counts.
    const later = new Date(Date.now() + 91 * 86_400_000);
    expect(await rankBestSellers(db, 10, later)).toEqual([]);
  });
});
