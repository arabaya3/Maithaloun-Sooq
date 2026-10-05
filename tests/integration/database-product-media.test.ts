import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import { SellingUnitService } from "@/features/admin/application/selling-unit-service";
import {
  ProductOptionsService,
  type ProductMatrix,
} from "@/features/admin/application/product-options-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
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
import { OfferService } from "@/features/offers/application/offer-service";
import { OrderService } from "@/features/orders/application/order-service";
import { ExtractionService } from "@/features/purchasing/application/extraction-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import { SupplierService } from "@/features/purchasing/application/supplier-service";
import { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";
import { CustomerService } from "@/features/sales/application/customer-service";
import { SalesService } from "@/features/sales/application/sales-service";
import * as schema from "@/server/db/schema";
import type { PrivateDocumentStore } from "@/server/storage/private-documents";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
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
    return files.get(location.path)!;
  },
  signedUrl: async () => null,
  remove: async () => undefined,
};
const published: string[] = [];
const removed: string[] = [];
let failNextPut = false;
const imageStore = {
  put: async () => {
    if (failNextPut) {
      failNextPut = false;
      throw new Error("STORAGE_UPLOAD_FAILED");
    }
    const src = `https://example.supabase.co/storage/v1/object/public/product-images/products/${crypto.randomUUID()}.webp`;
    published.push(src);
    return { src, width: 800, height: 800 };
  },
  remove: async (src: string) => {
    removed.push(src);
    return true;
  },
};

