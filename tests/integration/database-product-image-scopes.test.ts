import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminOrderService } from "@/features/admin/application/admin-order-service";
import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductMaintenanceService } from "@/features/admin/application/product-maintenance-service";
import { ProductOptionsService } from "@/features/admin/application/product-options-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import {
  AssistantOperations,
  type PrepareResult,
} from "@/features/assistant/application/assistant-operations";
import { AttachmentService } from "@/features/assistant/application/attachment-service";
import { ConfirmationService } from "@/features/assistant/application/confirmation-service";
import { ConversationRepository } from "@/features/assistant/application/conversation-repository";
import { ToolRunLog } from "@/features/assistant/application/tool-run-log";
import { mappingMessages } from "@/features/catalog/domain/product-media-validation";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { InventoryService } from "@/features/inventory/application/inventory-service";
import { OfferService } from "@/features/offers/application/offer-service";
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

import { createOwnerActor } from "./support";

const { db, client } = testDatabaseConnection;
const PRODUCT = "general-cleaner";
const NAME = "منظف عام Secret";

const store: PrivateDocumentStore = {
  put: async (objectPath) => ({
    provider: "local",
    bucket: "memory",
    path: objectPath,
  }),
  read: async () => Buffer.alloc(0),
  signedUrl: async () => null,
  remove: async () => undefined,
};
const imageStore = {
  put: async () => ({
    src: `https://example.com/${crypto.randomUUID()}.webp`,
    width: 800,
    height: 800,
  }),
  remove: async () => true,
};
const authoring = new CatalogAuthoringService(db);
const purchases = new PurchaseService(db);
const attachments = new AttachmentService(db, () => store);
const conversations = new ConversationRepository(db);
const operations = new AssistantOperations({
  database: db,
  catalog: new AdminCatalogService(db),
  authoring,
  maintenance: new ProductMaintenanceService(db),
  inventory: new InventoryService(db),
  sales: new SalesService(db),
  customers: new CustomerService(db),
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
  new ToolRunLog(db),
);
const options = new ProductOptionsService(db, authoring);
const media = operations.mediaOps;
const storefront = new PostgresProductRepository(db);

let owner: AdminActor;
let conversationId: string;
let ids: {
  color: string;
  size: string;
  blue: string;
  pink: string;
  small: string;
  large: string;
};

const photo = (name: string) => ({
  src: `https://example.com/${name}.webp`,
  alt: name,
  width: 800,
  height: 600,
});

async function images() {
  return db
    .select()
    .from(schema.productImages)
    .orderBy(schema.productImages.sortOrder);
}

async function byAlt(alt: string) {
  const [row] = await db
    .select()
    .from(schema.productImages)
    .where(eq(schema.productImages.altAr, alt));
  return row!;
}

async function auditCount() {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.adminAuditEvents);
  return row!.total;
}

async function confirm(result: PrepareResult) {
  if (result.status !== "ready")
    throw new Error(`not ready: ${JSON.stringify(result)}`);
  const created = await confirmations.create(owner, conversationId, result);
  const view = await confirmations.view(owner, created!.confirmationId);
  return () =>
    confirmations.confirm(owner, {
      id: created!.confirmationId,
      operation: view!.operation,
      token: view!.token!,
      acknowledged: false,
    });
}

// معطر لويال shape on the seeded product: colour × size, four variants.
async function colourBySize() {
  const color = await options.createOption(owner, PRODUCT, {
    nameAr: "اللون",
    kind: "color",
    values: ["أزرق", "زهري"],
  });
  const size = await options.createOption(owner, PRODUCT, {
    nameAr: "الحجم",
    kind: "size",
    values: ["صغير", "كبير"],
  });
  const [blue, pink] = color.valueIds as [string, string];
  const [small, large] = size.valueIds as [string, string];
  ids = {
    color: color.optionId,
    size: size.optionId,
    blue,
    pink,
    small,
    large,
  };
  await options.setVariantSelection(owner, `${PRODUCT}--default`, {
    selection: { [ids.color]: blue, [ids.size]: small },
  });
  await options.generateVariants(
    owner,
    PRODUCT,
    [
      [blue, large],
      [pink, small],
      [pink, large],
    ].map(([colorValue, sizeValue]) => ({
      selection: { [ids.color]: colorValue!, [ids.size]: sizeValue! },
      priceAgorot: 1500,
    })),
    crypto.randomUUID(),
  );
}

