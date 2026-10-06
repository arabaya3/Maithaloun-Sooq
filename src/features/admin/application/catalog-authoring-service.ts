import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { assertPermission, can } from "@/features/admin/domain/permissions";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import {
  assertSafeAuditState,
  type AuditState,
} from "@/features/admin/domain/audit";
import {
  categoryCodeSchema,
  categoryIconKeys,
  categoryNameSchema,
  type AdminProductCategory,
  type CategoryIconKey,
} from "@/features/catalog/domain/category";
import {
  placeholderKinds,
  productPublicationValues,
  productSlugSchema,
  type ProductPublication,
} from "@/features/catalog/domain/product";
import { variantAttributesSchema } from "@/features/catalog/domain/product-variant";
import { sellingUnitMessages } from "@/features/catalog/domain/selling-unit";
import { postStockAdjustment } from "@/features/inventory/application/inventory-service";
import type { Database } from "@/features/inventory/application/stock-ledger";
import {
  mappingMessages,
  mappingProblems,
  structureProblems,
  type StructureProblem,
} from "@/features/catalog/domain/product-media-validation";
import { incompleteProductIds } from "@/features/catalog/infrastructure/product-structure";
import * as schema from "@/server/db/schema";

import {
  activeGallery,
  addGalleryImage,
  structureInputFor,
  renumber,
  syncImageMirrors,
} from "./gallery-store";

export type CatalogAuthoringErrorCode =
  | "not_found"
  | "invalid_input"
  | "duplicate_sku"
  | "duplicate_barcode"
  | "duplicate_slug"
  | "duplicate_variant"
  | "duplicate_category"
  | "category_not_empty"
  | "category_has_offers"
  | "category_unavailable"
  | "in_use"
  | "default_variant"
  | "stock_on_hand"
  | "not_publishable"
  | "breaks_published"
  | "stale";

// Edits of a published product that could show or sell a different variant than the customer picked.
const LIVE_BLOCKERS: ReadonlySet<StructureProblem["code"]> = new Set([
  "no_default_variant",
  "archived_value",
  "duplicate_combination",
  "primary_not_shared",
]);

