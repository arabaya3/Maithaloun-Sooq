import { and, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AssistantOperations } from "@/features/assistant/application/assistant-operations";
import { createAssistantTools } from "@/features/assistant/application/assistant-tools";
import {
  prepareToolNames,
  readToolNames,
} from "@/features/assistant/domain/assistant-policy";
import { createProductImageAnalyzer } from "@/server/ai/product-image-analyzer";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { InventoryError } from "@/features/inventory/application/stock-ledger";
import { OrderService } from "@/features/orders/application/order-service";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { ExtractionService } from "@/features/purchasing/application/extraction-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { ReportService } from "@/features/reports/application/report-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { OfferService } from "@/features/offers/application/offer-service";
import { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import type { InvoiceExtractor } from "@/server/ai/invoice-extractor";
import {
  adminAssistantConfirmations,
  adminAssistantToolRuns,
  adminAuditEvents,
  customerInvoices,
  customerPayments,
  extractionJobs,
  inventoryAdjustments,
  inventoryItems,
  productVariants,
  products,
  stockMovements,
} from "@/server/db/schema";
import type { PrivateDocumentStore } from "@/server/storage/private-documents";
import type { ProductImageStore } from "@/server/storage/product-images";
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

const files = new Map<string, Buffer>();
const store: PrivateDocumentStore = {
  async put(objectPath, bytes) {
    files.set(objectPath, bytes);
    return { provider: "local", bucket: "memory", path: objectPath };
  },
  async read(location) {
    const file = files.get(location.path);
    if (!file) throw new Error("missing");
    return file;
  },
  signedUrl: async () => null,
  remove: async (location) => {
    files.delete(location.path);
  },
};
const images: ProductImageStore = {
  put: async () => ({
    src: "https://example.supabase.co/storage/v1/object/public/product-images/new.webp",
    width: 800,
    height: 800,
  }),
};

const catalog = new AdminCatalogService(db);
const maintenance = new ProductMaintenanceService(db);
const inventory = new InventoryService(db);
const purchases = new PurchaseService(db);
const sales = new SalesService(db);
const customers = new CustomerService(db);
const orders = new AdminOrderService(db);
const orderService = new OrderService(db);
const reports = new ReportService(db, customers, inventory);
const extraction = new ExtractionService(db, purchases, () => store);
const attachments = new AttachmentService(db, () => store);
const conversations = new ConversationRepository(db);
const toolRuns = new ToolRunLog(db);
const authoring = new CatalogAuthoringService(db);
const operations = new AssistantOperations({
  database: db,
  catalog,
  authoring,
  maintenance,
  inventory,
  sales,
  customers,
  customerMaintenance: new CustomerMaintenanceService(db),
  suppliers: new SupplierService(db),
  supplierMaintenance: new SupplierMaintenanceService(db),
  offers: new OfferService(db),
  orders,
  extraction,
  attachments,
  productImages: () => images,
  invoiceExtractor: (): InvoiceExtractor => ({
    model: "test-model",
    extract: async () => ({
      supplierName: "مورد المساعد",
      invoiceNumber: "AS-1",
      invoiceDate: "2026-09-20",
      currency: "₪",
      printedTotal: "10.00",
      discount: null,
      tax: null,
      paidAmount: null,
      paymentStatus: "paid",
      headerConfidence: 0.9,
      lines: [
        {
          description: "منظف عام",
          barcode: null,
          sku: null,
          size: null,
          quantity: "2",
          unit: null,
          unitPrice: "5.00",
          lineTotal: null,
          confidence: 0.9,
        },
      ],
      warnings: [],
    }),
  }),
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

const count = async (table: PgTable) =>
  (await db.select({ total: sql<number>`count(*)::int` }).from(table))[0]!
    .total;

async function stockIn(variantId: string, quantityMilli: number, cost = 400) {
  await purchases.post(owner, {
    idempotencyKey: crypto.randomUUID(),
    supplierName: "مورد الاختبار",
    reference: crypto.randomUUID().slice(0, 8),
    invoiceDate: "2026-09-01",
    source: "manual",
    lines: [
      {
        variantId,
        unit: "piece",
        quantityMilli,
        packQuantity: 1,
        unitCostAgorot: cost,
        lineDiscountAgorot: 0,
      },
    ],
    discountAgorot: 0,
    taxAgorot: null,
    printedTotalAgorot: null,
    paidAgorot: 0,
    acknowledgeDuplicate: false,
  });
}

async function onHand(variantId: string) {
  const [row] = await db
    .select({
      onHandMilli: inventoryItems.onHandMilli,
      value: inventoryItems.stockValueAgorot,
    })
    .from(inventoryItems)
    .innerJoin(
      productVariants,
      eq(productVariants.id, inventoryItems.variantId),
    )
    .where(eq(productVariants.domainId, variantId));
  return row ?? { onHandMilli: 0, value: 0 };
}

async function prepared(
  result: Awaited<ReturnType<AssistantOperations["prepareProductUpdate"]>>,
  actor: AdminActor = owner,
) {
  if (result.status !== "ready")
    throw new Error(`not ready: ${JSON.stringify(result)}`);
  const created = await confirmations.create(actor, conversationId, result);
  if (!created) throw new Error("not created");
  const view = await confirmations.view(actor, created.confirmationId);
  return {
    id: created.confirmationId,
    token: view!.token!,
    operation: view!.operation,
    view: view!,
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
  conversationId = await conversations.ensure(owner, null);
});

describe("confirmation workflow", () => {
  it("updates a product only after the confirmation, once", async () => {
    const card = await prepared(
      await operations.prepareProductUpdate(owner, {
        product: "سائل جلي Arar",
        changes: { nameAr: "سائل جلي عرار", priceIls: "13" },
      }),
    );
    expect(card.view.card.rows.map((row) => row.label)).toEqual([
      "الاسم",
      "سعر البيع",
    ]);
    expect(
      (await catalog.getByDomainId(owner, "arar-dish-liquid"))!.nameAr,
    ).toBe("سائل جلي");

    const first = await confirmations.confirm(owner, card);
    expect(first).toMatchObject({
      ok: true,
      status: "completed",
      href: "/admin/products/arar-dish-liquid",
    });
    const updated = (await catalog.getByDomainId(owner, "arar-dish-liquid"))!;
    expect(updated.nameAr).toBe("سائل جلي عرار");
    expect(updated.priceAgorot).toBe(1_300);

    const replay = await confirmations.confirm(owner, card);
    expect(replay).toMatchObject({ ok: true, status: "completed" });
    const audits = await db
      .select()
      .from(adminAuditEvents)
      .where(
        and(
          eq(adminAuditEvents.actionType, "product_update"),
          eq(adminAuditEvents.entityId, "arar-dish-liquid"),
        ),
      );
    expect(audits).toHaveLength(1);
    const runs = await db.select().from(adminAssistantToolRuns);
    expect(
      runs.some(
        (run) =>
          run.toolName === "confirmProductUpdate" && run.status === "succeeded",
      ),
    ).toBe(true);
    expect(JSON.stringify(runs)).not.toContain("سائل جلي عرار");

    const notes = await conversations.messages(owner, conversationId);
    expect(JSON.stringify(notes)).toContain("تم تعديل");
  });

  it("rejects stale, forged, foreign and expired confirmations", async () => {
    const card = await prepared(
      await operations.prepareProductUpdate(owner, {
        product: "carpet-brush",
        changes: { priceIls: "6" },
      }),
    );
    expect(
      await confirmations.confirm(owner, { ...card, token: "x".repeat(43) }),
    ).toMatchObject({ ok: false, code: "bad_token" });
    expect(await confirmations.confirm(operator, card)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await confirmations.confirm(owner, {
        ...card,
        operation: "productArchive",
      }),
    ).toMatchObject({ ok: false, code: "wrong_operation" });

    const current = (await catalog.getByDomainId(owner, "carpet-brush"))!;
    await catalog.update(owner, {
      domainId: current.id,
      nameAr: current.nameAr,
      priceAgorot: 550,
      categoryId: current.categoryId,
      availability: current.availability,
      sortOrder: current.sortOrder,
      detailsStatus: current.detailsStatus,
      placeholderVariant:
        current.image.kind === "placeholder" ? current.image.variant : "brush",
    });
    expect(await confirmations.confirm(owner, card)).toMatchObject({
      ok: false,
      code: "stale",
    });
    expect(
      (await catalog.getByDomainId(owner, "carpet-brush"))!.priceAgorot,
    ).toBe(550);

    const late = await prepared(
      await operations.prepareProductUpdate(owner, {
        product: "carpet-brush",
        changes: { priceIls: "7" },
      }),
    );
    await db
      .update(adminAssistantConfirmations)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(adminAssistantConfirmations.id, late.id));
    expect(await confirmations.confirm(owner, late)).toMatchObject({
      ok: false,
      code: "expired",
    });
    expect(
      (await catalog.getByDomainId(owner, "carpet-brush"))!.priceAgorot,
    ).toBe(550);
  });

  it("asks which product when a name matches several", async () => {
    const result = await operations.prepareProductUpdate(owner, {
      product: "مزيل دهون",
      changes: { priceIls: "9" },
    });
    expect(result).toMatchObject({ status: "needs_selection" });
    if (result.status === "needs_selection") {
      expect(result.options.map((option) => option.id).sort()).toEqual([
        "degreaser-10",
        "degreaser-8",
      ]);
    }
  });

  it("keeps owner-only operations away from operators", async () => {
    expect(
      await operations.prepareProductArchive(operator, {
        product: "carpet-brush",
        reason: "تجربة",
      }),
    ).toMatchObject({ status: "rejected", code: "forbidden" });
    expect(
      await operations.prepareInventoryCorrection(operator, {
        product: "general-cleaner",
        reason: "correction",
        quantity: "3",
      }),
    ).toMatchObject({ status: "rejected", code: "forbidden" });
  });
});

describe("product lifecycle", () => {
  it("archives a referenced product and deletes an unreferenced one only from a risk 4 card", async () => {
    await stockIn("lilac-floor-cleaner--default", 2_000);
    const archive = await prepared(
      await operations.prepareProductArchive(owner, {
        product: "Lilac",
        reason: "مكرر",
      }),
    );
    expect(archive.view.card.title).toBe("أرشفة منتج");
    expect(await confirmations.confirm(owner, archive)).toMatchObject({
      ok: true,
    });
    const repository = new PostgresProductRepository(db);
    expect(await repository.getById("lilac-floor-cleaner")).toBeNull();
    expect((await onHand("lilac-floor-cleaner--default")).onHandMilli).toBe(
      2_000,
    );

    await catalog.create(owner, {
      domainId: "test-product",
      slug: "test-product",
      nameAr: "منتج تجريبي",
      priceAgorot: 100,
      categoryId: "home",
      availability: "unavailable",
      sortOrder: 900,
      detailsStatus: "placeholder",
      placeholderVariant: "general-cleaner",
    });
    const archiveOnly = await operations.prepareProductArchive(owner, {
      product: "منتج تجريبي",
      reason: "تجربة",
    });
    expect(archiveOnly).toMatchObject({
      status: "ready",
      operation: "productArchive",
      args: { mode: "archive" },
    });
    const remove = await prepared(
      await operations.catalogOps.prepareUnusedProductDeletion(
        owner,
        { product: "منتج تجريبي", reason: "تجربة" },
        (domainId) => operations.productReferences(owner, domainId),
      ),
    );
    expect(remove.view.riskLevel).toBe(4);
    expect(remove.view.card.title).toBe("حذف منتج نهائياً");
    expect(await confirmations.confirm(owner, remove)).toMatchObject({
      ok: false,
      code: "not_acknowledged",
    });
    expect(
      await confirmations.confirm(owner, { ...remove, acknowledged: true }),
    ).toMatchObject({ ok: true });
    const [gone] = await db
      .select()
      .from(products)
      .where(eq(products.domainId, "test-product"));
    expect(gone).toBeUndefined();
  });

  it("merges a duplicate, moving stock at cost and keeping its history", async () => {
    await stockIn("musk-floor-cleaner--default", 3_000, 400);
    await stockIn("smart-floor-cleaner--default", 5_000, 500);
    const before = {
      musk: await onHand("musk-floor-cleaner--default"),
      smart: await onHand("smart-floor-cleaner--default"),
      movements: await count(stockMovements),
    };
    const merge = await prepared(
      await operations.prepareProductMerge(owner, {
        duplicate: "Musk",
        target: "Smart",
      }),
    );
    expect(await confirmations.confirm(owner, merge)).toMatchObject({
      ok: true,
    });
    const after = {
      musk: await onHand("musk-floor-cleaner--default"),
      smart: await onHand("smart-floor-cleaner--default"),
    };
    expect(after.musk.onHandMilli).toBe(0);
    expect(after.smart.onHandMilli).toBe(8_000);
    expect(after.musk.value + after.smart.value).toBe(
      before.musk.value + before.smart.value,
    );
    expect(await count(stockMovements)).toBe(before.movements + 2);
    const [source] = await db
      .select()
      .from(products)
      .where(eq(products.domainId, "musk-floor-cleaner"));
    expect(source?.archivedAt).not.toBeNull();
    expect(source?.mergedIntoProductId).not.toBeNull();
  });

  it("replaces a product image from a validated attachment", async () => {
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#cc3333" },
    })
      .png()
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .toBuffer();
    await expect(
      attachments.upload(owner, Buffer.from("<svg onload=alert(1)>")),
    ).rejects.toThrow("unsupported_file");
    const uploaded = await attachments.upload(owner, png);
    const stored = await attachments.read(owner, uploaded.id);
    expect(stored?.mimeType).toBe("image/jpeg");
    expect((await sharp(stored!.bytes).metadata()).exif).toBeUndefined();
    expect(await attachments.read(operator, uploaded.id)).toBeNull();

    const card = await prepared(
      await operations.prepareProductImageReplacement(owner, {
        product: "carpet-brush",
        attachmentId: uploaded.id,
      }),
    );
    expect(card.view.card.images?.after).toBe(
      `/admin/api/assistant/attachments/${uploaded.id}`,
    );
    expect(await confirmations.confirm(owner, card)).toMatchObject({
      ok: true,
    });
    const product = (await catalog.getByDomainId(owner, "carpet-brush"))!;
    expect(product.image).toMatchObject({
      kind: "image",
      src: expect.stringContaining("new.webp"),
    });
  });
});

