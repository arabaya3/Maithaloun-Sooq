import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import {
  SellingUnitError,
  SellingUnitService,
} from "@/features/admin/application/selling-unit-service";
import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import {
  AssistantOperations,
  type PrepareResult,
} from "@/features/assistant/application/assistant-operations";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import type { OrderStatus } from "@/features/orders/domain/order-status";
import { OfferService } from "@/features/offers/application/offer-service";
import {
  OrderCreationError,
  OrderService,
} from "@/features/orders/application/order-service";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import { ExtractionService } from "@/features/purchasing/application/extraction-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { ReportService } from "@/features/reports/application/report-service";
import { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import {
  SalesError,
  SalesService,
} from "@/features/sales/application/sales-service";
import * as schema from "@/server/db/schema";
import type { PrivateDocumentStore } from "@/server/storage/private-documents";
import { todayInStoreZone } from "@/shared/lib/store-time";
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
const BLUE = "test-cloth--blue";
const GREEN = "test-cloth--green";

const sellingUnits = new SellingUnitService(db);
const orders = new OrderService(db);
const adminOrders = new AdminOrderService(db);
const inventory = new InventoryService(db);
const customers = new CustomerService(db);
const sales = new SalesService(db);
const purchases = new PurchaseService(db);
const offers = new OfferService(db);
const authoring = new CatalogAuthoringService(db);
const reports = new ReportService(db, customers, inventory);
const storefront = new PostgresProductRepository(db);
const store: PrivateDocumentStore = {
  put: async (path) => ({ provider: "local", bucket: "memory", path }),
  read: async () => Buffer.alloc(0),
  signedUrl: async () => null,
  remove: async () => undefined,
};
const conversations = new ConversationRepository(db);
const toolRuns = new ToolRunLog(db);
const operations = new AssistantOperations({
  database: db,
  catalog: new AdminCatalogService(db),
  authoring,
  maintenance: new ProductMaintenanceService(db),
  sellingUnits,
  inventory,
  sales,
  customers,
  customerMaintenance: new CustomerMaintenanceService(db),
  suppliers: new SupplierService(db),
  supplierMaintenance: new SupplierMaintenanceService(db),
  offers,
  orders: adminOrders,
  extraction: new ExtractionService(db, purchases, () => store),
  attachments: new AttachmentService(db, () => store),
  productImages: () => ({
    put: async () => ({
      src: "https://example.com/x.webp",
      width: 1,
      height: 1,
    }),
  }),
  invoiceExtractor: () => {
    throw new Error("not used");
  },
});
const confirmations = new ConfirmationService(
  db,
  operations,
  conversations,
  toolRuns,
);

let owner: AdminActor;
let operator: AdminActor;
let conversationId: string;

async function unitsOf(variantDomainId: string) {
  return db
    .select({ unit: schema.productSellingUnits })
    .from(schema.productSellingUnits)
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.id, schema.productSellingUnits.variantId),
    )
    .where(eq(schema.productVariants.domainId, variantDomainId))
    .orderBy(schema.productSellingUnits.unitsPerSale)
    .then((rows) => rows.map((row) => row.unit));
}

async function single(variantDomainId = BLUE) {
  return (await unitsOf(variantDomainId)).find(
    (unit) => unit.unitsPerSale === 1 && !unit.archivedAt,
  )!;
}

async function addPack(variantDomainId = BLUE, priceAgorot = 1000) {
  const { id } = await sellingUnits.create(owner, variantDomainId, {
    labelAr: "باكيج 3 حبات",
    unitsPerSale: 3,
    priceAgorot,
  });
  return (await unitsOf(variantDomainId)).find((unit) => unit.id === id)!;
}

async function stock(pieces: number, variantId = BLUE, costAgorot = 200) {
  await inventory.adjust(owner, {
    idempotencyKey: crypto.randomUUID(),
    variantId,
    reason: "opening_balance",
    quantityMilli: pieces * 1_000,
    unitCostAgorot: costAgorot,
  });
}

async function item(variantDomainId = BLUE) {
  const [row] = await db
    .select({ item: schema.inventoryItems })
    .from(schema.inventoryItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.id, schema.inventoryItems.variantId),
    )
    .where(eq(schema.productVariants.domainId, variantDomainId));
  return row!.item;
}

function request(
  lines: Array<{
    variantId?: string;
    sellingUnitId?: string;
    unitsPerSale?: number;
    quantity: number;
  }>,
  idempotencyKey: string = crypto.randomUUID(),
) {
  return checkoutRequestSchema.parse({
    idempotencyKey,
    customerName: "عميل تجريبي",
    whatsappCountryCode: "970",
    whatsappNationalNumber: "0591234567",
    serviceAreaCode: "maythalun",
    deliveryAddress: "عنوان محلي مفصل للاختبار",
    paymentMethod: "cash_on_delivery",
    honeypot: "",
    items: lines.map((line) => ({
      productId: "test-cloth",
      variantId: line.variantId ?? BLUE,
      sellingUnitId: line.sellingUnitId,
      unitsPerSale: line.unitsPerSale,
      quantity: line.quantity,
    })),
  });
}

async function advance(publicReference: string, ...statuses: OrderStatus[]) {
  for (const nextStatus of statuses) {
    const detail = await adminOrders.getByPublicReference(
      owner,
      publicReference,
    );
    await adminOrders.changeStatus(owner, {
      publicReference,
      nextStatus,
      expectedVersion: detail!.version,
    });
  }
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (
      error instanceof SellingUnitError ||
      error instanceof OrderCreationError ||
      error instanceof SalesError
    ) {
      return error.code;
    }
    if (error && typeof error === "object" && "code" in error) {
      return String((error as { code: unknown }).code);
    }
    throw error;
  }
}

async function businessState() {
  const tables = [
    "product_selling_units",
    "product_variants",
    "products",
    "orders",
    "order_items",
    "stock_reservations",
    "stock_movements",
    "inventory_items",
    "customer_invoices",
    "customer_invoice_lines",
  ];
  const result: Record<string, string> = {};
  for (const table of tables) {
    const [row] = await client.unsafe(
      `select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as hash from "${table}" t`,
    );
    result[table] = String(row?.hash);
  }
  return result;
}