async function variantDomainId(colorValue: string, sizeValue: string) {
  const matrix = (await options.matrix(PRODUCT))!;
  return matrix.variants.find(
    (variant) =>
      !variant.archived &&
      variant.optionValues[ids.color] === colorValue &&
      variant.optionValues[ids.size] === sizeValue,
  )!.id;
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

beforeEach(async () => {
  conversationId = await conversations.ensure(owner, null);
  await client.unsafe("DELETE FROM product_images");
  await client.unsafe("DELETE FROM product_variant_option_values");
  await client.unsafe("DELETE FROM product_option_values");
  await client.unsafe("DELETE FROM product_options");
  await client.unsafe(
    `DELETE FROM product_variants WHERE domain_id LIKE '${PRODUCT}--v%' AND id NOT IN (SELECT variant_id FROM inventory_items)`,
  );
  await client.unsafe(
    "UPDATE product_variants SET combination_key = NULL, pack_count = NULL, archived_at = NULL",
  );
  await colourBySize();
});

afterAll(async () => {
  await client.end();
});

describe("image scopes in the database", () => {
  it("rejects scopes whose target columns do not match", async () => {
    const [product] =
      await client`select id from products where domain_id = ${PRODUCT}`;
    const insert = (columns: string) =>
      client.unsafe(
        `INSERT INTO product_images (product_id, src, alt_ar, width, height, sort_order, ${columns}`,
      );
    await expect(
      insert(`scope) VALUES ('${product!.id}', 'x', 'x', 1, 1, 9, 'variant')`),
    ).rejects.toThrow(/product_images_scope_target/);
    await expect(
      insert(
        `scope, option_id) VALUES ('${product!.id}', 'x', 'x', 1, 1, 9, 'product', '${ids.color}')`,
      ),
    ).rejects.toThrow(/product_images_scope_target/);
    await expect(
      insert(
        `scope, is_primary) VALUES ('${product!.id}', 'x', 'x', 1, 1, 9, 'unassigned', true)`,
      ),
    ).rejects.toThrow(/product_images_unassigned_not_primary/);
  });

  it("rejects a value from another product or another option", async () => {
    const [other] =
      await client`select id from products where domain_id = 'dolphin-bleach'`;
    await expect(
      client.unsafe(`
        INSERT INTO product_images (product_id, scope, option_id, option_value_id, src, alt_ar, width, height, sort_order)
        VALUES ('${other!.id}', 'option_value', '${ids.color}', '${ids.blue}', 'x', 'x', 1, 1, 9)`),
    ).rejects.toThrow(/product_images_option_same_product_fk/);
    const [product] =
      await client`select id from products where domain_id = ${PRODUCT}`;
    await expect(
      client.unsafe(`
        INSERT INTO product_images (product_id, scope, option_id, option_value_id, src, alt_ar, width, height, sort_order)
        VALUES ('${product!.id}', 'option_value', '${ids.size}', '${ids.blue}', 'x', 'x', 1, 1, 9)`),
    ).rejects.toThrow(/product_images_value_same_option_fk/);
    await expect(
      options.addImages(owner, "dolphin-bleach", [
        {
          ...photo("cross"),
          target: { scope: "option_value", valueId: ids.blue },
        },
      ]),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps RLS on and grants nothing to the public roles", async () => {
    const rows = await client<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class
      where relname in ('product_images', 'product_option_values') order by 1`;
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
    const grants = await client`
      select 1 from information_schema.role_table_grants
      where table_name in ('product_images', 'product_option_values')
        and grantee in ('anon', 'authenticated', 'PUBLIC')`;
    expect(grants).toHaveLength(0);
  });
});

describe("classifying images", () => {
  it("leaves new uploads on a multi-variant product unclassified and hidden from customers", async () => {
    await options.addImages(owner, PRODUCT, [photo("first")]);
    const [row] = await images();
    expect(row).toMatchObject({ scope: "unassigned", isPrimary: false });
    expect((await storefront.presentation(PRODUCT)).gallery).toEqual([]);
    expect((await options.matrix(PRODUCT))!.mapping).toContainEqual(
      expect.objectContaining({
        code: "unassigned_image",
        message: mappingMessages.unassigned,
      }),
    );
  });

  it("remaps an image without touching its file, and keeps the primary image shared", async () => {
    await options.addImages(owner, PRODUCT, [
      { ...photo("main"), target: { scope: "product" } },
      { ...photo("blue"), target: { scope: "product" } },
    ]);
    const main = await byAlt("main");
    expect(main.isPrimary).toBe(true);
    await options.setImageScope(owner, main.id, {
      scope: "option_value",
      valueId: ids.blue,
    });
    const moved = await byAlt("main");
    expect(moved).toMatchObject({
      scope: "option_value",
      optionId: ids.color,
      optionValueId: ids.blue,
      src: main.src,
      isPrimary: false,
    });
    expect((await byAlt("blue")).isPrimary).toBe(true);
    await expect(options.setPrimaryImage(owner, main.id)).rejects.toMatchObject(
      { code: "primary_must_be_shared" },
    );
    expect(
      await options.setImageScope(owner, main.id, {
        scope: "option_value",
        valueId: ids.blue,
      }),
    ).toEqual({ changed: false });
  });

  it("rejects archived variants and values as targets", async () => {
    await options.addImages(owner, PRODUCT, [photo("x")]);
    const image = await byAlt("x");
    const blueLarge = await variantDomainId(ids.blue, ids.large);
    await authoring.archiveVariant(owner, blueLarge);
    await expect(
      options.setImageScope(owner, image.id, {
        scope: "variant",
        variantDomainId: blueLarge,
      }),
    ).rejects.toMatchObject({ code: "archived" });
  });

  it("refuses to archive or delete a value or option while images point at it", async () => {
    // A colour no variant uses yet, so only its image holds it in place.
    const { valueId: green } = await options.addValue(owner, ids.color, "أخضر");
    await options.addImages(owner, PRODUCT, [
      { ...photo("green"), target: { scope: "option_value", valueId: green } },
    ]);
    await expect(
      options.setValueArchived(owner, green, true),
    ).rejects.toMatchObject({ code: "has_images" });
    await expect(options.deleteValue(owner, green)).rejects.toMatchObject({
      code: "has_images",
    });
    await expect(
      client.unsafe(`DELETE FROM product_option_values WHERE id = '${green}'`),
    ).rejects.toThrow(/product_images_value_same_option_fk/);
    expect(await byAlt("green")).toMatchObject({ optionValueId: green });
    // Once the image moves, the value can go and the file is untouched.
    const image = await byAlt("green");
    await options.setImageScope(owner, image.id, { scope: "product" });
    await options.setValueArchived(owner, green, true);
    expect((await byAlt("green")).src).toBe(image.src);
  });

  it("serializes concurrent remaps of the same product and ends consistent", async () => {
    await options.addImages(owner, PRODUCT, [
      { ...photo("a"), target: { scope: "product" } },
      { ...photo("b"), target: { scope: "product" } },
    ]);
    const [a, b] = [await byAlt("a"), await byAlt("b")];
    await Promise.all([
      options.setImageScope(owner, a.id, {
        scope: "option_value",
        valueId: ids.blue,
      }),
      options.setImageScope(owner, b.id, {
        scope: "option_value",
        valueId: ids.pink,
      }),
      options.setImageScope(owner, a.id, {
        scope: "option_value",
        valueId: ids.pink,
      }),
    ]);
    const rows = await images();
    expect(rows.filter((row) => row.isPrimary)).toHaveLength(0);
    expect(rows.every((row) => row.scope === "option_value")).toBe(true);
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, PRODUCT));
    // With no shared image left, cards show what the default (blue) variant shows, whichever remap ran last.
    const blueImage = rows.find((row) => row.optionValueId === ids.blue);
    expect(product!.imageSrc ?? null).toBe(blueImage?.src ?? null);
  });
});

describe("storefront and publishing", () => {
  it("never shows an archived variant's image as if it were shared", async () => {
    const pinkLarge = await variantDomainId(ids.pink, ids.large);
    await options.addImages(owner, PRODUCT, [
      { ...photo("main"), target: { scope: "product" } },
      {
        ...photo("pl"),
        target: { scope: "variant", variantDomainId: pinkLarge },
      },
    ]);
    expect(
      (await storefront.presentation(PRODUCT)).gallery.map((row) => [
        row.alt,
        row.scope,
        row.variantId,
      ]),
    ).toEqual([
      ["main", "product", null],
      ["pl", "variant", pinkLarge],
    ]);
    await authoring.archiveVariant(owner, pinkLarge);
    expect(
      (await storefront.presentation(PRODUCT)).gallery.map((row) => row.alt),
    ).toEqual(["main"]);
    expect((await options.matrix(PRODUCT))!.mapping).toContainEqual(
      expect.objectContaining({ code: "stale_mapping" }),
    );
  });

  it("blocks publishing until every colour has a picture or an explicit shared choice; drafts still save", async () => {
    const publish = () =>
      authoring.setPublication(owner, {
        domainId: PRODUCT,
        publication: "published",
        acceptPlaceholder: true,
      });
    await authoring.setPublication(owner, {
      domainId: PRODUCT,
      publication: "draft",
      acceptPlaceholder: true,
    });
    await options.addImages(owner, PRODUCT, [photo("loose")]);
    await expect(publish()).rejects.toMatchObject({ code: "not_publishable" });
    const check = await authoring.publicationCheck(PRODUCT);
    expect(check!.problems).toEqual(
      expect.arrayContaining([
        mappingMessages.blocked,
        mappingMessages.unassigned,
        "اللون «أزرق» لا يملك صورة. أضف صورة أو اختر استخدام الصورة العامة.",
      ]),
    );
    expect(check!.problems.join(" ")).not.toMatch(
      /product_images|violates|23505/,
    );

    const loose = await byAlt("loose");
    await options.setImageScope(owner, loose.id, {
      scope: "option_value",
      valueId: ids.blue,
    });
    await expect(publish()).rejects.toMatchObject({ code: "not_publishable" });
    await options.setValueSharedImage(owner, ids.pink, true);
    await publish();
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, PRODUCT));
    expect(product!.publication).toBe("published");
  });
});

describe("assistant image mapping", () => {
  it("prepares without any change, shows the suggestion as a warning, and rejects a stale card", async () => {
    await options.addImages(owner, PRODUCT, [photo("loose")]);
    const before = { rows: await images(), audits: await auditCount() };
    const prepared = await media.prepareImageMapping(owner, {
      product: NAME,
      image: 1,
      target: "value",
      option: "اللون",
      value: "الأزرق",
      suggestion: { value: "أزرق", confidence: 0.62, source: "image_analysis" },
    });
    expect(prepared).toMatchObject({
      status: "ready",
      operation: "galleryScope",
      card: {
        rows: [
          { label: "الصورة تخص", before: "غير مربوطة", after: "اللون: أزرق" },
          { label: "يتأثر", after: "اللون: أزرق" },
        ],
        images: { after: expect.stringContaining("loose.webp") },
      },
    });
    if (prepared.status === "ready") {
      expect(prepared.card.warnings.join(" ")).toMatch(/اقتراح.*62٪/);
      expect(JSON.stringify(prepared)).not.toMatch(/token/i);
    }
    expect({ rows: await images(), audits: await auditCount() }).toEqual(
      before,
    );

    const stale = await confirm(prepared);
    await options.setImageScope(owner, (await byAlt("loose")).id, {
      scope: "product",
    });
    expect(await stale()).toMatchObject({ ok: false, code: "stale" });
    expect((await byAlt("loose")).scope).toBe("product");
  });

  it("applies a confirmed mapping once, even when tapped twice or replayed", async () => {
    await options.addImages(owner, PRODUCT, [photo("loose")]);
    const run = await confirm(
      await media.prepareImageMapping(owner, {
        product: NAME,
        image: 1,
        target: "value",
        option: "اللون",
        value: "زهري",
      }),
    );
    const audits = await auditCount();
    const results = await Promise.all([run(), run()]);
    expect(results.filter((row) => row.ok)).toHaveLength(1);
    const replay = await run();
    expect(replay.ok ? "stored" : replay.code).toMatch(
      /stored|already|used|stale/,
    );
    expect(await byAlt("loose")).toMatchObject({
      scope: "option_value",
      optionValueId: ids.pink,
    });
    expect((await auditCount()) - audits).toBeGreaterThanOrEqual(1);
    const scopeAudits = await client`
      select 1 from admin_audit_events
      where action_type = 'product_image_scope' and after_state->>'image' = ${(await byAlt("loose")).id}`;
    expect(scopeAudits).toHaveLength(1);
  });

  it("reports unmapped images and publication blockers", async () => {
    await options.addImages(owner, PRODUCT, [photo("loose")]);
    const located = await media.locate(owner, NAME);
    if (!located.ok) throw new Error("not located");
    expect(media.mappingView(located)).toMatchObject({
      unmapped: [1],
      canPublishImages: false,
      publicationBlockers: expect.arrayContaining([mappingMessages.unassigned]),
    });
  });

  it("prepares the shared-image choice for a colour and executes it", async () => {
    const run = await confirm(
      await media.prepareSharedImageUse(owner, {
        product: NAME,
        option: "اللون",
        value: "أزرق",
        use: true,
      }),
    );
    expect(await run()).toMatchObject({ ok: true });
    const [value] = await db
      .select()
      .from(schema.productOptionValues)
      .where(eq(schema.productOptionValues.id, ids.blue));
    expect(value!.usesSharedImage).toBe(true);
  });
});