describe("inventory, sales and payments", () => {
  it("corrects stock with an appended movement, once", async () => {
    await stockIn("general-cleaner--default", 19_000);
    const card = await prepared(
      await operations.prepareInventoryCorrection(owner, {
        product: "منظف عام",
        reason: "correction",
        quantity: "15",
      }),
    );
    expect(card.view.card.rows[1]).toMatchObject({
      before: "19 حبة",
      after: "15 حبة",
    });
    await confirmations.confirm(owner, card);
    await confirmations.confirm(owner, card);
    expect((await onHand("general-cleaner--default")).onHandMilli).toBe(15_000);
    expect(await count(inventoryAdjustments)).toBe(1);
  });

  it("rolls back a transfer that would go below zero", async () => {
    await stockIn("general-cleaner--default", 2_000);
    const before = await count(inventoryAdjustments);
    await expect(
      inventory.transfer(owner, {
        idempotencyKey: crypto.randomUUID(),
        fromVariantId: "general-cleaner--default",
        toVariantId: "dolphin-bleach--default",
        quantityMilli: 5_000,
      }),
    ).rejects.toBeInstanceOf(InventoryError);
    expect(await count(inventoryAdjustments)).toBe(before);
    expect((await onHand("general-cleaner--default")).onHandMilli).toBe(2_000);
  });

  it("records a manual sale once and moves stock once", async () => {
    await stockIn("dolphin-bleach--default", 10_000);
    const card = await prepared(
      await operations.prepareManualSale(owner, {
        customer: "محمد الاختبار",
        items: [{ product: "مبيض Dolphin", quantity: "2" }],
        payment: "partial",
        paidIls: "10",
      }),
    );
    expect(JSON.stringify(card.view.card)).toContain("زبون جديد");
    const [first, second] = await Promise.all([
      confirmations.confirm(owner, card),
      confirmations.confirm(owner, card),
    ]);
    expect([first.ok, second.ok]).toContain(true);
    expect(await count(customerInvoices)).toBe(1);
    expect((await onHand("dolphin-bleach--default")).onHandMilli).toBe(8_000);
  });

  it("records a customer payment once and refuses more than the debt", async () => {
    await stockIn("dolphin-bleach--default", 10_000);
    await sales.post(owner, {
      idempotencyKey: crypto.randomUUID(),
      source: "manual",
      customerName: "أحمد الاختبار",
      lines: [
        {
          variantId: "dolphin-bleach--default",
          quantityMilli: 5_000,
          unitPriceAgorot: 800,
        },
      ],
      discountAgorot: 0,
      paidAgorot: 0,
    });
    expect(
      await operations.prepareCustomerPayment(owner, {
        customer: "أحمد الاختبار",
        amountIls: "500",
      }),
    ).toMatchObject({ status: "rejected", code: "exceeds_balance" });
    const card = await prepared(
      await operations.prepareCustomerPayment(owner, {
        customer: "أحمد الاختبار",
        amountIls: "30",
      }),
    );
    await confirmations.confirm(owner, card);
    await confirmations.confirm(owner, card);
    expect(await count(customerPayments)).toBe(1);
  });

  it("cancels an order through the allowed transition and refuses a delivered one", async () => {
    const order = await orderService.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    const card = await prepared(
      await operations.prepareOrderCancellation(owner, {
        reference: order.publicReference,
        reason: "طلب تجريبي",
      }),
    );
    expect(await confirmations.confirm(owner, card)).toMatchObject({
      ok: true,
    });
    expect(
      (await orders.getByPublicReference(owner, order.publicReference))!.status,
    ).toBe("cancelled");
    expect(
      await operations.prepareOrderCancellation(owner, {
        reference: order.publicReference,
        reason: "مرة ثانية",
      }),
    ).toMatchObject({ status: "rejected", code: "invalid_transition" });
  });

  it("reads an invoice photo into a review job only after confirmation", async () => {
    const photo = await sharp({
      create: { width: 600, height: 800, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const uploaded = await attachments.upload(owner, photo);
    const card = await prepared(
      await operations.preparePurchaseInvoiceImport(owner, {
        attachmentIds: [uploaded.id],
      }),
    );
    expect(await count(extractionJobs)).toBe(0);
    const outcome = await confirmations.confirm(owner, card);
    expect(outcome).toMatchObject({
      ok: true,
      href: expect.stringContaining("/admin/inventory/review/"),
    });
    expect(await count(extractionJobs)).toBe(1);
    expect(await count(stockMovements)).toBe(0);
  });
});

describe("tool surface", () => {
  const context = (mode: "read" | "full") => ({
    actor: owner,
    conversationId,
    mode,
    database: db,
    catalog,
    authoring,
    attachments,
    imageAnalyzer: createProductImageAnalyzer,
    offers: new OfferService(db),
    customerMaintenance: new CustomerMaintenanceService(db),
    suppliers: new SupplierService(db),
    supplierMaintenance: new SupplierMaintenanceService(db),
    inventory,
    orders,
    customers,
    sales,
    reports,
    purchases,
    operations,
    confirmations,
    toolRuns,
  });

  it("exposes no execution tool and no mutations in read-only mode", () => {
    const full = Object.keys(createAssistantTools(context("full")));
    const read = Object.keys(createAssistantTools(context("read")));
    expect(full.some((name) => /^(confirm|execute|run|sql)/i.test(name))).toBe(
      false,
    );
    expect(read.some((name) => name.startsWith("prepare"))).toBe(false);
    expect(full.filter((name) => name.startsWith("prepare")).sort()).toEqual(
      [...prepareToolNames].sort(),
    );
    expect(read.sort()).toEqual([...readToolNames].sort());
  });

  it("a prepare tool leaves data untouched and returns no secret token", async () => {
    const tools = createAssistantTools(context("full"));
    if (!("prepareProductUpdate" in tools)) throw new Error("missing");
    const output = await tools.prepareProductUpdate.execute!(
      { product: "منظف عام", changes: { nameAr: "اسم مزوّر" } },
      { toolCallId: "t1", messages: [], context: {} } as never,
    );
    expect(output).toMatchObject({ status: "awaiting_confirmation" });
    expect(JSON.stringify(output)).not.toMatch(/token/i);
    expect(
      (await catalog.getByDomainId(owner, "general-cleaner"))!.nameAr,
    ).toBe("منظف عام");
  });
});