export class CatalogAuthoringError extends Error {
  constructor(
    readonly code: CatalogAuthoringErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "CatalogAuthoringError";
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ProductRow = typeof schema.products.$inferSelect;
type VariantRow = typeof schema.productVariants.$inferSelect;

const identifier = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);

export const productDraftSchema = z
  .object({
    nameAr: z.string().trim().min(2).max(160),
    latinName: z.string().trim().min(1).max(120).nullable(),
    categoryCode: categoryCodeSchema,
    description: z.string().trim().max(4_000).nullable(),
    unit: z.string().trim().max(80).nullable(),
    priceAgorot: z.number().int().positive().max(10_000_000),
    publication: z.enum(productPublicationValues),
    availability: z.enum(["available", "unavailable"]),
    variantLabel: z.string().trim().min(1).max(120),
    attributes: z.record(z.string(), z.string()),
    sku: identifier.nullable(),
    barcode: identifier.nullable(),
    specifications: z
      .array(
        z
          .object({
            labelAr: z.string().trim().min(1).max(80),
            valueAr: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(12),
    image: z
      .object({
        src: z.string().min(1).max(500),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        alt: z.string().trim().min(1).max(250),
      })
      .strict()
      .nullable(),
    openingStock: z
      .object({
        quantityMilli: z.number().int().positive(),
        unitCostAgorot: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ProductDraft = z.infer<typeof productDraftSchema>;

export const productFieldChangesSchema = z
  .object({
    slug: productSlugSchema.max(120).optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    usageNotes: z.string().trim().max(4_000).nullable().optional(),
    imageAlt: z.string().trim().min(1).max(250).optional(),
  })
  .strict();

export const variantInputSchema = z
  .object({
    labelAr: z.string().trim().min(1).max(120),
    attributes: z.record(z.string(), z.string()),
    priceAgorot: z.number().int().positive().max(10_000_000),
    availability: z.enum(["available", "unavailable"]),
    sku: identifier.nullable(),
    barcode: identifier.nullable(),
  })
  .strict();
export type VariantInput = z.infer<typeof variantInputSchema>;

export const variantChangesSchema = variantInputSchema.partial().strict();

export interface DuplicateCandidate {
  productId: string;
  label: string;
  reasons: string[];
  href: string;
}

/** The step of the product flow (spec §8) a publishing problem belongs to. */
export type ReadinessStep =
  "identity" | "variants" | "images" | "selling_units";

export interface PublicationCheck {
  ready: boolean;
  problems: string[];
  /** The same problems, each tagged with the step that fixes it. */
  issues: Array<{ step: ReadinessStep; message: string }>;
  acceptedPlaceholder: boolean;
}

export interface VariantReferences {
  orders: number;
  purchases: number;
  sales: number;
  stockMovements: number;
  onHandMilli: number;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function attributesKey(attributes: Record<string, string>) {
  return Object.entries(attributes)
    .map(([key, value]) => [normalize(key), normalize(value)])
    .filter(([key, value]) => key && value)
    .sort(([left], [right]) => left!.localeCompare(right!))
    .map((pair) => pair.join("="))
    .join("|");
}

function slugFrom(latinName: string | null, fallback: string) {
  const base = (latinName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base ? `${base}-${fallback.slice(-6)}` : fallback;
}

// The stock ledger keys adjustments by UUID; this derives a stable one from the confirmation.
function derivedUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

function isForeignKeyViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23503"
  );
}

export class CatalogAuthoringService {
  constructor(private readonly database: Database) {}

  // SKU and barcode uniqueness is checked again under this lock so two confirmations cannot race.
  async lockIdentifiers(transaction: Transaction) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('catalog-identifiers'))`,
    );
  }

  async assertIdentifiersFree(
    executor: Database | Transaction,
    input: { sku: string | null; barcode: string | null },
    exceptVariantId?: string,
  ) {
    const checks: Array<["sku" | "barcode", string]> = [];
    if (input.sku) checks.push(["sku", input.sku]);
    if (input.barcode) checks.push(["barcode", input.barcode]);
    for (const [column, value] of checks) {
      const field =
        column === "sku"
          ? schema.productVariants.sku
          : schema.productVariants.barcode;
      const [clash] = await executor
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(
          and(
            sql`lower(${field}) = lower(${value})`,
            isNull(schema.productVariants.archivedAt),
            exceptVariantId
              ? ne(schema.productVariants.domainId, exceptVariantId)
              : undefined,
          ),
        )
        .limit(1);
      // A selling unit's SKU or barcode is taken too: one code names one thing on the shelf.
      const unitField =
        column === "sku"
          ? schema.productSellingUnits.sku
          : schema.productSellingUnits.barcode;
      const [unitClash] = await executor
        .select({ id: schema.productSellingUnits.id })
        .from(schema.productSellingUnits)
        .where(
          and(
            sql`lower(${unitField}) = lower(${value})`,
            isNull(schema.productSellingUnits.archivedAt),
          ),
        )
        .limit(1);
      if (clash || unitClash) {
        throw new CatalogAuthoringError(
          column === "sku" ? "duplicate_sku" : "duplicate_barcode",
          value,
        );
      }
    }
  }

  async identifierClash(input: {
    sku: string | null;
    barcode: string | null;
    exceptVariantId?: string;
  }): Promise<CatalogAuthoringErrorCode | null> {
    try {
      await this.assertIdentifiersFree(
        this.database,
        input,
        input.exceptVariantId,
      );
      return null;
    } catch (error) {
      if (error instanceof CatalogAuthoringError) return error.code;
      throw error;
    }
  }

  async slugTaken(slug: string, exceptDomainId?: string): Promise<boolean> {
    const [row] = await this.database
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.slug, slug),
          exceptDomainId
            ? ne(schema.products.domainId, exceptDomainId)
            : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async findDuplicates(input: {
    nameAr?: string | null;
    latinName?: string | null;
    barcode?: string | null;
    sku?: string | null;
    size?: string | null;
  }): Promise<DuplicateCandidate[]> {
    const rows = await this.database
      .select({
        domainId: schema.products.domainId,
        nameAr: schema.products.nameAr,
        latinName: schema.products.latinName,
        archivedAt: schema.products.archivedAt,
        variantLabel: schema.productVariants.labelAr,
        attributes: schema.productVariants.attributes,
        sku: schema.productVariants.sku,
        barcode: schema.productVariants.barcode,
      })
      .from(schema.products)
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.productId, schema.products.id),
      )
      .where(
        and(
          isNull(schema.products.mergedIntoProductId),
          isNull(schema.productVariants.archivedAt),
        ),
      );
    const name = normalize(input.nameAr ?? "");
    const latin = normalize(input.latinName ?? "");
    const size = normalize(input.size ?? "");
    const found = new Map<string, DuplicateCandidate>();
    for (const row of rows) {
      const reasons: string[] = [];
      if (
        input.barcode &&
        row.barcode &&
        row.barcode === input.barcode.trim()
      ) {
        reasons.push("نفس الباركود");
      }
      if (
        input.sku &&
        row.sku &&
        row.sku.toLowerCase() === input.sku.trim().toLowerCase()
      ) {
        reasons.push("نفس SKU");
      }
      const rowName = normalize(row.nameAr);
      // Two known, different brands are different products even when the Arabic names overlap.
      const differentBrand = Boolean(
        latin && row.latinName && normalize(row.latinName) !== latin,
      );
      const similarName =
        rowName === name ||
        (name.length >= 6 &&
          (rowName.includes(name) || name.includes(rowName)));
      if (name && rowName && similarName && !differentBrand) {
        reasons.push("اسم مشابه");
      }
      if (latin && row.latinName && normalize(row.latinName) === latin) {
        if (
          !size ||
          normalize(
            `${row.variantLabel} ${Object.values(row.attributes ?? {}).join(" ")}`,
          ).includes(size)
        ) {
          reasons.push("نفس الماركة");
        }
      }
      if (!reasons.length) continue;
      const existing = found.get(row.domainId);
      const label = `${row.nameAr}${row.latinName ? ` ${row.latinName}` : ""}${row.archivedAt ? " (مؤرشف)" : ""}`;
      found.set(row.domainId, {
        productId: row.domainId,
        label,
        reasons: [...new Set([...(existing?.reasons ?? []), ...reasons])],
        href: `/admin/products/${row.domainId}`,
      });
    }
    return [...found.values()]
      .sort((left, right) => right.reasons.length - left.reasons.length)
      .slice(0, 6);
  }

  async createProduct(
    actor: AdminActor,
    input: ProductDraft,
    idempotencyKey: string,
  ): Promise<{ domainId: string; variantId: string; replayed: boolean }> {
    assertPermission(actor, "settings.manage");
    const draft = productDraftSchema.parse(input);
    if (draft.openingStock) assertPermission(actor, "stock.adjust");
    const attributes = variantAttributesSchema.parse(draft.attributes);
    // Audit rows may not hold idempotency keys, so a one-way reference marks the creating confirmation.
    const replayRef = createHash("sha256")
      .update(`product_create:${idempotencyKey}`)
      .digest("hex")
      .slice(0, 32);
    try {
      return await this.database.transaction(async (transaction) => {
        const created = await this.createProductIn(
          transaction,
          actor,
          draft,
          attributes,
          replayRef,
          idempotencyKey,
        );
        if (!created.replayed) {
          await this.assertPublishable(transaction, {
            domainId: created.domainId,
          });
        }
        return created;
      });
    } catch (error) {
      if (error instanceof CatalogAuthoringError) throw error;
      if (isUniqueViolation(error))
        throw new CatalogAuthoringError("duplicate_slug");
      throw error;
    }
  }

  // Runs inside the caller's transaction so a product can be created together with its options and variants.
  async createProductIn(
    transaction: Transaction,
    actor: AdminActor,
    draft: ProductDraft,
    attributes: Record<string, string>,
    replayRef: string,
    idempotencyKey: string,
  ): Promise<{ domainId: string; variantId: string; replayed: boolean }> {
    const [replay] = await transaction
      .select({ entityId: schema.adminAuditEvents.entityId })
      .from(schema.adminAuditEvents)
      .where(
        and(
          eq(schema.adminAuditEvents.actionType, "product_create"),
          sql`${schema.adminAuditEvents.afterState}->>'replayRef' = ${replayRef}`,
        ),
      )
      .limit(1);
    if (replay) {
      return {
        domainId: replay.entityId,
        variantId: `${replay.entityId}--default`,
        replayed: true,
      };
    }
    await this.lockIdentifiers(transaction);
    await this.assertIdentifiersFree(transaction, draft);
    await this.assertCategoryUsable(transaction, draft.categoryCode);

    const domainId = `p-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const slug = slugFrom(draft.latinName, domainId);
    const image = draft.image
      ? {
          imageKind: "image" as const,
          placeholderVariant: null,
          imageSrc: draft.image.src,
          imageAlt: draft.image.alt,
          imageWidth: draft.image.width,
          imageHeight: draft.image.height,
        }
      : {
          imageKind: "placeholder" as const,
          placeholderVariant: placeholderKinds[0],
          imageSrc: null,
          imageAlt: null,
          imageWidth: null,
          imageHeight: null,
        };
    const [product] = await transaction
      .insert(schema.products)
      .values({
        domainId,
        slug,
        nameAr: draft.nameAr,
        latinName: draft.latinName,
        priceAgorot: draft.priceAgorot,
        sortOrder: 100,
        categoryId: draft.categoryCode,
        availability: draft.availability,
        publication: draft.publication,
        description: draft.description || null,
        unit: draft.unit || null,
        detailsStatus: "placeholder",
        ...image,
      })
      .returning();
    if (!product) throw new CatalogAuthoringError("invalid_input");
    const [variant] = await transaction
      .insert(schema.productVariants)
      .values({
        productId: product.id,
        domainId: `${domainId}--default`,
        labelAr: draft.variantLabel,
        attributes,
        priceAgorot: draft.priceAgorot,
        availability: draft.availability,
        sku: draft.sku,
        barcode: draft.barcode,
        sortOrder: 0,
        isDefault: true,
        ...image,
      })
      .returning();
    if (!variant) throw new CatalogAuthoringError("invalid_input");
    if (draft.image) {
      await addGalleryImage(transaction, product.id, {
        ...draft.image,
        primary: true,
      });
    }
    if (draft.specifications.length) {
      await transaction.insert(schema.productSpecifications).values(
        draft.specifications.map((item, sortOrder) => ({
          productId: product.id,
          ...item,
          sortOrder,
        })),
      );
    }
    const afterState = {
      replayRef,
      nameAr: product.nameAr,
      categoryId: product.categoryId,
      publication: product.publication,
      availability: product.availability,
      priceAgorot: product.priceAgorot,
      source: "assistant",
    };
    assertSafeAuditState(afterState);
    await transaction.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType: "product_create",
      entityType: "product",
      entityId: domainId,
      beforeState: null,
      afterState,
    });
    if (draft.openingStock) {
      await postStockAdjustment(transaction, actor, {
        idempotencyKey: derivedUuid(`opening:${idempotencyKey}`),
        variantId: variant.domainId,
        reason: "opening_balance",
        quantityMilli: draft.openingStock.quantityMilli,
        unitCostAgorot: draft.openingStock.unitCostAgorot,
        note: "رصيد افتتاحي عند إضافة المنتج",
      });
    }
    return { domainId, variantId: variant.domainId, replayed: false };
  }

  private async lockProduct(transaction: Transaction, domainId: string) {
    const [product] = await transaction
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, domainId))
      .for("update");
    if (!product || product.mergedIntoProductId) {
      throw new CatalogAuthoringError("not_found");
    }
    return product;
  }

  private async audit(
    transaction: Transaction,
    actor: AdminActor,
    event: {
      actionType: string;
      entityType: string;
      entityId: string;
      beforeState: AuditState | null;
      afterState: AuditState;
    },
  ) {
    if (event.beforeState) assertSafeAuditState(event.beforeState);
    assertSafeAuditState(event.afterState);
    await transaction.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      ...event,
    });
    if (event.entityType === "product") {
      await this.assertLiveSafe(transaction, { domainId: event.entityId });
    } else if (event.entityType === "product_variant") {
      const [variant] = await transaction
        .select({ productId: schema.productVariants.productId })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.domainId, event.entityId))
        .limit(1);
      if (variant)
        await this.assertLiveSafe(transaction, { id: variant.productId });
    }
  }

  async updateProductFields(
    actor: AdminActor,
    domainId: string,
    input: z.infer<typeof productFieldChangesSchema>,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    const changes = productFieldChangesSchema.parse(input);
    try {
      await this.database.transaction(async (transaction) => {
        const product = await this.lockProduct(transaction, domainId);
        if (changes.imageAlt !== undefined && product.imageKind !== "image") {
          throw new CatalogAuthoringError("invalid_input");
        }
        const now = new Date();
        const patch = {
          ...(changes.slug !== undefined ? { slug: changes.slug } : {}),
          ...(changes.sortOrder !== undefined
            ? { sortOrder: changes.sortOrder }
            : {}),
          ...(changes.usageNotes !== undefined
            ? { usageNotes: changes.usageNotes || null }
            : {}),
          ...(changes.imageAlt !== undefined
            ? { imageAlt: changes.imageAlt }
            : {}),
        };
        await transaction
          .update(schema.products)
          .set({ ...patch, updatedAt: now })
          .where(eq(schema.products.id, product.id));
        if (changes.imageAlt !== undefined) {
          await transaction
            .update(schema.productVariants)
            .set({ imageAlt: changes.imageAlt, updatedAt: now })
            .where(
              and(
                eq(schema.productVariants.productId, product.id),
                eq(schema.productVariants.isDefault, true),
                eq(schema.productVariants.imageKind, "image"),
              ),
            );
        }
        await this.audit(transaction, actor, {
          actionType: "product_update",
          entityType: "product",
          entityId: product.domainId,
          beforeState: {
            slug: product.slug,
            sortOrder: product.sortOrder,
            hasUsageNotes: Boolean(product.usageNotes),
          },
          afterState: {
            slug: patch.slug ?? product.slug,
            sortOrder: patch.sortOrder ?? product.sortOrder,
            fields: Object.keys(patch).join(","),
          },
        });
      });
    } catch (error) {
      if (error instanceof CatalogAuthoringError) throw error;
      if (isUniqueViolation(error))
        throw new CatalogAuthoringError("duplicate_slug");
      throw error;
    }
  }

  // Any write that leaves a product published must leave it publishable; otherwise the whole write rolls back.
  private async productFor(
    transaction: Transaction,
    key: { id: string } | { domainId: string },
  ) {
    const [product] = await transaction
      .select()
      .from(schema.products)
      .where(
        "id" in key
          ? eq(schema.products.id, key.id)
          : eq(schema.products.domainId, key.domainId),
      )
      .limit(1);
    return product ?? null;
  }

  // Creating a product as published runs the same check as publishing it.
  async assertPublishable(
    transaction: Transaction,
    key: { id: string } | { domainId: string },
  ): Promise<void> {
    const product = await this.productFor(transaction, key);
    if (!product || product.publication !== "published") return;
    const check = await this.checkPublishable(transaction, product);
    if (!check.ready) {
      throw new CatalogAuthoringError(
        "not_publishable",
        check.problems.join(" "),
      );
    }
  }

  // Editing a live product may pass through incomplete states, but never one that shows or sells the wrong variant.
  async assertLiveSafe(
    transaction: Transaction,
    key: { id: string } | { domainId: string },
  ): Promise<void> {
    const product = await this.productFor(transaction, key);
    if (!product || product.publication !== "published") return;
    const problems = structureProblems(
      await structureInputFor(transaction, product.id),
    ).filter((problem) => LIVE_BLOCKERS.has(problem.code));
    if (problems.length) {
      throw new CatalogAuthoringError(
        "breaks_published",
        [...new Set(problems.map((problem) => problem.message))].join(" "),
      );
    }
  }

  /** Products, by domain id, whose live variants cannot each name one exact choice (one batched check). */
  // Without ids it checks every live product, so a list page can run it alongside its own query.
  async incompleteDomainIds(
    domainIds?: readonly string[],
  ): Promise<Set<string>> {
    if (domainIds && !domainIds.length) return new Set();
    const rows = await this.database
      .select({ id: schema.products.id, domainId: schema.products.domainId })
      .from(schema.products)
      .where(
        domainIds
          ? inArray(schema.products.domainId, [...domainIds])
          : isNull(schema.products.archivedAt),
      );
    const incomplete = await incompleteProductIds(
      this.database,
      rows.map((row) => row.id),
    );
    return new Set(
      rows.filter((row) => incomplete.has(row.id)).map((row) => row.domainId),
    );
  }

  async publicationCheck(
    domainId: string,
    availability?: "available" | "unavailable",
  ): Promise<PublicationCheck | null> {
    const [product] = await this.database
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, domainId))
      .limit(1);
    if (!product) return null;
    return this.checkPublishable(this.database, product, availability);
  }

  private async checkPublishable(
    executor: Database | Transaction,
    product: ProductRow,
    /** Publishing with an availability also sets the default variant to it, so judge it as it will be. */
    availability?: "available" | "unavailable",
  ): Promise<PublicationCheck> {
    const issues: PublicationCheck["issues"] = [];
    const add = (step: ReadinessStep, message: string) => {
      if (!issues.some((issue) => issue.message === message)) {
        issues.push({ step, message });
      }
    };
    if (product.nameAr.trim().length < 2)
      add("identity", "اسم المنتج غير صالح.");
    if (product.priceAgorot <= 0) add("identity", "لا يوجد سعر بيع.");
    const variants = await executor
      .select()
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.productId, product.id),
          isNull(schema.productVariants.archivedAt),
        ),
      );
    if (!variants.length) add("variants", "لا يوجد صنف صالح للبيع.");
    if (!variants.some((variant) => variant.priceAgorot > 0)) {
      add("variants", "لا يوجد صنف له سعر بيع.");
    }
    if (variants.length) {
      const sellable = await executor
        .selectDistinct({ variantId: schema.productSellingUnits.variantId })
        .from(schema.productSellingUnits)
        .where(
          and(
            inArray(
              schema.productSellingUnits.variantId,
              variants.map((variant) => variant.id),
            ),
            isNull(schema.productSellingUnits.archivedAt),
          ),
        );
      const withUnits = new Set(sellable.map((row) => row.variantId));
      for (const variant of variants) {
        if (!withUnits.has(variant.id)) {
          add(
            "selling_units",
            `«${variant.labelAr}»: ${sellingUnitMessages.required}`,
          );
        }
      }
    }
    const [category] = await executor
      .select({
        archivedAt: schema.productCategories.archivedAt,
      })
      .from(schema.productCategories)
      .where(eq(schema.productCategories.code, product.categoryId))
      .limit(1);
    if (!category || category.archivedAt)
      add("identity", "القسم غير صالح أو مؤرشف.");
    if (product.archivedAt) add("identity", "المنتج مؤرشف؛ استرجعيه أولاً.");
    // Publishing is stricter than saving a draft: every image must say which colour, scent or variant it shows.
    const loaded = await structureInputFor(executor as Transaction, product.id);
    const structure =
      availability && availability !== product.availability
        ? {
            ...loaded,
            variants: loaded.variants.map((variant) =>
              variant.isDefault
                ? { ...variant, available: availability === "available" }
                : variant,
            ),
          }
        : loaded;
    const mapping = mappingProblems(structure);
    if (mapping.length) {
      add("images", mappingMessages.blocked);
      for (const problem of mapping) add("images", problem.message);
    }
    // The storefront must open on a real, buyable variant whose choices lead to exactly one variant.
    for (const problem of structureProblems(structure)) {
      add(
        problem.code === "primary_not_shared" ? "images" : "variants",
        problem.message,
      );
    }
    return {
      ready: issues.length === 0,
      problems: issues.map((issue) => issue.message),
      issues,
      acceptedPlaceholder: product.imageKind === "placeholder",
    };
  }

  async setPublication(
    actor: AdminActor,
    input: {
      domainId: string;
      publication: ProductPublication;
      availability?: "available" | "unavailable";
      acceptPlaceholder: boolean;
    },
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const product = await this.lockProduct(transaction, input.domainId);
      if (input.publication === "published") {
        const check = await this.checkPublishable(
          transaction,
          product,
          input.availability,
        );
        if (!check.ready) {
          throw new CatalogAuthoringError(
            "not_publishable",
            check.problems.join(" "),
          );
        }
        if (check.acceptedPlaceholder && !input.acceptPlaceholder) {
          throw new CatalogAuthoringError("not_publishable", "placeholder");
        }
      }
      const availability = input.availability ?? product.availability;
      const now = new Date();
      await transaction
        .update(schema.products)
        .set({ publication: input.publication, availability, updatedAt: now })
        .where(eq(schema.products.id, product.id));
      if (availability !== product.availability) {
        await transaction
          .update(schema.productVariants)
          .set({ availability, updatedAt: now })
          .where(
            and(
              eq(schema.productVariants.productId, product.id),
              eq(schema.productVariants.isDefault, true),
            ),
          );
      }
      await this.audit(transaction, actor, {
        actionType: "product_publication",
        entityType: "product",
        entityId: product.domainId,
        beforeState: {
          publication: product.publication,
          availability: product.availability,
        },
        afterState: { publication: input.publication, availability },
      });
    });
  }

  async restoreProduct(actor: AdminActor, domainId: string): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const product = await this.lockProduct(transaction, domainId);
      if (!product.archivedAt) return;
      await this.assertCategoryUsable(transaction, product.categoryId);
      await transaction
        .update(schema.products)
        .set({ archivedAt: null, publication: "hidden", updatedAt: new Date() })
        .where(eq(schema.products.id, product.id));
      await this.audit(transaction, actor, {
        actionType: "product_restore",
        entityType: "product",
        entityId: product.domainId,
        beforeState: { archived: true },
        afterState: { archived: false, publication: "hidden" },
      });
    });
  }

  async removeProductImage(actor: AdminActor, domainId: string): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const product = await this.lockProduct(transaction, domainId);
      if (product.imageKind !== "image") return;
      // Removing the main image archives it in the gallery; the next image, if any, becomes primary.
      await transaction
        .update(schema.productImages)
        .set({
          isPrimary: false,
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.productImages.productId, product.id),
            eq(schema.productImages.isPrimary, true),
          ),
        );
      const [next] = await activeGallery(transaction, product.id);
      if (next) {
        await transaction
          .update(schema.productImages)
          .set({ isPrimary: true })
          .where(eq(schema.productImages.id, next.id));
      }
      await renumber(transaction, product.id);
      await syncImageMirrors(transaction, product.id);
      await this.audit(transaction, actor, {
        actionType: "product_image_update",
        entityType: "product",
        entityId: product.domainId,
        beforeState: { imageSrc: product.imageSrc },
        afterState: { imageSrc: null },
      });
    });
  }

  async variantReferences(
    variantDomainId: string,
  ): Promise<VariantReferences | null> {
    const [variant] = await this.database
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.domainId, variantDomainId))
      .limit(1);
    if (!variant) return null;
    const total = async (query: Promise<Array<{ value: number }>>) =>
      Number((await query)[0]?.value ?? 0);
    const [orders, purchases, sales, stockMovements, onHand] =
      await Promise.all([
        total(
          this.database
            .select({ value: count() })
            .from(schema.orderItems)
            .where(eq(schema.orderItems.variantDomainId, variantDomainId)),
        ),
        total(
          this.database
            .select({ value: count() })
            .from(schema.purchaseInvoiceItems)
            .where(eq(schema.purchaseInvoiceItems.variantId, variant.id)),
        ),
        total(
          this.database
            .select({ value: count() })
            .from(schema.customerInvoiceLines)
            .where(eq(schema.customerInvoiceLines.variantId, variant.id)),
        ),
        total(
          this.database
            .select({ value: count() })
            .from(schema.stockMovements)
            .innerJoin(
              schema.inventoryItems,
              eq(
                schema.inventoryItems.id,
                schema.stockMovements.inventoryItemId,
              ),
            )
            .where(eq(schema.inventoryItems.variantId, variant.id)),
        ),
        total(
          this.database
            .select({
              value: sql<number>`coalesce(sum(${schema.inventoryItems.onHandMilli}), 0)`,
            })
            .from(schema.inventoryItems)
            .where(eq(schema.inventoryItems.variantId, variant.id)),
        ),
      ]);
    return { orders, purchases, sales, stockMovements, onHandMilli: onHand };
  }

  private async assertNoDuplicateVariant(
    transaction: Transaction,
    productId: string,
    input: { labelAr: string; attributes: Record<string, string> },
    exceptVariantId?: string,
  ) {
    const siblings = await transaction
      .select()
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.productId, productId),
          isNull(schema.productVariants.archivedAt),
        ),
      );
    const label = normalize(input.labelAr);
    const key = attributesKey(input.attributes);
    const clash = siblings.find(
      (row) =>
        row.domainId !== exceptVariantId &&
        (normalize(row.labelAr) === label ||
          (key && attributesKey(row.attributes ?? {}) === key)),
    );
    if (clash)
      throw new CatalogAuthoringError("duplicate_variant", clash.labelAr);
  }

  async createVariant(
    actor: AdminActor,
    productDomainId: string,
    input: VariantInput,
  ): Promise<{ variantId: string }> {
    assertPermission(actor, "settings.manage");
    const data = variantInputSchema.parse(input);
    const attributes = variantAttributesSchema.parse(data.attributes);
    return this.database.transaction(async (transaction) => {
      const product = await this.lockProduct(transaction, productDomainId);
      await this.lockIdentifiers(transaction);
      await this.assertIdentifiersFree(transaction, data);
      await this.assertNoDuplicateVariant(transaction, product.id, data);
      const [{ next } = { next: 0 }] = await transaction
        .select({
          next: sql<number>`coalesce(max(${schema.productVariants.sortOrder}), -1) + 1`,
        })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.productId, product.id));
      const variantId = `${product.domainId}--v${randomUUID().slice(0, 6)}`;
      const image =
        product.imageKind === "image"
          ? {
              imageKind: "image" as const,
              placeholderVariant: null,
              imageSrc: product.imageSrc,
              imageAlt: product.imageAlt,
              imageWidth: product.imageWidth,
              imageHeight: product.imageHeight,
            }
          : {
              imageKind: "placeholder" as const,
              placeholderVariant:
                product.placeholderVariant ?? placeholderKinds[0],
              imageSrc: null,
              imageAlt: null,
              imageWidth: null,
              imageHeight: null,
            };
      await transaction.insert(schema.productVariants).values({
        productId: product.id,
        domainId: variantId,
        labelAr: data.labelAr,
        attributes,
        priceAgorot: data.priceAgorot,
        availability: data.availability,
        sku: data.sku,
        barcode: data.barcode,
        sortOrder: Number(next),
        isDefault: false,
        ...image,
      });
      await transaction
        .update(schema.products)
        .set({ updatedAt: new Date() })
        .where(eq(schema.products.id, product.id));
      await this.audit(transaction, actor, {
        actionType: "product_variant_create",
        entityType: "product_variant",
        entityId: variantId,
        beforeState: null,
        afterState: {
          labelAr: data.labelAr,
          priceAgorot: data.priceAgorot,
          availability: data.availability,
        },
      });
      return { variantId };
    });
  }

  private async lockVariant(transaction: Transaction, variantDomainId: string) {
    const [variant] = await transaction
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.domainId, variantDomainId))
      .for("update");
    if (!variant) throw new CatalogAuthoringError("not_found");
    const [product] = await transaction
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, variant.productId))
      .for("update");
    if (!product) throw new CatalogAuthoringError("not_found");
    return { variant, product };
  }

  private async touchProductFromDefault(
    transaction: Transaction,
    product: ProductRow,
    variant: VariantRow,
  ) {
    await transaction
      .update(schema.products)
      .set(
        variant.isDefault
          ? {
              priceAgorot: variant.priceAgorot,
              availability: variant.availability,
              updatedAt: new Date(),
            }
          : { updatedAt: new Date() },
      )
      .where(eq(schema.products.id, product.id));
  }

  async updateVariant(
    actor: AdminActor,
    variantDomainId: string,
    input: z.infer<typeof variantChangesSchema>,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    const changes = variantChangesSchema.parse(input);
    await this.database.transaction(async (transaction) => {
      const { variant, product } = await this.lockVariant(
        transaction,
        variantDomainId,
      );
      if (variant.archivedAt) throw new CatalogAuthoringError("not_found");
      const next = {
        labelAr: changes.labelAr ?? variant.labelAr,
        attributes: changes.attributes
          ? variantAttributesSchema.parse(changes.attributes)
          : (variant.attributes ?? {}),
      };
      if (changes.labelAr !== undefined || changes.attributes !== undefined) {
        await this.assertNoDuplicateVariant(
          transaction,
          product.id,
          next,
          variant.domainId,
        );
      }
      if (changes.sku !== undefined || changes.barcode !== undefined) {
        await this.lockIdentifiers(transaction);
        await this.assertIdentifiersFree(
          transaction,
          {
            sku: changes.sku === undefined ? null : changes.sku,
            barcode: changes.barcode === undefined ? null : changes.barcode,
          },
          variant.domainId,
        );
      }
      const [saved] = await transaction
        .update(schema.productVariants)
        .set({
          ...next,
          ...(changes.priceAgorot !== undefined
            ? { priceAgorot: changes.priceAgorot }
            : {}),
          ...(changes.availability !== undefined
            ? { availability: changes.availability }
            : {}),
          ...(changes.sku !== undefined ? { sku: changes.sku } : {}),
          ...(changes.barcode !== undefined
            ? { barcode: changes.barcode }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.productVariants.id, variant.id))
        .returning();
      if (!saved) throw new CatalogAuthoringError("not_found");
      await this.touchProductFromDefault(transaction, product, saved);
      await this.audit(transaction, actor, {
        actionType: "product_variant_update",
        entityType: "product_variant",
        entityId: variant.domainId,
        beforeState: {
          labelAr: variant.labelAr,
          priceAgorot: variant.priceAgorot,
          availability: variant.availability,
        },
        afterState: {
          labelAr: saved.labelAr,
          priceAgorot: saved.priceAgorot,
          availability: saved.availability,
          fields: Object.keys(changes).join(","),
        },
      });
    });
  }

  async setDefaultVariant(
    actor: AdminActor,
    variantDomainId: string,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { variant, product } = await this.lockVariant(
        transaction,
        variantDomainId,
      );
      if (variant.archivedAt) throw new CatalogAuthoringError("not_found");
      if (variant.isDefault) return;
      await transaction
        .update(schema.productVariants)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.productVariants.productId, product.id));
      const [saved] = await transaction
        .update(schema.productVariants)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(schema.productVariants.id, variant.id))
        .returning();
      await transaction
        .update(schema.products)
        .set({
          priceAgorot: saved!.priceAgorot,
          availability: saved!.availability,
          imageKind: saved!.imageKind,
          placeholderVariant: saved!.placeholderVariant,
          imageSrc: saved!.imageSrc,
          imageAlt: saved!.imageAlt,
          imageWidth: saved!.imageWidth,
          imageHeight: saved!.imageHeight,
          updatedAt: new Date(),
        })
        .where(eq(schema.products.id, product.id));
      await this.audit(transaction, actor, {
        actionType: "product_variant_default",
        entityType: "product_variant",
        entityId: variant.domainId,
        beforeState: { isDefault: false },
        afterState: { isDefault: true },
      });
    });
  }

  async setVariantImage(
    actor: AdminActor,
    variantDomainId: string,
    image: { src: string; width: number; height: number; alt: string },
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { variant, product } = await this.lockVariant(
        transaction,
        variantDomainId,
      );
      // The new photo becomes the variant's own gallery image; earlier own images stay in the gallery, unassigned.
      await transaction
        .update(schema.productImages)
        .set({ variantId: null, updatedAt: new Date() })
        .where(eq(schema.productImages.variantId, variant.id));
      await addGalleryImage(transaction, product.id, {
        ...image,
        variantId: variant.id,
        primary: variant.isDefault,
      });
      await syncImageMirrors(transaction, product.id);
      await this.audit(transaction, actor, {
        actionType: "product_variant_image",
        entityType: "product_variant",
        entityId: variant.domainId,
        beforeState: { imageSrc: variant.imageSrc },
        afterState: { imageSrc: image.src },
      });
    });
  }

  async archiveVariant(
    actor: AdminActor,
    variantDomainId: string,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { variant, product } = await this.lockVariant(
        transaction,
        variantDomainId,
      );
      if (variant.archivedAt) return;
      if (variant.isDefault) throw new CatalogAuthoringError("default_variant");
      const [stock] = await transaction
        .select({
          onHand: sql<number>`coalesce(sum(${schema.inventoryItems.onHandMilli}), 0)`,
        })
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.variantId, variant.id));
      if (Number(stock?.onHand ?? 0) !== 0) {
        throw new CatalogAuthoringError("stock_on_hand");
      }
      const now = new Date();
      await transaction
        .update(schema.productVariants)
        .set({ archivedAt: now, availability: "unavailable", updatedAt: now })
        .where(eq(schema.productVariants.id, variant.id));
      await transaction
        .update(schema.products)
        .set({ updatedAt: now })
        .where(eq(schema.products.id, product.id));
      await this.audit(transaction, actor, {
        actionType: "product_variant_archive",
        entityType: "product_variant",
        entityId: variant.domainId,
        beforeState: { archived: false, availability: variant.availability },
        afterState: { archived: true },
      });
    });
  }

  async restoreVariant(
    actor: AdminActor,
    variantDomainId: string,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { variant, product } = await this.lockVariant(
        transaction,
        variantDomainId,
      );
      if (!variant.archivedAt) return;
      await this.assertNoDuplicateVariant(
        transaction,
        product.id,
        { labelAr: variant.labelAr, attributes: variant.attributes ?? {} },
        variant.domainId,
      );
      await this.lockIdentifiers(transaction);
      await this.assertIdentifiersFree(transaction, variant, variant.domainId);
      const now = new Date();
      await transaction
        .update(schema.productVariants)
        .set({ archivedAt: null, updatedAt: now })
        .where(eq(schema.productVariants.id, variant.id));
      await transaction
        .update(schema.products)
        .set({ updatedAt: now })
        .where(eq(schema.products.id, product.id));
      await this.audit(transaction, actor, {
        actionType: "product_variant_restore",
        entityType: "product_variant",
        entityId: variant.domainId,
        beforeState: { archived: true },
        afterState: { archived: false, availability: variant.availability },
      });
    });
  }

  // Permanent deletion is only for variants nothing historical points to; foreign keys are the final word.
  async deleteUnusedVariant(
    actor: AdminActor,
    variantDomainId: string,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    const references = await this.variantReferences(variantDomainId);
    if (!references) throw new CatalogAuthoringError("not_found");
    if (
      references.orders +
        references.purchases +
        references.sales +
        references.stockMovements >
      0
    ) {
      throw new CatalogAuthoringError("in_use");
    }
    try {
      await this.database.transaction(async (transaction) => {
        const { variant, product } = await this.lockVariant(
          transaction,
          variantDomainId,
        );
        if (variant.isDefault)
          throw new CatalogAuthoringError("default_variant");
        await transaction
          .update(schema.productImages)
          .set({ variantId: null })
          .where(eq(schema.productImages.variantId, variant.id));
        await transaction
          .delete(schema.inventoryItems)
          .where(
            and(
              eq(schema.inventoryItems.variantId, variant.id),
              eq(schema.inventoryItems.onHandMilli, 0),
            ),
          );
        await transaction
          .delete(schema.productVariants)
          .where(eq(schema.productVariants.id, variant.id));
        await transaction
          .update(schema.products)
          .set({ updatedAt: new Date() })
          .where(eq(schema.products.id, product.id));
        await this.audit(transaction, actor, {
          actionType: "product_variant_delete",
          entityType: "product_variant",
          entityId: variant.domainId,
          beforeState: { labelAr: variant.labelAr },
          afterState: { deleted: true },
        });
      });
    } catch (error) {
      if (isForeignKeyViolation(error))
        throw new CatalogAuthoringError("in_use");
      throw error;
    }
  }

  async archivedVariant(variantDomainId: string): Promise<{
    variantId: string;
    productId: string;
    label: string;
    availability: "available" | "unavailable";
  } | null> {
    const [row] = await this.database
      .select({
        variantId: schema.productVariants.domainId,
        labelAr: schema.productVariants.labelAr,
        availability: schema.productVariants.availability,
        archivedAt: schema.productVariants.archivedAt,
        productId: schema.products.domainId,
        nameAr: schema.products.nameAr,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(eq(schema.productVariants.domainId, variantDomainId))
      .limit(1);
    if (!row?.archivedAt) return null;
    return {
      variantId: row.variantId,
      productId: row.productId,
      label: `${row.nameAr} — ${row.labelAr}`,
      availability: row.availability,
    };
  }

  // Archived variants of live products, for restoring one by name; bounded like other assistant lookups.
  async allArchivedVariants(limit = 200) {
    return this.database
      .select({
        productId: schema.products.domainId,
        variantId: schema.productVariants.domainId,
        nameAr: schema.products.nameAr,
        latinName: schema.products.latinName,
        labelAr: schema.productVariants.labelAr,
        sku: schema.productVariants.sku,
        barcode: schema.productVariants.barcode,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(
        and(
          sql`${schema.productVariants.archivedAt} is not null`,
          sql`${schema.products.archivedAt} is null`,
        ),
      )
      .orderBy(desc(schema.productVariants.archivedAt))
      .limit(limit);
  }

  async archivedVariants(productDomainId: string) {
    return this.database
      .select({
        variantId: schema.productVariants.domainId,
        labelAr: schema.productVariants.labelAr,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(
        and(
          eq(schema.products.domainId, productDomainId),
          sql`${schema.productVariants.archivedAt} is not null`,
        ),
      );
  }

  async variantVersion(variantDomainId: string): Promise<string | null> {
    const [row] = await this.database
      .select({
        updatedAt: schema.productVariants.updatedAt,
        archivedAt: schema.productVariants.archivedAt,
        productUpdatedAt: schema.products.updatedAt,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(eq(schema.productVariants.domainId, variantDomainId))
      .limit(1);
    if (!row) return null;
    return `${row.updatedAt.toISOString()}|${row.archivedAt?.toISOString() ?? "-"}|${row.productUpdatedAt.toISOString()}`;
  }

  async productVersion(domainId: string): Promise<string | null> {
    const [row] = await this.database
      .select({
        updatedAt: schema.products.updatedAt,
        archivedAt: schema.products.archivedAt,
        merged: schema.products.mergedIntoProductId,
        publication: schema.products.publication,
      })
      .from(schema.products)
      .where(eq(schema.products.domainId, domainId))
      .limit(1);
    if (!row || row.merged) return null;
    return `${row.updatedAt.toISOString()}|${row.archivedAt?.toISOString() ?? "-"}|${row.publication}`;
  }

  // Categories

  private async assertCategoryUsable(
    executor: Database | Transaction,
    code: string,
  ) {
    const [category] = await executor
      .select({ archivedAt: schema.productCategories.archivedAt })
      .from(schema.productCategories)
      .where(eq(schema.productCategories.code, code))
      .limit(1);
    if (!category || category.archivedAt) {
      throw new CatalogAuthoringError("category_unavailable", code);
    }
  }

  async listCategories(
    includeArchived = false,
  ): Promise<AdminProductCategory[]> {
    const rows = await this.database
      .select({
        category: schema.productCategories,
        productCount: sql<number>`count(${schema.products.id}) filter (where ${schema.products.archivedAt} is null and ${schema.products.mergedIntoProductId} is null)`,
      })
      .from(schema.productCategories)
      .leftJoin(
        schema.products,
        eq(schema.products.categoryId, schema.productCategories.code),
      )
      .where(
        includeArchived
          ? undefined
          : isNull(schema.productCategories.archivedAt),
      )
      .groupBy(schema.productCategories.code)
      .orderBy(
        asc(schema.productCategories.sortOrder),
        asc(schema.productCategories.code),
      );
    return rows.map(({ category, productCount }) => ({
      code: category.code,
      nameAr: category.nameAr,
      description: category.description,
      icon: category.icon as CategoryIconKey,
      sortOrder: category.sortOrder,
      visible: category.visible,
      archived: Boolean(category.archivedAt),
      mergedIntoCode: category.mergedIntoCode,
      productCount: Number(productCount),
      updatedAt: category.updatedAt.toISOString(),
    }));
  }

  async categoryVersion(code: string): Promise<string | null> {
    const [row] = await this.database
      .select({
        updatedAt: schema.productCategories.updatedAt,
        archivedAt: schema.productCategories.archivedAt,
        products: sql<number>`(select count(*) from ${schema.products} where ${schema.products.categoryId} = ${schema.productCategories.code})`,
      })
      .from(schema.productCategories)
      .where(eq(schema.productCategories.code, code))
      .limit(1);
    if (!row) return null;
    return `${row.updatedAt.toISOString()}|${row.archivedAt?.toISOString() ?? "-"}|${row.products}`;
  }

  async categoryNameTaken(
    nameAr: string,
    exceptCode?: string,
  ): Promise<boolean> {
    const [row] = await this.database
      .select({ code: schema.productCategories.code })
      .from(schema.productCategories)
      .where(
        and(
          sql`lower(${schema.productCategories.nameAr}) = lower(${nameAr.trim()})`,
          isNull(schema.productCategories.archivedAt),
          exceptCode
            ? ne(schema.productCategories.code, exceptCode)
            : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async createCategory(
    actor: AdminActor,
    input: {
      code: string;
      nameAr: string;
      description: string | null;
      icon: CategoryIconKey;
      visible: boolean;
    },
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    const code = categoryCodeSchema.parse(input.code);
    const nameAr = categoryNameSchema.parse(input.nameAr);
    const icon = z.enum(categoryIconKeys).parse(input.icon);
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext('catalog-categories'))`,
        );
        const [taken] = await transaction
          .select({ code: schema.productCategories.code })
          .from(schema.productCategories)
          .where(
            or(
              eq(schema.productCategories.code, code),
              and(
                sql`lower(${schema.productCategories.nameAr}) = lower(${nameAr})`,
                isNull(schema.productCategories.archivedAt),
              ),
            ),
          )
          .limit(1);
        if (taken) throw new CatalogAuthoringError("duplicate_category");
        const [{ next } = { next: 0 }] = await transaction
          .select({
            next: sql<number>`coalesce(max(${schema.productCategories.sortOrder}), -1) + 1`,
          })
          .from(schema.productCategories);
        await transaction.insert(schema.productCategories).values({
          code,
          nameAr,
          description: input.description?.trim() || null,
          icon,
          visible: input.visible,
          sortOrder: Number(next),
        });
        await this.audit(transaction, actor, {
          actionType: "category_create",
          entityType: "product_category",
          entityId: code,
          beforeState: null,
          afterState: { nameAr, icon, visible: input.visible },
        });
      });
    } catch (error) {
      if (error instanceof CatalogAuthoringError) throw error;
      if (isUniqueViolation(error))
        throw new CatalogAuthoringError("duplicate_category");
      throw error;
    }
  }

  async updateCategory(
    actor: AdminActor,
    code: string,
    input: {
      nameAr?: string;
      description?: string | null;
      icon?: CategoryIconKey;
      visible?: boolean;
      sortOrder?: number;
    },
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const [category] = await transaction
        .select()
        .from(schema.productCategories)
        .where(eq(schema.productCategories.code, code))
        .for("update");
      if (!category || category.archivedAt)
        throw new CatalogAuthoringError("not_found");
      const patch = {
        ...(input.nameAr !== undefined
          ? { nameAr: categoryNameSchema.parse(input.nameAr) }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.icon !== undefined
          ? { icon: z.enum(categoryIconKeys).parse(input.icon) }
          : {}),
        ...(input.visible !== undefined ? { visible: input.visible } : {}),
        ...(input.sortOrder !== undefined
          ? {
              sortOrder: z
                .number()
                .int()
                .min(0)
                .max(10_000)
                .parse(input.sortOrder),
            }
          : {}),
      };
      if (patch.nameAr) {
        const [taken] = await transaction
          .select({ code: schema.productCategories.code })
          .from(schema.productCategories)
          .where(
            and(
              sql`lower(${schema.productCategories.nameAr}) = lower(${patch.nameAr})`,
              isNull(schema.productCategories.archivedAt),
              ne(schema.productCategories.code, code),
            ),
          )
          .limit(1);
        if (taken) throw new CatalogAuthoringError("duplicate_category");
      }
      await transaction
        .update(schema.productCategories)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.productCategories.code, code));
      await this.audit(transaction, actor, {
        actionType: "category_update",
        entityType: "product_category",
        entityId: code,
        beforeState: {
          nameAr: category.nameAr,
          icon: category.icon,
          visible: category.visible,
          sortOrder: category.sortOrder,
        },
        afterState: { fields: Object.keys(patch).join(",") },
      });
    });
  }

  private async activeProductCount(
    executor: Database | Transaction,
    code: string,
  ) {
    const [row] = await executor
      .select({ value: count() })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.categoryId, code),
          isNull(schema.products.archivedAt),
          isNull(schema.products.mergedIntoProductId),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async categoryUsage(
    code: string,
  ): Promise<{ active: number; total: number } | null> {
    const [category] = await this.database
      .select({ code: schema.productCategories.code })
      .from(schema.productCategories)
      .where(eq(schema.productCategories.code, code))
      .limit(1);
    if (!category) return null;
    const [all] = await this.database
      .select({ value: count() })
      .from(schema.products)
      .where(eq(schema.products.categoryId, code));
    return {
      active: await this.activeProductCount(this.database, code),
      total: Number(all?.value ?? 0),
    };
  }

  async archiveCategory(actor: AdminActor, code: string): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const [category] = await transaction
        .select()
        .from(schema.productCategories)
        .where(eq(schema.productCategories.code, code))
        .for("update");
      if (!category) throw new CatalogAuthoringError("not_found");
      if (category.archivedAt) return;
      if ((await this.activeProductCount(transaction, code)) > 0) {
        throw new CatalogAuthoringError("category_not_empty");
      }
      await transaction
        .update(schema.productCategories)
        .set({ archivedAt: new Date(), visible: false, updatedAt: new Date() })
        .where(eq(schema.productCategories.code, code));
      await this.audit(transaction, actor, {
        actionType: "category_archive",
        entityType: "product_category",
        entityId: code,
        beforeState: { archived: false },
        afterState: { archived: true },
      });
    });
  }

  async restoreCategory(actor: AdminActor, code: string): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const [category] = await transaction
        .select()
        .from(schema.productCategories)
        .where(eq(schema.productCategories.code, code))
        .for("update");
      if (!category) throw new CatalogAuthoringError("not_found");
      if (!category.archivedAt) return;
      if (category.mergedIntoCode)
        throw new CatalogAuthoringError("invalid_input");
      const [taken] = await transaction
        .select({ code: schema.productCategories.code })
        .from(schema.productCategories)
        .where(
          and(
            sql`lower(${schema.productCategories.nameAr}) = lower(${category.nameAr})`,
            isNull(schema.productCategories.archivedAt),
          ),
        )
        .limit(1);
      if (taken) throw new CatalogAuthoringError("duplicate_category");
      await transaction
        .update(schema.productCategories)
        .set({ archivedAt: null, visible: false, updatedAt: new Date() })
        .where(eq(schema.productCategories.code, code));
      await this.audit(transaction, actor, {
        actionType: "category_restore",
        entityType: "product_category",
        entityId: code,
        beforeState: { archived: true },
        afterState: { archived: false, visible: false },
      });
    });
  }

  async moveProducts(
    actor: AdminActor,
    input: { productDomainIds: string[]; targetCode: string },
  ): Promise<{ moved: number }> {
    assertPermission(actor, "settings.manage");
    if (!input.productDomainIds.length || input.productDomainIds.length > 50) {
      throw new CatalogAuthoringError("invalid_input");
    }
    return this.database.transaction(async (transaction) => {
      await this.assertCategoryUsable(transaction, input.targetCode);
      const rows = await transaction
        .select()
        .from(schema.products)
        .where(inArray(schema.products.domainId, input.productDomainIds))
        .for("update");
      if (rows.length !== new Set(input.productDomainIds).size) {
        throw new CatalogAuthoringError("not_found");
      }
      const moving = rows.filter((row) => row.categoryId !== input.targetCode);
      if (moving.length) {
        await transaction
          .update(schema.products)
          .set({ categoryId: input.targetCode, updatedAt: new Date() })
          .where(
            inArray(
              schema.products.id,
              moving.map((row) => row.id),
            ),
          );
      }
      for (const row of moving) {
        await this.audit(transaction, actor, {
          actionType: "product_category_move",
          entityType: "product",
          entityId: row.domainId,
          beforeState: { categoryId: row.categoryId },
          afterState: { categoryId: input.targetCode },
        });
      }
      return { moved: moving.length };
    });
  }

  // Offers name a category by code; moving its products away would silently stop them applying.
  private async assertNoOffersTarget(
    transaction: Transaction,
    code: string,
  ): Promise<void> {
    const [offer] = await transaction
      .select({ nameAr: schema.offers.nameAr })
      .from(schema.offerTargets)
      .innerJoin(
        schema.offers,
        eq(schema.offers.id, schema.offerTargets.offerId),
      )
      .where(
        and(
          eq(schema.offerTargets.categoryCode, code),
          isNull(schema.offers.archivedAt),
        ),
      )
      .limit(1);
    if (offer)
      throw new CatalogAuthoringError("category_has_offers", offer.nameAr);
  }

  /**
   * Moves one active category a step up or down the storefront order. The whole active list is
   * renumbered in steps of 10 so equal or gapped sort orders from before still end in a strict order.
   */
  async moveCategory(
    actor: AdminActor,
    code: string,
    direction: "up" | "down",
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(schema.productCategories)
        .where(isNull(schema.productCategories.archivedAt))
        .orderBy(
          asc(schema.productCategories.sortOrder),
          asc(schema.productCategories.code),
        )
        .for("update");
      const index = rows.findIndex((row) => row.code === code);
      if (index < 0) throw new CatalogAuthoringError("not_found");
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= rows.length) return;
      const order = rows.map((row) => row.code);
      [order[index], order[swapWith]] = [order[swapWith]!, order[index]!];
      const now = new Date();
      for (const [position, rowCode] of order.entries()) {
        const sortOrder = (position + 1) * 10;
        if (rows.find((row) => row.code === rowCode)?.sortOrder === sortOrder)
          continue;
        await transaction
          .update(schema.productCategories)
          .set({ sortOrder, updatedAt: now })
          .where(eq(schema.productCategories.code, rowCode));
      }
      await this.audit(transaction, actor, {
        actionType: "category_reorder",
        entityType: "product_category",
        entityId: code,
        beforeState: { position: index + 1 },
        afterState: { position: swapWith + 1 },
      });
    });
  }

  async mergeCategories(
    actor: AdminActor,
    input: { sourceCode: string; targetCode: string },
  ): Promise<{ moved: number }> {
    assertPermission(actor, "settings.manage");
    if (input.sourceCode === input.targetCode) {
      throw new CatalogAuthoringError("invalid_input");
    }
    return this.database.transaction(async (transaction) => {
      const locked = await transaction
        .select()
        .from(schema.productCategories)
        .where(
          inArray(schema.productCategories.code, [
            input.sourceCode,
            input.targetCode,
          ]),
        )
        .orderBy(asc(schema.productCategories.code))
        .for("update");
      const source = locked.find((row) => row.code === input.sourceCode);
      const target = locked.find((row) => row.code === input.targetCode);
      if (!source || !target || source.archivedAt || target.archivedAt) {
        throw new CatalogAuthoringError("not_found");
      }
      await this.assertNoOffersTarget(transaction, source.code);
      const moved = await transaction
        .update(schema.products)
        .set({ categoryId: target.code, updatedAt: new Date() })
        .where(eq(schema.products.categoryId, source.code))
        .returning({ id: schema.products.id });
      const now = new Date();
      await transaction
        .update(schema.productCategories)
        .set({
          archivedAt: now,
          visible: false,
          mergedIntoCode: target.code,
          updatedAt: now,
        })
        .where(eq(schema.productCategories.code, source.code));
      await this.audit(transaction, actor, {
        actionType: "category_merge",
        entityType: "product_category",
        entityId: source.code,
        beforeState: { products: moved.length },
        afterState: { mergedInto: target.code },
      });
      return { moved: moved.length };
    });
  }

  async deleteEmptyCategory(actor: AdminActor, code: string): Promise<void> {
    assertPermission(actor, "settings.manage");
    try {
      await this.database.transaction(async (transaction) => {
        const [category] = await transaction
          .select()
          .from(schema.productCategories)
          .where(eq(schema.productCategories.code, code))
          .for("update");
        if (!category) throw new CatalogAuthoringError("not_found");
        await this.assertNoOffersTarget(transaction, code);
        const [used] = await transaction
          .select({ value: count() })
          .from(schema.products)
          .where(eq(schema.products.categoryId, code));
        const [mergedFrom] = await transaction
          .select({ value: count() })
          .from(schema.productCategories)
          .where(eq(schema.productCategories.mergedIntoCode, code));
        if (
          Number(used?.value ?? 0) > 0 ||
          Number(mergedFrom?.value ?? 0) > 0
        ) {
          throw new CatalogAuthoringError("category_not_empty");
        }
        await transaction
          .delete(schema.productCategories)
          .where(eq(schema.productCategories.code, code));
        await this.audit(transaction, actor, {
          actionType: "category_delete",
          entityType: "product_category",
          entityId: code,
          beforeState: { nameAr: category.nameAr },
          afterState: { deleted: true },
        });
      });
    } catch (error) {
      if (isForeignKeyViolation(error))
        throw new CatalogAuthoringError("category_not_empty");
      throw error;
    }
  }

  canManage(actor: AdminActor) {
    return can(actor, "settings.manage");
  }
}
