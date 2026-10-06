import { asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import {
  OfferService,
  type OfferInput,
} from "@/features/offers/application/offer-service";
import { OrderService } from "@/features/orders/application/order-service";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { checkoutRequest, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const authoring = new CatalogAuthoringService(db);
const offers = new OfferService(db);
const orders = new OrderService(db);

let owner: AdminActor;
let cleanerCategory: string;

function offer(overrides: Partial<OfferInput> = {}): OfferInput {
  return {
    nameAr: "عرض الاختبار",
    displayText: null,
    kind: "percentage",
    value: 10,
    minQuantity: 1,
    startsAt: null,
    endsAt: null,
    enabled: true,
    targets: {
      productIds: ["general-cleaner"],
      variantIds: [],
      categoryCodes: [],
    },
    ...overrides,
  };
}

async function productCategory(domainId: string) {
  const [row] = await db
    .select({ categoryId: schema.products.categoryId })
    .from(schema.products)
    .where(eq(schema.products.domainId, domainId));
  return row!.categoryId;
}

async function activeOrder() {
  return (
    await db
      .select({ code: schema.productCategories.code })
      .from(schema.productCategories)
      .where(isNull(schema.productCategories.archivedAt))
      .orderBy(
        asc(schema.productCategories.sortOrder),
        asc(schema.productCategories.code),
      )
  ).map((row) => row.code);
}

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  cleanerCategory = await productCategory("general-cleaner");
});

describe("category dependencies on offers", () => {
  it("refuses to merge a category an offer targets, naming the offer, and allows it once archived", async () => {
    const target = (await activeOrder()).find(
      (code) => code !== cleanerCategory,
    )!;
    const { id } = await offers.create(
      owner,
      offer({
        nameAr: "خصم القسم",
        targets: {
          productIds: [],
          variantIds: [],
          categoryCodes: [cleanerCategory],
        },
      }),
    );
    await expect(
      authoring.mergeCategories(owner, {
        sourceCode: cleanerCategory,
        targetCode: target,
      }),
    ).rejects.toMatchObject({
      code: "category_has_offers",
      detail: "خصم القسم",
    });
    // Nothing moved: the refusal happens before any product changes category.
    expect(await productCategory("general-cleaner")).toBe(cleanerCategory);

    await offers.setArchived(owner, id, true);
    await authoring.mergeCategories(owner, {
      sourceCode: cleanerCategory,
      targetCode: target,
    });
    expect(await productCategory("general-cleaner")).toBe(target);
  });

  it("refuses to delete an empty category an offer still names", async () => {
    await authoring.createCategory(owner, {
      code: "empty-shelf",
      nameAr: "رف فارغ",
      description: null,
      icon: "package",
      visible: true,
    });
    await offers.create(
      owner,
      offer({
        enabled: false,
        nameAr: "عرض الرف",
        targets: {
          productIds: ["general-cleaner"],
          variantIds: [],
          categoryCodes: ["empty-shelf"],
        },
      }),
    );
    await expect(
      authoring.deleteEmptyCategory(owner, "empty-shelf"),
    ).rejects.toMatchObject({
      code: "category_has_offers",
      detail: "عرض الرف",
    });
  });
});

describe("category order", () => {
  it("moves one step at a time, renumbers strictly and audits the move", async () => {
    const before = await activeOrder();
    await authoring.moveCategory(owner, before[1]!, "up");
    const after = await activeOrder();
    expect(after).toEqual([before[1], before[0], ...before.slice(2)]);
    const orders = await db
      .select({ sortOrder: schema.productCategories.sortOrder })
      .from(schema.productCategories)
      .where(isNull(schema.productCategories.archivedAt))
      .orderBy(asc(schema.productCategories.sortOrder));
    expect(orders.map((row) => row.sortOrder)).toEqual(
      after.map((_, index) => (index + 1) * 10),
    );
    // The first cannot move up; nothing changes.
    await authoring.moveCategory(owner, after[0]!, "up");
    expect(await activeOrder()).toEqual(after);
    const events = await db
      .select()
      .from(schema.adminAuditEvents)
      .where(eq(schema.adminAuditEvents.actionType, "category_reorder"));
    expect(events).toHaveLength(1);
  });
});

describe("offer conflicts", () => {
  it("refuses a second enabled offer pricing the same item in an overlapping window", async () => {
    await offers.create(owner, offer({ nameAr: "عرض المنتج" }));
    const viaCategory = offer({
      nameAr: "عرض القسم",
      targets: {
        productIds: [],
        variantIds: [],
        categoryCodes: [cleanerCategory],
      },
    });
    await expect(offers.create(owner, viaCategory)).rejects.toMatchObject({
      code: "conflict",
      detail: "عرض المنتج",
    });
    // Saved switched off it is allowed, and the clash is reported for when it is switched on.
    const draft = await offers.create(owner, {
      ...viaCategory,
      enabled: false,
    });
    const clashes = await offers.conflicts(viaCategory, draft.id);
    expect(clashes.map((clash) => clash.nameAr)).toEqual(["عرض المنتج"]);
  });

  it("allows the same item in windows that only touch", async () => {
    const day = (iso: string) => new Date(iso);
    await offers.create(
      owner,
      offer({
        startsAt: day("2026-11-01T00:00:00Z"),
        endsAt: day("2026-11-08T00:00:00Z"),
      }),
    );
    await expect(
      offers.create(
        owner,
        offer({
          nameAr: "الأسبوع التالي",
          startsAt: day("2026-11-08T00:00:00Z"),
          endsAt: day("2026-11-15T00:00:00Z"),
        }),
      ),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("rejects a save based on an outdated copy", async () => {
    const { id } = await offers.create(owner, offer({ enabled: false }));
    const loaded = (await offers.get(owner, id))!;
    await offers.update(
      owner,
      id,
      offer({ enabled: false, value: 15 }),
      loaded.updatedAt,
    );
    await expect(
      offers.update(
        owner,
        id,
        offer({ enabled: false, value: 20 }),
        loaded.updatedAt,
      ),
    ).rejects.toMatchObject({ code: "stale" });
    expect((await offers.get(owner, id))!.value).toBe(15);
  });

  it("keeps an offer that priced an order: delete is refused, archive works", async () => {
    const { id } = await offers.create(owner, offer());
    await orders.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    const [line] = await db
      .select({ offerId: schema.orderItems.offerId })
      .from(schema.orderItems);
    expect(line?.offerId).toBe(id);
    await expect(offers.deleteUnused(owner, id)).rejects.toMatchObject({
      code: "in_use",
    });
    await offers.setArchived(owner, id, true);
    expect((await offers.get(owner, id))!).toMatchObject({
      archived: true,
      enabled: false,
      usage: 1,
    });
  });
});
