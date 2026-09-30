import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { PriceReviewService } from "@/features/inventory/application/price-review-service";
import {
  PurchaseService,
  type PurchaseInput,
} from "@/features/purchasing/application/purchase-service";
import { priceReviews, productVariants, products } from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  OPERATIONS_TABLES,
  createOperatorActor,
  createOwnerActor,
} from "./support";

const { db, client } = testDatabaseConnection;
const purchaseService = new PurchaseService(db);
const priceReviewService = new PriceReviewService(db);
const VARIANT = "general-cleaner--default";

let owner: AdminActor;
let operator: AdminActor;

function purchase(unitCostAgorot: number): PurchaseInput {
  return {
    idempotencyKey: crypto.randomUUID(),
    supplierName: "مورد الاختبار",
    reference: crypto.randomUUID().slice(0, 8),
    invoiceDate: "2026-09-01",
    source: "manual",
    lines: [
      {
        variantId: VARIANT,
        unit: "piece",
        quantityMilli: 10_000,
        packQuantity: 1,
        unitCostAgorot,
        lineDiscountAgorot: 0,
      },
    ],
    discountAgorot: 0,
    taxAgorot: null,
    printedTotalAgorot: null,
    paidAgorot: 0,
    acknowledgeDuplicate: false,
  };
}

async function variantPrice() {
  const [row] = await db
    .select({
      variant: productVariants.priceAgorot,
      product: products.priceAgorot,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.domainId, VARIANT));
  return row!;
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
  await db
    .update(productVariants)
    .set({ priceAgorot: 700 })
    .where(eq(productVariants.domainId, VARIANT));
  await db
    .update(products)
    .set({ priceAgorot: 700 })
    .where(eq(products.domainId, "general-cleaner"));
});

describe("purchase cost and sale price review", () => {
  it("queues a review when the cost rises and never changes the storefront price by itself", async () => {
    await purchaseService.post(owner, purchase(400));
    expect(await priceReviewService.listOpen(owner)).toHaveLength(0);

    await purchaseService.post(owner, purchase(650));
    const [review] = await priceReviewService.listOpen(owner);
    expect(review?.comparison).toEqual({
      previousCostAgorot: 400,
      newCostAgorot: 650,
      costChangeBasisPoints: 6_250,
      salePriceAgorot: 700,
      profitAgorot: 50,
      marginBasisPoints: 714,
      advice: "thin_margin",
    });
    expect(await variantPrice()).toEqual({ variant: 700, product: 700 });
  });

  it("flags a first purchase that would sell at a loss", async () => {
    await purchaseService.post(owner, purchase(900));
    const [review] = await priceReviewService.listOpen(owner);
    expect(review?.comparison).toMatchObject({
      previousCostAgorot: null,
      advice: "loss",
      profitAgorot: -200,
    });
  });

  it("keeps, defers or edits the price only on an explicit decision", async () => {
    await purchaseService.post(owner, purchase(400));
    await purchaseService.post(owner, purchase(650));
    const [review] = await priceReviewService.listOpen(owner);

    await priceReviewService.decide(owner, { id: review!.id, action: "later" });
    expect((await priceReviewService.listOpen(owner))[0]?.status).toBe("later");
    expect(await priceReviewService.countPending(owner)).toBe(0);
    expect(await variantPrice()).toEqual({ variant: 700, product: 700 });

    const { productSlug } = await priceReviewService.decide(owner, {
      id: review!.id,
      action: "change",
      newPriceAgorot: 950,
    });
    expect(productSlug).toBe("general-cleaner-secret");
    expect(await variantPrice()).toEqual({ variant: 950, product: 950 });
    expect(await priceReviewService.listOpen(owner)).toHaveLength(0);
    const [stored] = await db.select().from(priceReviews);
    expect(stored).toMatchObject({
      status: "price_changed",
      newSalePriceAgorot: 950,
      resolvedBy: owner.id,
    });

    await expect(
      priceReviewService.decide(owner, { id: review!.id, action: "keep" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("is owner-only", async () => {
    await expect(priceReviewService.listOpen(operator)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      priceReviewService.decide(operator, {
        id: crypto.randomUUID(),
        action: "keep",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