const authoring = new CatalogAuthoringService(db);
const inventory = new InventoryService(db);
const purchases = new PurchaseService(db);
const customers = new CustomerService(db);
const attachments = new AttachmentService(db, () => store);
const conversations = new ConversationRepository(db);
const toolRuns = new ToolRunLog(db);
const operations = new AssistantOperations({
  database: db,
  catalog: new AdminCatalogService(db),
  authoring,
  maintenance: new ProductMaintenanceService(db),
  sellingUnits: new SellingUnitService(db),
  inventory,
  sales: new SalesService(db),
  customers,
  customerMaintenance: new CustomerMaintenanceService(db),
  suppliers: new SupplierService(db),
  supplierMaintenance: new SupplierMaintenanceService(db),
  offers: new OfferService(db),
  orders: new AdminOrderService(db),
  extraction: new ExtractionService(db, purchases, () => store),
  attachments,
  productImages: () => imageStore,
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
const options = new ProductOptionsService(db, authoring);
const media = operations.mediaOps;
const storefront = new PostgresProductRepository(db);

let owner: AdminActor;
let operator: AdminActor;
let conversationId: string;

async function photo(color = "#4477cc") {
  const png = await sharp({
    create: { width: 300, height: 300, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return (await attachments.upload(owner, png)).id;
}

async function confirm(result: PrepareResult, acknowledged = false) {
  if (result.status !== "ready")
    throw new Error(`not ready: ${JSON.stringify(result)}`);
  const created = await confirmations.create(owner, conversationId, result);
  const view = await confirmations.view(owner, created!.confirmationId);
  return () =>
    confirmations.confirm(owner, {
      id: created!.confirmationId,
      operation: view!.operation,
      token: view!.token!,
      acknowledged,
    });
}

async function matrix(domainId = "general-cleaner"): Promise<ProductMatrix> {
  return (await options.matrix(domainId))!;
}

async function scents(domainId = "general-cleaner") {
  return options.createOption(owner, domainId, {
    nameAr: "الرائحة",
    kind: "fragrance",
    values: ["لافندر", "ورد أبيض", "مسك"],
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  conversationId = await conversations.ensure(owner, null);
  await client.unsafe("DELETE FROM product_variant_option_values");
  await client.unsafe("DELETE FROM product_option_values");
  await client.unsafe("DELETE FROM product_options");
  await client.unsafe("DELETE FROM product_images");
  await client.unsafe(
    // Variants an order bought (through a selling unit) stay, as they would in the store.
    "DELETE FROM product_variants WHERE domain_id LIKE 'general-cleaner--v%' AND id NOT IN (SELECT variant_id FROM inventory_items) AND id NOT IN (SELECT s.variant_id FROM product_selling_units s JOIN order_items i ON i.selling_unit_id = s.id)",
  );
  await client.unsafe(
    "UPDATE product_variants SET combination_key = NULL, pack_count = NULL",
  );
  published.length = 0;
  removed.length = 0;
});

afterAll(async () => {
  await client.end();
});

describe("gallery", () => {
  it("keeps one primary image, dense order and mirrors it to the product and variants", async () => {
    const { imageIds } = await options.addImages(owner, "general-cleaner", [
      {
        src: "https://example.com/1.webp",
        alt: "أمام",
        width: 800,
        height: 800,
      },
      {
        src: "https://example.com/2.webp",
        alt: "خلف",
        width: 800,
        height: 600,
      },
      {
        src: "https://example.com/3.webp",
        alt: "تفاصيل",
        width: 600,
        height: 800,
      },
    ]);
    let current = await matrix();
    expect(
      current.images
        .filter((image) => image.isPrimary)
        .map((image) => image.id),
    ).toEqual([imageIds[0]]);
    expect(current.images.map((image) => image.sortOrder)).toEqual([0, 1, 2]);

    await options.setPrimaryImage(owner, imageIds[2]!);
    current = await matrix();
    expect(current.images.map((image) => image.id)).toEqual([
      imageIds[2],
      imageIds[0],
      imageIds[1],
    ]);
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, "general-cleaner"));
    expect(product!.imageSrc).toBe("https://example.com/3.webp");

    await options.setImageArchived(owner, imageIds[2]!, true);
    current = await matrix();
    expect(
      current.images.find((image) => !image.archived && image.isPrimary)?.id,
    ).toBe(imageIds[0]);
    await expect(
      options.deleteImage(owner, imageIds[0]!),
    ).rejects.toMatchObject({ code: "in_use" });
    expect(await options.deleteImage(owner, imageIds[2]!)).toMatchObject({
      fileStillUsed: false,
    });

    await options.reorderImages(owner, "general-cleaner", [
      imageIds[1]!,
      imageIds[0]!,
    ]);
    await expect(
      options.reorderImages(owner, "general-cleaner", [imageIds[1]!]),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const storefrontProduct = (await storefront.list()).find(
      (row) => row.id === "general-cleaner",
    )!;
    expect(storefrontProduct.image).toMatchObject({
      kind: "image",
      src: "https://example.com/2.webp",
    });
  });

  it("shows a variant's own image and rejects images from other products", async () => {
    const { optionId, valueIds } = await scents();
    await options.setVariantSelection(owner, "general-cleaner--default", {
      selection: { [optionId]: valueIds[0]! },
    });
    await options.addImages(owner, "general-cleaner", [
      {
        src: "https://example.com/main.webp",
        alt: "رئيسية",
        width: 800,
        height: 800,
      },
      {
        src: "https://example.com/lav.webp",
        alt: "لافندر",
        width: 800,
        height: 800,
        variantDomainId: "general-cleaner--default",
      },
    ]);
    const presentation = await storefront.presentation("general-cleaner");
    expect(
      presentation.gallery.map((image) => [image.src, image.variantId]),
    ).toEqual([
      ["https://example.com/main.webp", null],
      ["https://example.com/lav.webp", "general-cleaner--default"],
    ]);
    const [variant] = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.domainId, "general-cleaner--default"));
    expect(variant!.imageSrc).toBe("https://example.com/lav.webp");
    await expect(
      options.addImages(owner, "general-cleaner", [
        {
          src: "https://example.com/x.webp",
          alt: "x",
          width: 1,
          height: 1,
          variantDomainId: "dolphin-bleach--default",
        },
      ]),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("caps the gallery at eight images", async () => {
    const images = Array.from({ length: 9 }, (_, index) => ({
      src: `https://example.com/${index}.webp`,
      alt: "صورة",
      width: 10,
      height: 10,
    }));
    await expect(
      options.addImages(owner, "general-cleaner", images),
    ).rejects.toMatchObject({ code: "gallery_full" });
    expect((await matrix()).images).toHaveLength(0);
  });
});

describe("options and variants", () => {
  it("rejects duplicate options, values and combinations", async () => {
    const { optionId, valueIds } = await scents();
    await expect(scents()).rejects.toMatchObject({ code: "duplicate_option" });
    await expect(
      options.addValue(owner, optionId, "مِسك"),
    ).rejects.toMatchObject({ code: "duplicate_value" });
    await options.setVariantSelection(owner, "general-cleaner--default", {
      selection: { [optionId]: valueIds[0]! },
    });
    await expect(
      options.generateVariants(
        owner,
        "general-cleaner",
        [{ selection: { [optionId]: valueIds[0]! }, priceAgorot: 700 }],
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "duplicate_combination" });
  });

  it("creates every generated variant atomically, with labels and snapshots from the options", async () => {
    const { optionId, valueIds } = await scents();
    await options.setVariantSelection(owner, "general-cleaner--default", {
      selection: { [optionId]: valueIds[0]! },
    });
    await expect(
      options.generateVariants(
        owner,
        "general-cleaner",
        [
          {
            selection: { [optionId]: valueIds[1]! },
            priceAgorot: 900,
            sku: "DUP-SKU-1",
          },
          {
            selection: { [optionId]: valueIds[2]! },
            priceAgorot: 900,
            sku: "DUP-SKU-1",
          },
        ],
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(
      (await matrix()).variants.filter((variant) => !variant.archived),
    ).toHaveLength(1);

    const { variantIds } = await options.generateVariants(
      owner,
      "general-cleaner",
      [
        { selection: { [optionId]: valueIds[1]! }, priceAgorot: 900 },
        {
          selection: { [optionId]: valueIds[2]! },
          priceAgorot: 1_000,
          packCount: 3,
        },
      ],
      crypto.randomUUID(),
    );
    const current = await matrix();
    expect(current.missing).toEqual([]);
    const musk = current.variants.find(
      (variant) => variant.id === variantIds[1],
    )!;
    expect(musk).toMatchObject({
      label: "مسك",
      priceAgorot: 1_000,
      packCount: 3,
      onHandMilli: 0,
    });
    const [row] = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.domainId, variantIds[1]!));
    expect(row!.attributes).toEqual({ الرائحة: "مسك" });
  });

  it("keeps order history when a value is renamed and refuses to archive values in use", async () => {
    const { optionId, valueIds } = await scents();
    await options.setVariantSelection(owner, "general-cleaner--default", {
      selection: { [optionId]: valueIds[0]! },
    });
    const order = await new OrderService(db).create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
    );
    await options.updateValue(owner, valueIds[0]!, "لافندر فرنسي");
    const [item] = await db
      .select()
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(eq(schema.orders.publicReference, order.publicReference));
    expect(item!.order_items.variantAttributesSnapshot).toEqual({
      الرائحة: "لافندر",
    });
    expect((await matrix()).variants[0]!.label).toBe("لافندر فرنسي");
    await expect(
      options.setValueArchived(owner, valueIds[0]!, true),
    ).rejects.toMatchObject({ code: "in_use" });
    await expect(
      options.deleteValue(owner, valueIds[0]!),
    ).rejects.toMatchObject({ code: "in_use" });
    await options.setValueArchived(owner, valueIds[2]!, true);
    await options.deleteValue(owner, valueIds[2]!);
    await expect(options.deleteOption(owner, optionId)).rejects.toMatchObject({
      code: "in_use",
    });
  });

  it("takes orders for a variant that is not the default, at its own price", async () => {
    const { optionId, valueIds } = await scents();
    await options.setVariantSelection(owner, "general-cleaner--default", {
      selection: { [optionId]: valueIds[0]! },
    });
    const { variantIds } = await options.generateVariants(
      owner,
      "general-cleaner",
      [{ selection: { [optionId]: valueIds[2]! }, priceAgorot: 1_100 }],
      crypto.randomUUID(),
    );
    const order = await new OrderService(db).create(
      checkoutRequest([
        {
          productId: "general-cleaner",
          variantId: variantIds[0]!,
          quantity: 2,
        },
      ]),
    );
    const [item] = await db
      .select()
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(eq(schema.orders.publicReference, order.publicReference));
    expect(item!.order_items).toMatchObject({
      variantDomainId: variantIds[0],
      variantLabelSnapshot: "مسك",
      unitPriceAgorot: 1_100,
      variantAttributesSnapshot: { الرائحة: "مسك" },
    });
  });

  it("refuses option changes from an operator", async () => {
    await expect(scents()).resolves.toBeTruthy();
    await expect(
      options.createOption(operator, "general-cleaner", {
        nameAr: "اللون",
        kind: "color",
        values: ["أزرق"],
      }),
    ).rejects.toThrow();
  });
});

describe("whole product with variants", () => {
  const set = (barcode = "7290000011111") => ({
    product: {
      nameAr: "معطر لميس",
      latinName: "Lamis",
      categoryCode: "home",
      description: null,
      unit: null,
      publication: "published" as const,
      availability: "available" as const,
    },
    options: [
      {
        nameAr: "الرائحة",
        kind: "fragrance" as const,
        values: ["لافندر", "ورد أبيض", "مسك"],
      },
    ],
    variants: [
      {
        values: { الرائحة: "لافندر" },
        priceAgorot: 1_000,
        openingStock: { quantityMilli: 5_000, unitCostAgorot: 600 },
      },
      { values: { الرائحة: "ورد أبيض" }, priceAgorot: 1_000, barcode },
      { values: { الرائحة: "مسك" }, priceAgorot: 1_200, packCount: 3 },
    ],
  });

  it("creates product, variants, images and opening stock once through one confirmed card", async () => {
    const ids = [
      await photo("#7a5ab0"),
      await photo("#ffffff"),
      await photo("#8a6a3a"),
    ];
    const prepared = media.prepareProductSet(owner, {
      set: set(),
      attachments: ids.map((attachmentId, index) => ({
        attachmentId,
        variantIndex: index,
        primary: index === 0,
      })),
      categoryName: "مستلزمات منزلية",
    });
    const run = await confirm(prepared);
    const outcomes = await Promise.all([run(), run()]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const products = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.nameAr, "معطر لميس"));
    expect(products).toHaveLength(1);
    const lamis = (await options.matrix(products[0]!.domainId))!;
    expect(
      lamis.variants.map((variant) => [
        variant.label,
        variant.priceAgorot,
        variant.packCount,
        variant.onHandMilli,
      ]),
    ).toEqual([
      ["لافندر", 1_000, null, 5_000],
      ["ورد أبيض", 1_000, null, 0],
      ["مسك", 1_200, 3, 0],
    ]);
    expect(lamis.images.map((image) => image.variantId)).toEqual(
      lamis.variants.map((variant) => variant.id),
    );
    // Each photo is one scent's own picture; only a shared image can be primary, so the card shows the default scent's.
    expect(lamis.images.map((image) => image.scope)).toEqual([
      "variant",
      "variant",
      "variant",
    ]);
    expect(lamis.images.some((image) => image.isPrimary)).toBe(false);
    expect(products[0]!.imageSrc).toBe(lamis.images[0]!.src);
    expect(published).toHaveLength(3);
    expect(removed).toEqual([]);
    const [stock] = await db
      .select({
        value: sql<number>`sum(${schema.inventoryItems.stockValueAgorot})::int`,
      })
      .from(schema.inventoryItems)
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.inventoryItems.variantId),
      )
      .where(eq(schema.productVariants.productId, products[0]!.id));
    expect(stock!.value).toBe(3_000);
  });

  it("leaves nothing behind and removes uploaded files when creation fails", async () => {
    await db
      .update(schema.productVariants)
      .set({ barcode: "7290000099999" })
      .where(eq(schema.productVariants.domainId, "dolphin-bleach--default"));
    const ids = [await photo(), await photo("#ffffff")];
    const prepared = media.prepareProductSet(owner, {
      set: {
        ...set("7290000099999"),
        product: { ...set().product, nameAr: "معطر فاشل" },
      },
      attachments: ids.map((attachmentId, index) => ({
        attachmentId,
        variantIndex: null,
        primary: index === 0,
      })),
      categoryName: "مستلزمات منزلية",
    });
    const outcome = await (await confirm(prepared))();
    expect(outcome.ok).toBe(false);
    expect(
      await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.nameAr, "معطر فاشل")),
    ).toHaveLength(0);
    expect(removed.sort()).toEqual(published.sort());
    expect(published).toHaveLength(2);
  });

  it("removes files already uploaded when a later upload fails", async () => {
    const ids = [await photo(), await photo("#ffffff")];
    const prepared = media.prepareProductSet(owner, {
      set: {
        ...set("7290000022222"),
        product: { ...set().product, nameAr: "معطر الرفع" },
      },
      attachments: ids.map((attachmentId, index) => ({
        attachmentId,
        variantIndex: null,
        primary: index === 0,
      })),
      categoryName: "مستلزمات منزلية",
    });
    const run = await confirm(prepared);
    const original = imageStore.put;
    let calls = 0;
    imageStore.put = async () => {
      calls += 1;
      if (calls === 2) throw new Error("STORAGE_UPLOAD_FAILED");
      return original();
    };
    try {
      expect((await run()).ok).toBe(false);
    } finally {
      imageStore.put = original;
    }
    expect(removed).toEqual(published);
    expect(
      await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.nameAr, "معطر الرفع")),
    ).toHaveLength(0);
  });
});

