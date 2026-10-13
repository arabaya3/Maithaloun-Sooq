import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { rankBestSellers } from "@/features/catalog/infrastructure/best-sellers";
import { listStorefrontCategories } from "@/features/catalog/infrastructure/category-queries";
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
const authoring = new CatalogAuthoringService(db);
let owner: AdminActor;

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

async function editProduct(
  domainId: string,
  changes: {
    brand?: string;
    nameEn?: string;
    descriptionEn?: string;
    usageNotesEn?: string;
  },
) {
  const product = (await catalog.getByDomainId(owner, domainId))!;
  await catalog.update(owner, {
    domainId,
    nameAr: product.nameAr,
    latinName: product.latinName,
    ...changes,
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
    await editProduct("dolphin-bleach", { brand: "Dolphin" });
    const repository = new PostgresProductRepository(db);
    const product = (await repository.list()).find(
      (row) => row.id === "dolphin-bleach",
    );
    expect(product?.brand).toBe("Dolphin");
    // The display name is untouched: the brand is never appended to it.
    expect(product?.nameAr).toBe("مبيض");

    await editProduct("dolphin-bleach", {});
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

describe("English content", () => {
  it("stores optional English texts for products and categories, kept apart from the Arabic", async () => {
    await editProduct("dolphin-bleach", {
      brand: "Dolphin",
      nameEn: "Dolphin Bleach",
      descriptionEn: "Multi-purpose bleach.",
      usageNotesEn: "Dilute before use.",
    });
    const product = (await new PostgresProductRepository(db).list()).find(
      (row) => row.id === "dolphin-bleach",
    )!;
    expect(product).toMatchObject({
      nameAr: "مبيض",
      nameEn: "Dolphin Bleach",
      descriptionEn: "Multi-purpose bleach.",
      usageNotesEn: "Dilute before use.",
    });

    await authoring.updateCategory(owner, "laundry", {
      nameEn: "  Laundry  ",
      descriptionEn: "Detergents and softeners.",
    });
    // A form without the English fields leaves them as they were.
    await authoring.updateCategory(owner, "laundry", { nameAr: "الغسيل" });
    const laundry = (await listStorefrontCategories(db)).find(
      (category) => category.code === "laundry",
    );
    expect(laundry).toMatchObject({
      nameAr: "الغسيل",
      nameEn: "Laundry",
      descriptionEn: "Detergents and softeners.",
    });
  });
});