async function ready(result: PrepareResult) {
  if (result.status !== "ready") {
    throw new Error(`not ready: ${JSON.stringify(result)}`);
  }
  const created = await confirmations.create(owner, conversationId, result);
  return created!.confirmationId;
}

async function confirmCard(id: string, actor = owner, token?: string) {
  const view = await confirmations.view(owner, id);
  return confirmations.confirm(actor, {
    id,
    operation: view!.operation,
    token: token ?? view!.token ?? "missing",
    acknowledged: true,
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(
    `TRUNCATE TABLE ${[...OPERATIONS_TABLES, "offer_targets", "offers"].join(", ")} CASCADE`,
  );
  await client.unsafe("DELETE FROM products WHERE domain_id = 'test-cloth'");
  const [product] = await db
    .insert(schema.products)
    .values({
      domainId: "test-cloth",
      slug: "test-cloth",
      nameAr: "ممسحة تنظيف",
      priceAgorot: 400,
      sortOrder: 90,
      categoryId: "tools",
      availability: "available",
      imageKind: "placeholder",
      placeholderVariant: "brush",
      detailsStatus: "placeholder",
    })
    .returning();
  // The variant trigger gives each variant its one-piece unit at the variant price.
  await db.insert(schema.productVariants).values(
    [
      { domainId: BLUE, labelAr: "أزرق", priceAgorot: 400, isDefault: true },
      { domainId: GREEN, labelAr: "أخضر", priceAgorot: 450, isDefault: false },
    ].map((variant, sortOrder) => ({
      ...variant,
      productId: product!.id,
      attributes: { اللون: variant.labelAr },
      availability: "available" as const,
      imageKind: "placeholder" as const,
      placeholderVariant: "brush" as const,
      sortOrder,
    })),
  );
  conversationId = await conversations.ensure(owner, null);
});

afterAll(async () => {
  await client.end();
});

describe("selling unit rules", () => {
  it("starts every variant with a default one-piece unit at the variant price", async () => {
    expect(
      (await unitsOf(BLUE)).map((unit) => ({
        labelAr: unit.labelAr,
        unitsPerSale: unit.unitsPerSale,
        priceAgorot: unit.priceAgorot,
        isDefault: unit.isDefault,
        mirrorsVariant: unit.mirrorsVariant,
      })),
    ).toEqual([
      {
        labelAr: "حبة واحدة",
        unitsPerSale: 1,
        priceAgorot: 400,
        isDefault: true,
        mirrorsVariant: true,
      },
    ]);
  });

  it("enforces positive whole multipliers, positive prices and one default in the database", async () => {
    const base = await single();
    const insert = (values: Record<string, unknown>) =>
      client.unsafe(
        `INSERT INTO product_selling_units (product_id, variant_id, label_ar, units_per_sale, price_agorot, is_default)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          base.productId,
          base.variantId,
          values.label ?? "اختبار",
          values.units ?? 2,
          values.price ?? 500,
          values.isDefault ?? false,
        ] as never[],
      );
    await expect(insert({ units: 0 })).rejects.toThrow(
      /product_selling_units_units_per_sale/,
    );
    await expect(insert({ units: -3 })).rejects.toThrow(
      /product_selling_units_units_per_sale/,
    );
    await expect(insert({ price: 0 })).rejects.toThrow(
      /product_selling_units_positive_price/,
    );
    await expect(insert({ isDefault: true })).rejects.toThrow(
      /product_selling_units_one_default_uidx/,
    );
    await expect(insert({ units: 1 })).rejects.toThrow(
      /product_selling_units_active_units_uidx/,
    );
  });

  it("validates through the service with specific errors", async () => {
    const create = (input: Record<string, unknown>) =>
      errorCode(
        sellingUnits.create(owner, BLUE, {
          labelAr: "باكيج",
          unitsPerSale: 3,
          priceAgorot: 1000,
          ...input,
        }),
      );
    expect(await create({ unitsPerSale: 0 })).toBe("invalid_units");
    expect(await create({ unitsPerSale: 2.5 })).toBe("invalid_units");
    expect(await create({ priceAgorot: 0 })).toBe("invalid_price");
    expect(await create({ labelAr: "  " })).toBe("invalid_label");
    expect(await create({ unitsPerSale: 1 })).toBe("duplicate_units");
    expect(await create({ labelAr: "حبة واحدة" })).toBe("duplicate_label");
    await expect(
      sellingUnits.create(operator, BLUE, {
        labelAr: "باكيج",
        unitsPerSale: 3,
        priceAgorot: 1000,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("keeps SKUs and barcodes unique across variants and selling units", async () => {
    await sellingUnits.create(owner, BLUE, {
      labelAr: "باكيج 3 حبات",
      unitsPerSale: 3,
      priceAgorot: 1000,
      sku: "CLOTH-3",
      barcode: "7290000000003",
    });
    expect(
      await errorCode(
        sellingUnits.create(owner, GREEN, {
          labelAr: "باكيج 3 حبات",
          unitsPerSale: 3,
          priceAgorot: 1100,
          sku: "cloth-3",
        }),
      ),
    ).toBe("duplicate_sku");
    expect(
      await errorCode(
        sellingUnits.create(owner, GREEN, {
          labelAr: "باكيج 3 حبات",
          unitsPerSale: 3,
          priceAgorot: 1100,
          barcode: "7290000000003",
        }),
      ),
    ).toBe("duplicate_barcode");
    expect(
      await authoring.identifierClash({ sku: "CLOTH-3", barcode: null }),
    ).toBe("duplicate_sku");
  });

  it("rejects a stale edit and moves the default without leaving two", async () => {
    const pack = await addPack();
    await sellingUnits.setDefault(owner, pack.id, pack.version);
    expect(
      await errorCode(sellingUnits.setDefault(owner, pack.id, pack.version)),
    ).toBe("stale");
    const units = await unitsOf(BLUE);
    expect(
      units.filter((unit) => unit.isDefault).map((unit) => unit.id),
    ).toEqual([pack.id]);
    const base = units.find((unit) => unit.unitsPerSale === 1)!;
    expect(
      await errorCode(
        sellingUnits.setArchived(owner, pack.id, pack.version + 1, true),
      ),
    ).toBe("default_archived");
    await sellingUnits.setArchived(owner, base.id, base.version, true);
    const fresh = (await unitsOf(BLUE)).find((unit) => unit.id === pack.id)!;
    expect(
      await errorCode(
        sellingUnits.setArchived(owner, fresh.id, fresh.version, true),
      ),
    ).toBe("default_archived");
  });

  it("keeps the base unit price and the variant price in step", async () => {
    await authoring.updateVariant(owner, BLUE, { priceAgorot: 450 });
    expect((await single()).priceAgorot).toBe(450);
    const base = await single();
    await sellingUnits.update(owner, base.id, base.version, {
      labelAr: "حبة",
      unitsPerSale: 1,
      priceAgorot: 500,
    });
    const [variant] = await db
      .select({ price: schema.productVariants.priceAgorot })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.domainId, BLUE));
    const [product] = await db
      .select({ price: schema.products.priceAgorot })
      .from(schema.products)
      .where(eq(schema.products.domainId, "test-cloth"));
    expect(variant!.price).toBe(500);
    expect(product!.price).toBe(500);
    const after = await single();
    expect(after).toMatchObject({ labelAr: "حبة", priceAgorot: 500 });
    expect(
      await errorCode(
        sellingUnits.update(owner, after.id, after.version, {
          labelAr: "حبة",
          unitsPerSale: 2,
          priceAgorot: 500,
        }),
      ),
    ).toBe("invalid_units");
  });

  it("blocks publishing a variant that has no active selling unit", async () => {
    await client.unsafe(`
      DELETE FROM product_selling_units WHERE variant_id =
        (SELECT id FROM product_variants WHERE domain_id = '${GREEN}')`);
    const check = await authoring.publicationCheck("test-cloth");
    expect(check?.ready).toBe(false);
    expect(check?.problems).toContain(
      "«أخضر»: لا يمكن نشر الصنف دون طريقة بيع واحدة على الأقل.",
    );
    await client.unsafe(
      "UPDATE products SET publication = 'hidden' WHERE domain_id = 'test-cloth'",
    );
    expect(
      await errorCode(
        authoring.setPublication(owner, {
          domainId: "test-cloth",
          publication: "published",
          acceptPlaceholder: true,
        }),
      ),
    ).toBe("not_publishable");
    expect(
      (await sellingUnits.variantsWithoutUnits()).map((row) => row.variantId),
    ).toEqual([GREEN]);
  });
});

describe("storefront orders", () => {
  it("shows pack availability from base stock and checks it again at checkout", async () => {
    const pack = await addPack();
    await stock(2);
    const product = await storefront.getById("test-cloth");
    const blue = product!.variants.find((variant) => variant.id === BLUE)!;
    expect(
      blue.sellingUnits.map((unit) => [unit.labelAr, unit.maxQuantity]),
    ).toEqual([
      ["حبة واحدة", 2],
      ["باكيج 3 حبات", 0],
    ]);
    const base = await single();
    expect(
      await errorCode(
        orders.create(request([{ sellingUnitId: pack.id, quantity: 1 }])),
      ),
    ).toBe("insufficient_stock");
    expect(
      await errorCode(
        orders.create(request([{ sellingUnitId: base.id, quantity: 3 }])),
      ),
    ).toBe("insufficient_stock");
    expect(
      await errorCode(
        orders.create(request([{ sellingUnitId: base.id, quantity: 2 }])),
      ),
    ).toBe("ok");
  });

  it("checks singles and packs of one variant against the same base stock", async () => {
    const pack = await addPack();
    const base = await single();
    await stock(4);
    expect(
      await errorCode(
        orders.create(
          request([
            { sellingUnitId: pack.id, quantity: 1 },
            { sellingUnitId: base.id, quantity: 2 },
          ]),
        ),
      ),
    ).toBe("insufficient_stock");
    expect(
      await errorCode(
        orders.create(
          request([
            { sellingUnitId: pack.id, quantity: 1 },
            { sellingUnitId: base.id, quantity: 1 },
          ]),
        ),
      ),
    ).toBe("ok");
  });

  it("prices two 3-packs on the server and reserves, releases and delivers six pieces", async () => {
    const pack = await addPack();
    await stock(10, BLUE, 200);

    const cancelled = await orders.create(
      request([{ sellingUnitId: pack.id, unitsPerSale: 3, quantity: 2 }]),
    );
    expect(cancelled.itemsSubtotalAgorot).toBe(2_000);
    const [line] = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.sellingUnitId, pack.id));
    expect(line).toMatchObject({
      quantity: 2,
      unitsPerSale: 3,
      baseUnits: 6,
      unitPriceAgorot: 1_000,
      listUnitPriceAgorot: 1_000,
      lineSubtotalAgorot: 2_000,
      sellingUnitLabelSnapshot: "باكيج 3 حبات",
      variantDomainId: BLUE,
    });

    await advance(cancelled.publicReference, "confirmed");
    expect(await item()).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 6_000,
    });
    await advance(cancelled.publicReference, "cancelled");
    expect(await item()).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 0,
    });

    const delivered = await orders.create(
      request([{ sellingUnitId: pack.id, quantity: 2 }]),
    );
    await advance(
      delivered.publicReference,
      "confirmed",
      "preparing",
      "out_for_delivery",
      "delivered",
    );
    expect(await item()).toMatchObject({
      onHandMilli: 4_000,
      reservedMilli: 0,
      stockValueAgorot: 800,
      lastSalePriceAgorot: 333,
    });
    const movements = await db
      .select({
        reason: schema.stockMovements.reason,
        qty: schema.stockMovements.qtyDeltaMilli,
        reserved: schema.stockMovements.reservedDeltaMilli,
        value: schema.stockMovements.valueDeltaAgorot,
      })
      .from(schema.stockMovements)
      .where(sql`${schema.stockMovements.orderId} is not null`)
      .orderBy(schema.stockMovements.createdAt);
    expect(movements).toEqual([
      { reason: "order_reservation", qty: 0, reserved: 6_000, value: 0 },
      { reason: "reservation_release", qty: 0, reserved: -6_000, value: 0 },
      { reason: "order_reservation", qty: 0, reserved: 6_000, value: 0 },
      {
        reason: "order_fulfillment",
        qty: -6_000,
        reserved: -6_000,
        value: -1_200,
      },
    ]);

    const today = todayInStoreZone();
    const report = await reports.getReport(owner, { from: today, to: today });
    expect(report.metrics).toMatchObject({
      unitsSoldMilli: 6_000,
      packsSold: 2,
      netSalesAgorot: 2_000,
      cogsAgorot: 1_200,
      grossProfitAgorot: 800,
    });
    expect(report.bySellingUnit[0]).toMatchObject({
      sellingUnitLabel: "باكيج 3 حبات",
      saleQuantityMilli: 2_000,
      quantityMilli: 6_000,
      cogsAgorot: 1_200,
      profitAgorot: 800,
    });
  });

  it("replays an idempotent order without a second order or reservation", async () => {
    const pack = await addPack();
    await stock(10);
    const key = crypto.randomUUID();
    const first = await orders.create(
      request([{ sellingUnitId: pack.id, quantity: 2 }], key),
    );
    const second = await orders.create(
      request([{ sellingUnitId: pack.id, quantity: 2 }], key),
    );
    expect(second).toMatchObject({
      publicReference: first.publicReference,
      duplicate: true,
    });
    expect(
      await errorCode(
        orders.create(request([{ sellingUnitId: pack.id, quantity: 1 }], key)),
      ),
    ).toBe("idempotency_conflict");
    await advance(first.publicReference, "confirmed");
    expect(await db.select().from(schema.orders)).toHaveLength(1);
    expect(await db.select().from(schema.stockReservations)).toHaveLength(1);
    expect((await item()).reservedMilli).toBe(6_000);
  });

  it("never reserves more pieces than exist when confirmations race", async () => {
    const pack = await addPack();
    await stock(10);
    const placed = await Promise.all(
      [1, 2, 3].map(() =>
        orders.create(request([{ sellingUnitId: pack.id, quantity: 2 }])),
      ),
    );
    const outcomes = await Promise.allSettled(
      placed.map((order) =>
        adminOrders.changeStatus(owner, {
          publicReference: order.publicReference,
          nextStatus: "confirmed",
          expectedVersion: 1,
        }),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes
        .filter((outcome) => outcome.status === "rejected")
        .map((outcome) => (outcome as PromiseRejectedResult).reason.code),
    ).toEqual(["insufficient_stock", "insufficient_stock"]);
    expect(await item()).toMatchObject({
      onHandMilli: 10_000,
      reservedMilli: 6_000,
    });
  });

  it("refuses archived or changed units and keeps history readable and unchanged", async () => {
    const pack = await addPack();
    await stock(10);
    const placed = await orders.create(
      request([{ sellingUnitId: pack.id, unitsPerSale: 3, quantity: 2 }]),
    );
    expect(
      await errorCode(
        orders.create(
          request([{ sellingUnitId: pack.id, unitsPerSale: 2, quantity: 1 }]),
        ),
      ),
    ).toBe("selling_unit_changed");

    await sellingUnits.update(owner, pack.id, pack.version, {
      labelAr: "باكيج كبير",
      unitsPerSale: 4,
      priceAgorot: 1_300,
    });
    const renamed = (await unitsOf(BLUE)).find((unit) => unit.id === pack.id)!;
    await sellingUnits.setArchived(owner, pack.id, renamed.version, true);
    expect(
      await errorCode(
        orders.create(request([{ sellingUnitId: pack.id, quantity: 1 }])),
      ),
    ).toBe("selling_unit_changed");

    const detail = await adminOrders.getByPublicReference(
      owner,
      placed.publicReference,
    );
    expect(detail!.items).toEqual([
      expect.objectContaining({
        sellingUnitLabel: "باكيج 3 حبات",
        unitsPerSale: 3,
        quantity: 2,
        baseUnits: 6,
        unitPriceAgorot: 1_000,
        lineSubtotalAgorot: 2_000,
      }),
    ]);
    await expect(
      client.unsafe(
        `UPDATE order_items SET selling_unit_label_snapshot = 'تغيير' WHERE selling_unit_id = '${pack.id}'`,
      ),
    ).rejects.toThrow(/snapshots are immutable/);

    const archived = (await unitsOf(BLUE)).find((unit) => unit.id === pack.id)!;
    expect(
      await errorCode(sellingUnits.delete(owner, pack.id, archived.version)),
    ).toBe("in_use");

    const unused = await sellingUnits.create(owner, BLUE, {
      labelAr: "كرتونة",
      unitsPerSale: 12,
      priceAgorot: 3_600,
    });
    const created = (await unitsOf(BLUE)).find(
      (unit) => unit.id === unused.id,
    )!;
    await sellingUnits.delete(owner, created.id, created.version);
    expect((await unitsOf(BLUE)).some((unit) => unit.id === unused.id)).toBe(
      false,
    );
  });

  it("applies variant offers to singles and leaves packs at their own price", async () => {
    const pack = await addPack();
    await offers.create(owner, {
      nameAr: "خصم الممسحة",
      displayText: null,
      kind: "percentage",
      value: 10,
      minQuantity: 1,
      startsAt: null,
      endsAt: null,
      enabled: true,
      targets: { productIds: [], variantIds: [BLUE], categoryCodes: [] },
    });
    const base = await single();
    const order = await orders.create(
      request([
        { sellingUnitId: base.id, quantity: 1 },
        { sellingUnitId: pack.id, quantity: 1 },
      ]),
    );
    expect(order.itemsSubtotalAgorot).toBe(360 + 1_000);
    const lines = await db
      .select({
        units: schema.orderItems.unitsPerSale,
        price: schema.orderItems.unitPriceAgorot,
        list: schema.orderItems.listUnitPriceAgorot,
        offer: schema.orderItems.offerId,
      })
      .from(schema.orderItems)
      .orderBy(schema.orderItems.unitsPerSale);
    expect(lines).toEqual([
      { units: 1, price: 360, list: 400, offer: expect.any(String) },
      { units: 3, price: 1_000, list: 1_000, offer: null },
    ]);
  });
});

describe("manual sales, purchases and returns", () => {
  it("sells packs from base stock at base-unit cost and restores them on cancellation", async () => {
    const pack = await addPack();
    await stock(10, BLUE, 200);
    const input = {
      idempotencyKey: crypto.randomUUID(),
      source: "manual" as const,
      lines: [
        {
          variantId: BLUE,
          sellingUnitId: pack.id,
          quantityMilli: 2_000,
          unitPriceAgorot: 1_000,
        },
      ],
      discountAgorot: 0,
      paidAgorot: 2_000,
    };
    const preview = await sales.preview(owner, input);
    expect(preview.lines[0]).toMatchObject({
      sellingUnitLabel: "باكيج 3 حبات",
      saleQuantityMilli: 2_000,
      quantityMilli: 6_000,
      lineTotalAgorot: 2_000,
      availableBeforeMilli: 10_000,
      availableAfterMilli: 4_000,
    });
    expect(preview.profit).toMatchObject({
      revenueAgorot: 2_000,
      cogsAgorot: 1_200,
      grossProfitAgorot: 800,
    });
    expect(preview.totals.totalAgorot).toBe(2_000);

    const posted = await sales.post(owner, input);
    const [line] = await db
      .select()
      .from(schema.customerInvoiceLines)
      .where(eq(schema.customerInvoiceLines.invoiceId, posted.invoiceId));
    expect(line).toMatchObject({
      sellingUnitId: pack.id,
      sellingUnitLabelSnapshot: "باكيج 3 حبات",
      unitsPerSale: 3,
      packQuantity: 2,
      quantityMilli: 6_000,
      unitPriceAgorot: 1_000,
      lineTotalAgorot: 2_000,
      unitCostAgorot: 200,
      cogsAgorot: 1_200,
    });
    expect(await item()).toMatchObject({
      onHandMilli: 4_000,
      stockValueAgorot: 800,
    });
    expect((await sales.post(owner, input)).replayed).toBe(true);
    expect(await item()).toMatchObject({ onHandMilli: 4_000 });

    await sales.cancelInvoice(owner, {
      invoiceId: posted.invoiceId,
      reason: "مرتجع كامل",
    });
    expect(await item()).toMatchObject({
      onHandMilli: 10_000,
      stockValueAgorot: 2_000,
    });
  });

  it("refuses a selling unit from another variant or beyond stock", async () => {
    const pack = await addPack();
    await stock(2);
    const sale = (variantId: string, quantityMilli: number) =>
      sales.post(owner, {
        idempotencyKey: crypto.randomUUID(),
        source: "manual",
        lines: [
          {
            variantId,
            sellingUnitId: pack.id,
            quantityMilli,
            unitPriceAgorot: 1_000,
          },
        ],
        discountAgorot: 0,
        paidAgorot: quantityMilli,
      });
    expect(await errorCode(sale(GREEN, 1_000))).toBe("selling_unit_not_found");
    expect(await errorCode(sale(BLUE, 1_000))).toBe("insufficient_stock");
    expect(await errorCode(sale(BLUE, 1_500))).toBe("invalid_input");
  });

  it("converts purchased packs into base pieces with an exact cost per piece", async () => {
    const input = {
      idempotencyKey: crypto.randomUUID(),
      supplierName: "مورد الممسحات",
      invoiceDate: todayInStoreZone(),
      source: "manual" as const,
      lines: [
        {
          variantId: BLUE,
          unit: "pack" as const,
          quantityMilli: 4_000,
          packQuantity: 3,
          unitCostAgorot: 600,
          lineDiscountAgorot: 0,
        },
      ],
      discountAgorot: 0,
      taxAgorot: null,
      printedTotalAgorot: null,
      paidAgorot: 0,
      acknowledgeDuplicate: false,
    };
    const preview = await purchases.preview(owner, input);
    expect(preview.lines[0]).toMatchObject({
      purchasedQuantityMilli: 4_000,
      packQuantity: 3,
      stockQuantityMilli: 12_000,
      costAgorot: 2_400,
      stockUnitCostAgorot: 200,
    });
    await purchases.post(owner, input);
    expect(await item()).toMatchObject({
      onHandMilli: 12_000,
      stockValueAgorot: 2_400,
      avgCostAgorot: 200,
    });
  });
});

describe("assistant selling unit cards", () => {
  it("prepares one card for «حبة بأربعة وباكيج ثلاث حبات بعشرة» and changes nothing until confirmed", async () => {
    await stock(10);
    const before = await businessState();
    const prepared = await operations.sellingUnitOps.prepareCreate(owner, {
      product: "ممسحة تنظيف",
      variant: "أزرق",
      options: [
        { label: "حبة واحدة", unitsPerSale: 1, priceIls: "4" },
        { label: "باكيج 3 حبات", unitsPerSale: 3, priceIls: "عشرة" },
      ],
    });
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;
    expect(prepared.card.target.label).toBe("ممسحة تنظيف — أزرق");
    expect(prepared.card.rows.map((row) => row.label)).toEqual([
      "طرق البيع الحالية",
      "موجودة: حبة واحدة",
      "جديد: باكيج 3 حبات",
    ]);
    expect(prepared.card.rows[2]!.after).toContain("10 ₪ — يخصم 3 حبات");
    expect(prepared.card.rows[2]!.after).toContain("3.33 ₪ للحبة");
    expect(prepared.card.impact.join(" ")).toContain(
      "المتاح حالياً: 10 حبات = 3 × «باكيج 3 حبات»، وتبقى حبة واحدة.",
    );
    expect(await businessState()).toEqual(before);

    const id = await ready(prepared);
    expect(await businessState()).toEqual(before);
    const [first, second] = await Promise.all([
      confirmCard(id),
      confirmCard(id),
    ]);
    expect([first.ok, second.ok].filter(Boolean).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(await confirmCard(id)).toMatchObject({
      ok: true,
      status: "completed",
    });
    expect(
      (await unitsOf(BLUE)).map((unit) => [
        unit.labelAr,
        unit.unitsPerSale,
        unit.priceAgorot,
      ]),
    ).toEqual([
      ["حبة واحدة", 1, 400],
      ["باكيج 3 حبات", 3, 1_000],
    ]);
  });

  it("never makes a card for an unstated size, a negative price or conflicting prices", async () => {
    const prepare = (
      options: Array<{ label: string; unitsPerSale: number; priceIls: string }>,
    ) =>
      operations.sellingUnitOps.prepareCreate(owner, {
        product: "ممسحة تنظيف",
        variant: "أزرق",
        options,
      });
    expect(
      await prepare([{ label: "باكيج", unitsPerSale: 3, priceIls: "10" }]),
    ).toMatchObject({ status: "rejected", code: "units_unstated" });
    expect(
      await prepare([
        { label: "باكيج 3 حبات", unitsPerSale: 3, priceIls: "سالب 10" },
      ]),
    ).toMatchObject({ status: "rejected" });
    expect(
      await prepare([
        { label: "باكيج 3 حبات", unitsPerSale: 3, priceIls: "-10" },
      ]),
    ).toMatchObject({ status: "rejected" });
    expect(
      await prepare([
        { label: "باكيج 3 حبات", unitsPerSale: 3, priceIls: "0" },
      ]),
    ).toMatchObject({ status: "rejected" });
    expect(
      await prepare([
        { label: "باكيج 3 حبات", unitsPerSale: 3, priceIls: "10" },
        { label: "باكيج ثلاث حبات", unitsPerSale: 3, priceIls: "12" },
      ]),
    ).toMatchObject({ status: "rejected", code: "duplicate_units" });
    expect(
      await db.select().from(schema.adminAssistantConfirmations),
    ).toHaveLength(0);
    expect((await unitsOf(BLUE)).map((unit) => unit.unitsPerSale)).toEqual([1]);
  });

  it("asks which variant when the product has several, and rejects a conflicting price", async () => {
    const ambiguous = await operations.sellingUnitOps.prepareCreate(owner, {
      product: "ممسحة تنظيف",
      options: [{ label: "باكيج 3 حبات", unitsPerSale: 3, priceIls: "10" }],
    });
    expect(ambiguous).toMatchObject({
      status: "needs_selection",
      field: "variant",
      options: [
        { id: BLUE, label: "أزرق" },
        { id: GREEN, label: "أخضر" },
      ],
    });
    const conflicting = await operations.sellingUnitOps.prepareCreate(owner, {
      product: "ممسحة تنظيف",
      variant: "أزرق",
      options: [{ label: "حبة", unitsPerSale: 1, priceIls: "5" }],
    });
    expect(conflicting).toMatchObject({
      status: "rejected",
      code: "duplicate_units",
    });
  });

  it("rejects stale, forged, foreign and expired cards without changing anything", async () => {
    const prepare = () =>
      operations.sellingUnitOps.prepareCreate(owner, {
        product: "ممسحة تنظيف",
        variant: "أزرق",
        options: [{ label: "باكيج 3 حبات", unitsPerSale: 3, priceIls: "10" }],
      });

    const stale = await ready(await prepare());
    await sellingUnits.create(owner, BLUE, {
      labelAr: "كرتونة",
      unitsPerSale: 12,
      priceAgorot: 3_600,
    });
    // Opening the card re-checks the variant and retires it; confirming then does nothing.
    expect(await confirmations.view(owner, stale)).toMatchObject({
      status: "cancelled",
      reason: "stale",
      token: null,
    });
    expect(await confirmCard(stale)).toMatchObject({ ok: false });

    const forged = await ready(await prepare());
    expect(await confirmCard(forged, owner, "forged-token")).toMatchObject({
      ok: false,
      code: "bad_token",
    });
    expect(await confirmCard(forged, operator)).toMatchObject({
      ok: false,
      code: "not_found",
    });

    const expired = await ready(await prepare());
    await confirmations.view(owner, expired);
    await client.unsafe(
      `UPDATE admin_assistant_confirmations SET expires_at = now() - interval '1 minute' WHERE id = '${expired}'`,
    );
    expect(await confirmCard(expired)).toMatchObject({ ok: false });
    expect((await unitsOf(BLUE)).some((unit) => unit.unitsPerSale === 3)).toBe(
      false,
    );
  });

  it("refuses to prepare deletion of a unit an order used, and prepares a pack sale", async () => {
    const pack = await addPack();
    await stock(10, BLUE, 200);
    await orders.create(request([{ sellingUnitId: pack.id, quantity: 1 }]));
    expect(
      await operations.sellingUnitOps.prepareDelete(owner, {
        product: "ممسحة تنظيف",
        variant: "أزرق",
        option: "باكيج",
      }),
    ).toMatchObject({ status: "rejected", code: "in_use" });

    const before = await businessState();
    const sale = await operations.prepareManualSale(owner, {
      customer: "زبون الباكيج",
      items: [
        { product: "ممسحة تنظيف أزرق", quantity: "2", sellingOption: "باكيج" },
      ],
      payment: "full",
    });
    expect(await businessState()).toEqual(before);
    if (sale.status === "needs_selection") {
      throw new Error(`needs selection: ${JSON.stringify(sale)}`);
    }
    expect(sale.status).toBe("ready");
    if (sale.status !== "ready") return;
    expect(sale.card.rows[0]).toMatchObject({
      label: expect.stringContaining("باكيج 3 حبات"),
      after: expect.stringContaining("يخصم 6 من المخزون"),
    });
    expect(sale.card.rows[0]!.after).toContain("باكيج 3 حبات × 2");
    const id = await ready(sale);
    expect(await confirmCard(id)).toMatchObject({ ok: true });
    expect(await item()).toMatchObject({ onHandMilli: 4_000 });
    const lines = await db
      .select()
      .from(schema.customerInvoiceLines)
      .where(
        and(
          eq(schema.customerInvoiceLines.sellingUnitId, pack.id),
          eq(schema.customerInvoiceLines.packQuantity, 2),
        ),
      );
    expect(lines).toHaveLength(1);
  });
});

describe("assistant manual sales by selling unit", () => {
  type Sale = Parameters<typeof operations.prepareManualSale>[1];
  const sale = (overrides: Partial<Sale> & Pick<Sale, "items">): Sale => ({
    customer: null,
    payment: "full",
    ...overrides,
  });
  const invoices = () =>
    db
      .select({
        invoice: schema.customerInvoices,
        line: schema.customerInvoiceLines,
      })
      .from(schema.customerInvoices)
      .innerJoin(
        schema.customerInvoiceLines,
        eq(schema.customerInvoiceLines.invoiceId, schema.customerInvoices.id),
      );
  const ledger = (customerId: string) =>
    db
      .select({
        type: schema.customerLedgerEntries.type,
        amount: schema.customerLedgerEntries.amountAgorot,
      })
      .from(schema.customerLedgerEntries)
      .where(eq(schema.customerLedgerEntries.customerId, customerId))
      .orderBy(schema.customerLedgerEntries.amountAgorot);
  const blueItem = (quantity: string, sellingOption: string) => [
    { product: "ممسحة تنظيف أزرق", quantity, sellingOption },
  ];

  it("records an anonymous cash sale of one single", async () => {
    await stock(10, BLUE, 200);
    const prepared = await operations.prepareManualSale(
      owner,
      sale({ items: blueItem("1", "حبة") }),
    );
    expect(prepared).toMatchObject({ status: "ready" });
    if (prepared.status !== "ready") return;
    expect(prepared.card.target.label).toBe("بيع نقدي بدون اسم");
    expect(prepared.card.impact).toEqual(["ربح تقديري: 2 ₪"]);
    expect(await confirmCard(await ready(prepared))).toMatchObject({
      ok: true,
    });
    const [row] = await invoices();
    expect(row!.invoice).toMatchObject({
      customerId: null,
      totalAgorot: 400,
      paidAtSaleAgorot: 400,
      cogsAgorot: 200,
      costComplete: true,
    });
    expect(row!.line).toMatchObject({
      unitsPerSale: 1,
      packQuantity: 1,
      quantityMilli: 1_000,
      lineTotalAgorot: 400,
      cogsAgorot: 200,
    });
    expect(await item()).toMatchObject({
      onHandMilli: 9_000,
      stockValueAgorot: 1_800,
    });
    // Revenue 4 ₪ minus cost 1 × 2 ₪ leaves 2 ₪, read back from the posted invoice.
    const detail = await sales.getInvoice(owner, row!.invoice.id);
    expect(detail!.profit).toMatchObject({
      complete: true,
      revenueAgorot: 400,
      cogsAgorot: 200,
      grossProfitAgorot: 200,
    });
  });

  it("records an anonymous cash sale of two 3-packs as six pieces at piece cost", async () => {
    await addPack();
    await stock(10, BLUE, 200);
    const prepared = await operations.prepareManualSale(
      owner,
      sale({ items: blueItem("2", "باكيج") }),
    );
    if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared));
    expect(prepared.card.rows[0]!.after).toContain("باكيج 3 حبات × 2");
    expect(prepared.card.rows[0]!.after).toContain("يخصم 6 من المخزون");
    expect(prepared.card.impact).toEqual(["ربح تقديري: 8 ₪"]);
    expect(await confirmCard(await ready(prepared))).toMatchObject({
      ok: true,
    });
    const [row] = await invoices();
    expect(row!.invoice).toMatchObject({
      customerId: null,
      totalAgorot: 2_000,
      paidAtSaleAgorot: 2_000,
      cogsAgorot: 1_200,
    });
    expect(row!.line).toMatchObject({
      unitsPerSale: 3,
      packQuantity: 2,
      quantityMilli: 6_000,
      unitPriceAgorot: 1_000,
      unitCostAgorot: 200,
      cogsAgorot: 1_200,
    });
    expect(await item()).toMatchObject({
      onHandMilli: 4_000,
      stockValueAgorot: 800,
    });
    // Revenue 20 ₪ minus cost 6 × 2 ₪ leaves 8 ₪, read back from the posted invoice.
    const detail = await sales.getInvoice(owner, row!.invoice.id);
    expect(detail!.profit).toMatchObject({
      revenueAgorot: 2_000,
      cogsAgorot: 1_200,
      grossProfitAgorot: 800,
    });
  });

  it("reads «باكيجين» and «عرض الثلاث حبات» as the one 3-pack", async () => {
    await addPack();
    await stock(10, BLUE, 200);
    for (const said of ["باكيجين", "عرض الثلاث حبات"]) {
      const prepared = await operations.prepareManualSale(
        owner,
        sale({ items: blueItem("2", said) }),
      );
      if (prepared.status !== "ready")
        throw new Error(JSON.stringify(prepared));
      expect(prepared.card.rows[0]!.after).toContain("باكيج 3 حبات × 2");
      expect(prepared.card.rows[0]!.after).toContain("يخصم 6 من المخزون");
    }
    // The model may fold the offer into the product name; the full name is there and the rest is one unit.
    const folded = await operations.prepareManualSale(
      owner,
      sale({
        items: [{ product: "عرض الثلاث حبات ممسحة تنظيف أزرق", quantity: "2" }],
      }),
    );
    if (folded.status !== "ready") throw new Error(JSON.stringify(folded));
    expect(folded.card.rows[0]!.after).toContain("باكيج 3 حبات × 2");
    expect(folded.card.rows[0]!.after).toContain("يخصم 6 من المخزون");
  });

  it("never turns the single piece into a «باكيج» of unstated size", async () => {
    for (const change of [
      { label: "باكيج", priceIls: "10" },
      { label: "الكرتونة" },
    ]) {
      expect(
        await operations.sellingUnitOps.prepareChange(owner, {
          product: "ممسحة تنظيف",
          variant: "أزرق",
          option: "حبة",
          change: "update",
          ...change,
        }),
      ).toMatchObject({ status: "rejected", code: "units_unstated" });
    }
    expect(
      await operations.sellingUnitOps.prepareCreate(owner, {
        product: "ممسحة تنظيف",
        variant: "أزرق",
        options: [{ label: "باكيج", unitsPerSale: 1, priceIls: "10" }],
      }),
    ).toMatchObject({ status: "rejected", code: "units_unstated" });
    expect(
      await db.select().from(schema.adminAssistantConfirmations),
    ).toHaveLength(0);
  });

  it("asks which pack when two fit, and prepares nothing", async () => {
    await addPack();
    await sellingUnits.create(owner, BLUE, {
      labelAr: "باكيج 6 حبات",
      unitsPerSale: 6,
      priceAgorot: 1800,
    });
    await stock(20, BLUE, 200);
    for (const said of ["باكيج", "باكيجين"]) {
      const prepared = await operations.prepareManualSale(
        owner,
        sale({ items: blueItem("2", said) }),
      );
      expect(prepared).toMatchObject({
        status: "needs_selection",
        field: "items.0.sellingOption",
      });
      if (prepared.status !== "needs_selection") return;
      const labels = prepared.options.map((option) => option.id);
      expect(labels).toEqual(
        expect.arrayContaining(["باكيج 3 حبات", "باكيج 6 حبات"]),
      );
    }
    expect(
      await operations.prepareManualSale(
        owner,
        sale({
          items: [{ product: "باكيج ممسحة تنظيف أزرق", quantity: "2" }],
        }),
      ),
    ).toMatchObject({ status: "needs_selection" });
    expect(
      await db.select().from(schema.adminAssistantConfirmations),
    ).toHaveLength(0);
  });

  it("records a named customer cash sale as invoice and payment with no debt", async () => {
    await addPack();
    await stock(10, BLUE, 200);
    const { id } = await customers.create(owner, { name: "سعاد الباكيج" });
    const prepared = await operations.prepareManualSale(
      owner,
      sale({ customer: "سعاد الباكيج", items: blueItem("1", "باكيج") }),
    );
    expect(await confirmCard(await ready(prepared))).toMatchObject({
      ok: true,
    });
    expect(await ledger(id)).toEqual([
      { type: "payment", amount: -1_000 },
      { type: "invoice", amount: 1_000 },
    ]);
    expect(await sales.customerBalance(db, id)).toBe(0);
    expect(await item()).toMatchObject({ onHandMilli: 7_000 });
  });

  it("puts a credit sale on the customer ledger and refuses credit without a customer", async () => {
    await addPack();
    await stock(10, BLUE, 200);
    const { id } = await customers.create(owner, { name: "زبون الدين" });
    expect(
      await operations.prepareManualSale(
        owner,
        sale({ payment: "none", items: blueItem("1", "باكيج") }),
      ),
    ).toMatchObject({ status: "rejected", code: "customer_required" });
    const prepared = await operations.prepareManualSale(
      owner,
      sale({
        customer: "زبون الدين",
        payment: "none",
        items: blueItem("2", "باكيج"),
      }),
    );
    if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared));
    expect(
      prepared.card.rows.find((row) => row.label === "رصيد الزبون"),
    ).toEqual({ label: "رصيد الزبون", before: "0 ₪", after: "20 ₪" });
    expect(await confirmCard(await ready(prepared))).toMatchObject({
      ok: true,
    });
    expect(await ledger(id)).toEqual([{ type: "invoice", amount: 2_000 }]);
    expect(await sales.customerBalance(db, id)).toBe(2_000);
    expect(await item()).toMatchObject({ onHandMilli: 4_000 });
  });

  it("refuses more packs than base stock holds and changes nothing", async () => {
    await addPack();
    await stock(10, BLUE, 200);
    const before = await businessState();
    expect(
      await operations.prepareManualSale(
        owner,
        sale({ items: blueItem("4", "باكيج") }),
      ),
    ).toMatchObject({ status: "rejected", code: "insufficient_stock" });
    expect(await businessState()).toEqual(before);
  });

  it("executes a double-confirmed sale once", async () => {
    await addPack();
    await stock(10, BLUE, 200);
    const id = await ready(
      await operations.prepareManualSale(
        owner,
        sale({ items: blueItem("2", "باكيج") }),
      ),
    );
    const view = await confirmations.view(owner, id);
    const confirm = () =>
      confirmations.confirm(owner, {
        id,
        operation: view!.operation,
        token: view!.token!,
      });
    await Promise.allSettled([confirm(), confirm()]);
    expect(await confirm()).toMatchObject({ ok: true, status: "completed" });
    expect(await db.select().from(schema.customerInvoices)).toHaveLength(1);
    expect(await item()).toMatchObject({ onHandMilli: 4_000 });
  });

  it("refuses a card whose selling unit was archived after it was prepared", async () => {
    const pack = await addPack();
    await stock(10, BLUE, 200);
    const id = await ready(
      await operations.prepareManualSale(
        owner,
        sale({ items: blueItem("1", "باكيج") }),
      ),
    );
    await sellingUnits.setArchived(owner, pack.id, pack.version, true);
    expect(await confirmCard(id)).toMatchObject({ ok: false });
    expect(await db.select().from(schema.customerInvoices)).toHaveLength(0);
    expect(await item()).toMatchObject({ onHandMilli: 10_000 });
  });
});