describe("assistant cards", () => {
  it("rejects a stale card after the options change and executes a fresh one once", async () => {
    const prepared = await media.prepareOptionCreate(owner, {
      product: "منظف عام Secret",
      nameAr: "اللون",
      kind: "color",
      values: ["زهري", "أزرق"],
    });
    const run = await confirm(prepared);
    await scents();
    const stale = await run();
    expect(stale).toMatchObject({ ok: false, code: "stale" });
    const fresh = await confirm(
      await media.prepareOptionCreate(owner, {
        product: "منظف عام Secret",
        nameAr: "اللون",
        kind: "color",
        values: ["زهري", "أزرق"],
      }),
    );
    const results = await Promise.all([fresh(), fresh()]);
    expect(results.filter((row) => row.ok)).toHaveLength(1);
    expect(
      (await matrix()).options.map((option) => option.nameAr).sort(),
    ).toEqual(["الرائحة", "اللون"]);
  });

  it("asks which product, option or value when the name is unclear", async () => {
    await scents();
    const unknownValue = await media.prepareValueChange(owner, {
      product: "منظف عام Secret",
      option: "الرائحة",
      change: "rename",
      value: "ياسمين",
      newValue: "ياسمين فاخر",
    });
    expect(unknownValue).toMatchObject({
      status: "needs_selection",
      field: "value",
    });
    const unknownOption = await media.prepareOptionChange(owner, {
      product: "منظف عام Secret",
      option: "اللون",
      change: "archive",
    });
    expect(unknownOption).toMatchObject({
      status: "needs_selection",
      field: "option",
    });
    const article = await media.prepareValueChange(owner, {
      product: "منظف عام Secret",
      option: "الرائحة",
      change: "rename",
      value: "المسك",
      newValue: "مسك أبيض",
    });
    expect(article).toMatchObject({ status: "ready" });
  });

  it("requires the risk-4 acknowledgement for permanent value deletion", async () => {
    const { valueIds } = await scents();
    await options.setValueArchived(owner, valueIds[2]!, true);
    const prepared = await media.prepareValueChange(owner, {
      product: "منظف عام Secret",
      option: "الرائحة",
      change: "delete",
      value: "مسك",
    });
    expect(prepared).toMatchObject({
      status: "ready",
      card: { destructive: true },
    });
    expect(await (await confirm(prepared))()).toMatchObject({ ok: false });
    expect(await (await confirm(prepared, true))()).toMatchObject({ ok: true });
  });

  it("moves stock between a duplicate and the right variant without changing total value", async () => {
    const { optionId, valueIds } = await scents();
    await options.setVariantSelection(owner, "general-cleaner--default", {
      selection: { [optionId]: valueIds[0]! },
    });
    const { variantIds } = await options.generateVariants(
      owner,
      "general-cleaner",
      [
        {
          selection: { [optionId]: valueIds[1]! },
          priceAgorot: 700,
          openingStock: { quantityMilli: 4_000, unitCostAgorot: 500 },
        },
      ],
      crypto.randomUUID(),
    );
    const total = async () => {
      const [row] = await db
        .select({
          quantity: sql<number>`sum(${schema.inventoryItems.onHandMilli})::int`,
          value: sql<number>`sum(${schema.inventoryItems.stockValueAgorot})::int`,
        })
        .from(schema.inventoryItems)
        .innerJoin(
          schema.productVariants,
          eq(schema.productVariants.id, schema.inventoryItems.variantId),
        )
        .where(sql`${schema.productVariants.domainId} like 'general-cleaner%'`);
      return row;
    };
    const before = await total();
    await inventory.transfer(owner, {
      idempotencyKey: crypto.randomUUID(),
      fromVariantId: variantIds[0]!,
      toVariantId: "general-cleaner--default",
      quantityMilli: 4_000,
    });
    expect(await total()).toEqual(before);
  });
});
