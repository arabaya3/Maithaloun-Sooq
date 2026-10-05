import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import type { ImageTarget } from "@/features/admin/domain/image-target";
import { assertPermission } from "@/features/admin/domain/permissions";
import {
  assertSafeAuditState,
  type AuditState,
} from "@/features/admin/domain/audit";
import { placeholderKinds } from "@/features/catalog/domain/product-constants";
import {
  MAX_VARIANT_IMAGES,
  isPermutation,
} from "@/features/catalog/domain/product-gallery";
import {
  VISUAL_OPTION_KINDS,
  mappingProblems,
  type MappingProblem,
} from "@/features/catalog/domain/product-media-validation";
import {
  combinationKey,
  duplicateCombinations,
  incompleteVariants,
  missingCombinations,
  normalizeOptionText,
  optionKinds,
  selectionAttributes,
  selectionLabel,
  sortOptions,
  type OptionSelection,
  type ProductOption,
} from "@/features/catalog/domain/product-options";
import { postStockAdjustment } from "@/features/inventory/application/inventory-service";
import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";

import type { CatalogAuthoringService } from "./catalog-authoring-service";
import {
  activeGallery,
  addGalleryImage,
  renumber,
  syncImageMirrors,
  type NewGalleryImage,
} from "./gallery-store";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ProductOptionsErrorCode =
  | "not_found"
  | "invalid_input"
  | "duplicate_option"
  | "duplicate_value"
  | "duplicate_combination"
  | "incomplete_combination"
  | "in_use"
  | "archived"
  | "too_many"
  | "gallery_full"
  | "primary_required"
  | "default_variant"
  | "has_images"
  | "primary_must_be_shared";

export class ProductOptionsError extends Error {
  constructor(
    readonly code: ProductOptionsErrorCode,
    readonly detail?: string,
  ) {
    super(code);
  }
}

const MAX_OPTIONS = 4;
const MAX_VALUES = 20;

export const optionNameSchema = z.string().trim().min(1).max(40);
export const optionValueTextSchema = z.string().trim().min(1).max(60);
const identifier = z
  .string()
  .regex(/^[A-Za-z0-9._-]{3,64}$/)
  .nullable();

export const generatedVariantSchema = z
  .object({
    selection: z.record(z.string(), z.string()),
    priceAgorot: z.number().int().positive().max(10_000_000),
    sku: identifier.default(null),
    barcode: identifier.default(null),
    packCount: z.number().int().min(1).max(1_000).nullable().default(null),
    available: z.boolean().default(true),
    openingStock: z
      .object({
        quantityMilli: z.number().int().positive().max(100_000_000),
        unitCostAgorot: z.number().int().positive().max(10_000_000),
      })
      .nullable()
      .default(null),
  })
  .strict();
export type GeneratedVariant = z.input<typeof generatedVariantSchema>;

export const productSetSchema = z
  .object({
    product: z
      .object({
        nameAr: z.string().trim().min(2).max(160),
        latinName: z.string().trim().min(1).max(120).nullable(),
        categoryCode: z.string().min(1).max(40),
        description: z.string().trim().max(4_000).nullable(),
        unit: z.string().trim().max(80).nullable(),
        publication: z.enum(["draft", "published", "hidden"]),
        availability: z.enum(["available", "unavailable"]),
      })
      .strict(),
    options: z
      .array(
        z
          .object({
            nameAr: optionNameSchema,
            kind: z.enum(optionKinds),
            values: z.array(optionValueTextSchema).min(1).max(MAX_VALUES),
          })
          .strict(),
      )
      .max(MAX_OPTIONS),
    variants: z
      .array(
        generatedVariantSchema
          .omit({ selection: true })
          .extend({ values: z.record(z.string(), z.string()) })
          .strict(),
      )
      .min(1)
      .max(60),
    images: z
      .array(
        z
          .object({
            src: z.string().min(1).max(500),
            alt: z.string().trim().min(1).max(250),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            variantIndex: z.number().int().min(0).max(59).nullable(),
            primary: z.boolean(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type ProductSetInput = z.input<typeof productSetSchema>;

export interface MatrixVariant {
  id: string;
  label: string;
  priceAgorot: number;
  availability: "available" | "unavailable";
  sku: string | null;
  barcode: string | null;
  packCount: number | null;
  isDefault: boolean;
  archived: boolean;
  optionValues: Record<string, string>;
  onHandMilli: number;
}

export interface ProductMatrix {
  product: { id: string; domainId: string; nameAr: string };
  options: Array<
    Omit<ProductOption, "values"> & {
      values: Array<
        ProductOption["values"][number] & { usesSharedImage: boolean }
      >;
      archived: boolean;
      archivedValues: Array<{ id: string; valueAr: string }>;
    }
  >;
  variants: MatrixVariant[];
  images: Array<{
    id: string;
    src: string;
    alt: string;
    width: number;
    height: number;
    sortOrder: number;
    isPrimary: boolean;
    scope: "unassigned" | "product" | "option_value" | "variant";
    variantId: string | null;
    optionId: string | null;
    optionValueId: string | null;
    archived: boolean;
  }>;
  missing: OptionSelection[] | null;
  duplicates: string[][];
  incomplete: string[];
  /** Image-to-variant problems; drafts may keep them, publishing may not. */
  mapping: MappingProblem[];
}

export type { ImageTarget };

function isUnique(error: unknown, name?: string): boolean {
  const value = error as {
    code?: string;
    constraint_name?: string;
    cause?: unknown;
  };
  const target =
    value?.code === "23505" ? value : (value?.cause as typeof value);
  return Boolean(
    target?.code === "23505" && (!name || target.constraint_name === name),
  );
}

export class ProductOptionsService {
  constructor(
    private readonly database: Database,
    private readonly authoring: Pick<
      CatalogAuthoringService,
      "lockIdentifiers" | "assertIdentifiersFree" | "createProductIn"
    >,
  ) {}

  private async audit(
    transaction: Transaction,
    actor: AdminActor,
    actionType: string,
    entityId: string,
    afterState: AuditState,
  ) {
    assertSafeAuditState(afterState);
    await transaction.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType,
      entityType: "product",
      entityId,
      beforeState: null,
      afterState,
    });
  }

  private async lockProduct(transaction: Transaction, domainId: string) {
    const [product] = await transaction
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, domainId))
      .for("update");
    if (!product || product.mergedIntoProductId) {
      throw new ProductOptionsError("not_found");
    }
    return product;
  }

  private async productOfOption(transaction: Transaction, optionId: string) {
    const [option] = await transaction
      .select()
      .from(schema.productOptions)
      .where(eq(schema.productOptions.id, optionId));
    if (!option) throw new ProductOptionsError("not_found");
    const [product] = await transaction
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, option.productId))
      .for("update");
    return { option, product: product! };
  }

  private async productOfImage(transaction: Transaction, imageId: string) {
    const [image] = await transaction
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.id, imageId));
    if (!image) throw new ProductOptionsError("not_found");
    const [product] = await transaction
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, image.productId))
      .for("update");
    return { image, product: product! };
  }

  async matrix(
    productDomainId: string,
    executor: Database | Transaction = this.database,
  ): Promise<ProductMatrix | null> {
    const [product] = await executor
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, productDomainId));
    if (!product) return null;
    const [options, values, variants, links, images, stock] = await Promise.all(
      [
        executor
          .select()
          .from(schema.productOptions)
          .where(eq(schema.productOptions.productId, product.id)),
        executor
          .select()
          .from(schema.productOptionValues)
          .where(eq(schema.productOptionValues.productId, product.id)),
        executor
          .select()
          .from(schema.productVariants)
          .where(eq(schema.productVariants.productId, product.id))
          .orderBy(asc(schema.productVariants.sortOrder)),
        executor
          .select()
          .from(schema.productVariantOptionValues)
          .where(eq(schema.productVariantOptionValues.productId, product.id)),
        executor
          .select()
          .from(schema.productImages)
          .where(eq(schema.productImages.productId, product.id))
          .orderBy(
            sql`${schema.productImages.isPrimary} DESC`,
            asc(schema.productImages.sortOrder),
          ),
        executor
          .select({
            variantId: schema.inventoryItems.variantId,
            onHandMilli: sql<number>`sum(${schema.inventoryItems.onHandMilli})::int`,
          })
          .from(schema.inventoryItems)
          .innerJoin(
            schema.productVariants,
            eq(schema.inventoryItems.variantId, schema.productVariants.id),
          )
          .where(eq(schema.productVariants.productId, product.id))
          .groupBy(schema.inventoryItems.variantId),
      ],
    );
    const activeOptions = sortOptions(options).map((option) => ({
      id: option.id,
      nameAr: option.nameAr,
      kind: option.kind,
      sortOrder: option.sortOrder,
      archived: Boolean(option.archivedAt),
      archivedValues: values
        .filter((value) => value.optionId === option.id && value.archivedAt)
        .map((value) => ({ id: value.id, valueAr: value.valueAr })),
      values: values
        .filter((value) => value.optionId === option.id && !value.archivedAt)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((value) => ({
          id: value.id,
          valueAr: value.valueAr,
          sortOrder: value.sortOrder,
          usesSharedImage: value.usesSharedImage,
        })),
    }));
    const domainOf = new Map(variants.map((row) => [row.id, row.domainId]));
    const matrixVariants: MatrixVariant[] = variants.map((variant) => ({
      id: variant.domainId,
      label: variant.labelAr,
      priceAgorot: variant.priceAgorot,
      availability: variant.availability,
      sku: variant.sku,
      barcode: variant.barcode,
      packCount: variant.packCount,
      isDefault: variant.isDefault,
      archived: Boolean(variant.archivedAt),
      optionValues: Object.fromEntries(
        links
          .filter((link) => link.variantId === variant.id)
          .map((link) => [link.optionId, link.valueId]),
      ),
      onHandMilli:
        stock.find((row) => row.variantId === variant.id)?.onHandMilli ?? 0,
    }));
    const live = activeOptions.filter((option) => !option.archived);
    const selectable = matrixVariants
      .filter((variant) => !variant.archived)
      .map((variant) => ({
        id: variant.id,
        optionValues: variant.optionValues,
        available: variant.availability === "available",
      }));
    return {
      product: {
        id: product.id,
        domainId: product.domainId,
        nameAr: product.nameAr,
      },
      options: activeOptions,
      variants: matrixVariants,
      images: images.map((image) => ({
        id: image.id,
        src: image.src,
        alt: image.altAr,
        width: image.width,
        height: image.height,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
        scope: image.scope,
        variantId: image.variantId
          ? (domainOf.get(image.variantId) ?? null)
          : null,
        optionId: image.optionId,
        optionValueId: image.optionValueId,
        archived: Boolean(image.archivedAt),
      })),
      mapping: mappingProblems({
        options: activeOptions,
        variants: matrixVariants,
        images: images.map((image) => ({
          id: image.id,
          archived: Boolean(image.archivedAt),
          scope: image.scope,
          variantId: image.variantId
            ? (domainOf.get(image.variantId) ?? null)
            : null,
          optionId: image.optionId,
          optionValueId: image.optionValueId,
        })),
      }),
      missing: live.length ? missingCombinations(live, selectable) : [],
      duplicates: duplicateCombinations(selectable),
      incomplete: incompleteVariants(live, selectable),
    };
  }

  // Confirmation cards compare this before running; any change to options, values, variants or images makes them stale.
  async version(productDomainId: string): Promise<string | null> {
    const matrix = await this.matrix(productDomainId);
    if (!matrix) return null;
    return createHash("sha256")
      .update(JSON.stringify(matrix))
      .digest("hex")
      .slice(0, 32);
  }

  async createOption(
    actor: AdminActor,
    productDomainId: string,
    input: {
      nameAr: string;
      kind: (typeof optionKinds)[number];
      values: string[];
    },
  ): Promise<{ optionId: string; valueIds: string[] }> {
    assertPermission(actor, "settings.manage");
    const nameAr = optionNameSchema.parse(input.nameAr);
    const values = z
      .array(optionValueTextSchema)
      .max(MAX_VALUES)
      .parse(input.values);
    if (new Set(values.map(normalizeOptionText)).size !== values.length) {
      throw new ProductOptionsError("duplicate_value");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const product = await this.lockProduct(transaction, productDomainId);
        const existing = await transaction
          .select()
          .from(schema.productOptions)
          .where(eq(schema.productOptions.productId, product.id));
        if (existing.filter((row) => !row.archivedAt).length >= MAX_OPTIONS) {
          throw new ProductOptionsError("too_many");
        }
        if (
          existing.some(
            (row) => row.normalizedName === normalizeOptionText(nameAr),
          )
        ) {
          throw new ProductOptionsError("duplicate_option", nameAr);
        }
        const [option] = await transaction
          .insert(schema.productOptions)
          .values({
            productId: product.id,
            nameAr,
            normalizedName: normalizeOptionText(nameAr),
            kind: input.kind,
            sortOrder:
              Math.max(-1, ...existing.map((row) => row.sortOrder)) + 1,
          })
          .returning();
        const inserted = values.length
          ? await transaction
              .insert(schema.productOptionValues)
              .values(
                values.map((valueAr, sortOrder) => ({
                  optionId: option!.id,
                  productId: product.id,
                  valueAr,
                  normalizedValue: normalizeOptionText(valueAr),
                  sortOrder,
                })),
              )
              .returning({ id: schema.productOptionValues.id })
          : [];
        await this.audit(
          transaction,
          actor,
          "product_option_create",
          product.domainId,
          {
            option: nameAr,
            values: values.length,
          },
        );
        return {
          optionId: option!.id,
          valueIds: inserted.map((row) => row.id),
        };
      });
    } catch (error) {
      if (isUnique(error))
        throw new ProductOptionsError("duplicate_option", nameAr);
      throw error;
    }
  }

  async updateOption(
    actor: AdminActor,
    optionId: string,
    changes: { nameAr?: string; kind?: (typeof optionKinds)[number] },
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    const nameAr =
      changes.nameAr === undefined
        ? undefined
        : optionNameSchema.parse(changes.nameAr);
    try {
      await this.database.transaction(async (transaction) => {
        const { option, product } = await this.productOfOption(
          transaction,
          optionId,
        );
        await transaction
          .update(schema.productOptions)
          .set({
            ...(nameAr
              ? { nameAr, normalizedName: normalizeOptionText(nameAr) }
              : {}),
            ...(changes.kind ? { kind: changes.kind } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.productOptions.id, option.id));
        await this.resyncVariants(transaction, product.id);
        await this.audit(
          transaction,
          actor,
          "product_option_update",
          product.domainId,
          {
            option: nameAr ?? option.nameAr,
          },
        );
      });
    } catch (error) {
      if (isUnique(error))
        throw new ProductOptionsError("duplicate_option", nameAr);
      throw error;
    }
  }

  async reorderOptions(
    actor: AdminActor,
    productDomainId: string,
    optionIds: string[],
  ) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const product = await this.lockProduct(transaction, productDomainId);
      const rows = await transaction
        .select()
        .from(schema.productOptions)
        .where(
          and(
            eq(schema.productOptions.productId, product.id),
            isNull(schema.productOptions.archivedAt),
          ),
        );
      if (
        !isPermutation(
          rows.map((row) => row.id),
          optionIds,
        )
      ) {
        throw new ProductOptionsError("invalid_input");
      }
      for (const [sortOrder, id] of optionIds.entries()) {
        await transaction
          .update(schema.productOptions)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(schema.productOptions.id, id));
      }
      await this.resyncVariants(transaction, product.id);
      await this.audit(
        transaction,
        actor,
        "product_option_reorder",
        product.domainId,
        {
          options: optionIds.length,
        },
      );
    });
  }

  private async optionInUse(
    transaction: Transaction,
    optionId: string,
    activeOnly: boolean,
  ) {
    const [row] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.productVariantOptionValues)
      .innerJoin(
        schema.productVariants,
        eq(
          schema.productVariantOptionValues.variantId,
          schema.productVariants.id,
        ),
      )
      .where(
        and(
          eq(schema.productVariantOptionValues.optionId, optionId),
          activeOnly ? isNull(schema.productVariants.archivedAt) : undefined,
        ),
      );
    return (row?.total ?? 0) > 0;
  }

  private async valueInUse(
    transaction: Transaction,
    valueId: string,
    activeOnly: boolean,
  ) {
    const [row] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.productVariantOptionValues)
      .innerJoin(
        schema.productVariants,
        eq(
          schema.productVariantOptionValues.variantId,
          schema.productVariants.id,
        ),
      )
      .where(
        and(
          eq(schema.productVariantOptionValues.valueId, valueId),
          activeOnly ? isNull(schema.productVariants.archivedAt) : undefined,
        ),
      );
    return (row?.total ?? 0) > 0;
  }

  // Images keep pointing at their option value, so the value stays until the images are moved; files are never touched here.
  private async imagesMapped(
    transaction: Transaction,
    target: { optionId: string } | { valueId: string },
    activeOnly: boolean,
  ) {
    const [row] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.productImages)
      .where(
        and(
          "optionId" in target
            ? eq(schema.productImages.optionId, target.optionId)
            : eq(schema.productImages.optionValueId, target.valueId),
          activeOnly ? isNull(schema.productImages.archivedAt) : undefined,
        ),
      );
    return (row?.total ?? 0) > 0;
  }

  // Active variants keep a complete choice for every active option, so an option in use cannot be archived.
  async setOptionArchived(
    actor: AdminActor,
    optionId: string,
    archived: boolean,
  ) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { option, product } = await this.productOfOption(
        transaction,
        optionId,
      );
      if (archived && (await this.optionInUse(transaction, option.id, true))) {
        throw new ProductOptionsError("in_use", option.nameAr);
      }
      if (
        archived &&
        (await this.imagesMapped(transaction, { optionId: option.id }, true))
      ) {
        throw new ProductOptionsError("has_images", option.nameAr);
      }
      await transaction
        .update(schema.productOptions)
        .set({
          archivedAt: archived ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.productOptions.id, option.id));
      await this.audit(
        transaction,
        actor,
        archived ? "product_option_archive" : "product_option_restore",
        product.domainId,
        { option: option.nameAr },
      );
    });
  }

  async deleteOption(actor: AdminActor, optionId: string) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { option, product } = await this.productOfOption(
        transaction,
        optionId,
      );
      if (await this.optionInUse(transaction, option.id, false)) {
        throw new ProductOptionsError("in_use", option.nameAr);
      }
      if (
        await this.imagesMapped(transaction, { optionId: option.id }, false)
      ) {
        throw new ProductOptionsError("has_images", option.nameAr);
      }
      await transaction
        .delete(schema.productOptions)
        .where(eq(schema.productOptions.id, option.id));
      await this.audit(
        transaction,
        actor,
        "product_option_delete",
        product.domainId,
        {
          option: option.nameAr,
        },
      );
    });
  }

  async addValue(
    actor: AdminActor,
    optionId: string,
    valueAr: string,
  ): Promise<{ valueId: string }> {
    assertPermission(actor, "settings.manage");
    const value = optionValueTextSchema.parse(valueAr);
    try {
      return await this.database.transaction(async (transaction) => {
        const { option, product } = await this.productOfOption(
          transaction,
          optionId,
        );
        const existing = await transaction
          .select()
          .from(schema.productOptionValues)
          .where(eq(schema.productOptionValues.optionId, option.id));
        if (existing.length >= MAX_VALUES)
          throw new ProductOptionsError("too_many");
        if (
          existing.some(
            (row) => row.normalizedValue === normalizeOptionText(value),
          )
        ) {
          throw new ProductOptionsError("duplicate_value", value);
        }
        const [row] = await transaction
          .insert(schema.productOptionValues)
          .values({
            optionId: option.id,
            productId: product.id,
            valueAr: value,
            normalizedValue: normalizeOptionText(value),
            sortOrder:
              Math.max(-1, ...existing.map((item) => item.sortOrder)) + 1,
          })
          .returning({ id: schema.productOptionValues.id });
        await this.audit(
          transaction,
          actor,
          "product_option_value_create",
          product.domainId,
          {
            option: option.nameAr,
            value,
          },
        );
        return { valueId: row!.id };
      });
    } catch (error) {
      if (isUnique(error))
        throw new ProductOptionsError("duplicate_value", value);
      throw error;
    }
  }

  private async productOfValue(transaction: Transaction, valueId: string) {
    const [value] = await transaction
      .select()
      .from(schema.productOptionValues)
      .where(eq(schema.productOptionValues.id, valueId));
    if (!value) throw new ProductOptionsError("not_found");
    const { option, product } = await this.productOfOption(
      transaction,
      value.optionId,
    );
    return { value, option, product };
  }

  async updateValue(actor: AdminActor, valueId: string, valueAr: string) {
    assertPermission(actor, "settings.manage");
    const text = optionValueTextSchema.parse(valueAr);
    try {
      await this.database.transaction(async (transaction) => {
        const { value, product } = await this.productOfValue(
          transaction,
          valueId,
        );
        await transaction
          .update(schema.productOptionValues)
          .set({
            valueAr: text,
            normalizedValue: normalizeOptionText(text),
            updatedAt: new Date(),
          })
          .where(eq(schema.productOptionValues.id, value.id));
        await this.resyncVariants(transaction, product.id);
        await this.audit(
          transaction,
          actor,
          "product_option_value_update",
          product.domainId,
          {
            value: text,
          },
        );
      });
    } catch (error) {
      if (isUnique(error))
        throw new ProductOptionsError("duplicate_value", text);
      throw error;
    }
  }

  async reorderValues(actor: AdminActor, optionId: string, valueIds: string[]) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { option, product } = await this.productOfOption(
        transaction,
        optionId,
      );
      const rows = await transaction
        .select()
        .from(schema.productOptionValues)
        .where(
          and(
            eq(schema.productOptionValues.optionId, option.id),
            isNull(schema.productOptionValues.archivedAt),
          ),
        );
      if (
        !isPermutation(
          rows.map((row) => row.id),
          valueIds,
        )
      ) {
        throw new ProductOptionsError("invalid_input");
      }
      for (const [sortOrder, id] of valueIds.entries()) {
        await transaction
          .update(schema.productOptionValues)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(schema.productOptionValues.id, id));
      }
      await this.audit(
        transaction,
        actor,
        "product_option_value_reorder",
        product.domainId,
        {
          option: option.nameAr,
        },
      );
    });
  }

  async setValueArchived(
    actor: AdminActor,
    valueId: string,
    archived: boolean,
  ) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { value, product } = await this.productOfValue(
        transaction,
        valueId,
      );
      if (archived && (await this.valueInUse(transaction, value.id, true))) {
        throw new ProductOptionsError("in_use", value.valueAr);
      }
      if (
        archived &&
        (await this.imagesMapped(transaction, { valueId: value.id }, true))
      ) {
        throw new ProductOptionsError("has_images", value.valueAr);
      }
      await transaction
        .update(schema.productOptionValues)
        .set({
          archivedAt: archived ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.productOptionValues.id, value.id));
      await this.audit(
        transaction,
        actor,
        archived
          ? "product_option_value_archive"
          : "product_option_value_restore",
        product.domainId,
        { value: value.valueAr },
      );
    });
  }

  async deleteValue(actor: AdminActor, valueId: string) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { value, product } = await this.productOfValue(
        transaction,
        valueId,
      );
      if (await this.valueInUse(transaction, value.id, false)) {
        throw new ProductOptionsError("in_use", value.valueAr);
      }
      if (await this.imagesMapped(transaction, { valueId: value.id }, false)) {
        throw new ProductOptionsError("has_images", value.valueAr);
      }
      await transaction
        .delete(schema.productOptionValues)
        .where(eq(schema.productOptionValues.id, value.id));
      await this.audit(
        transaction,
        actor,
        "product_option_value_delete",
        product.domainId,
        {
          value: value.valueAr,
        },
      );
    });
  }

  private async liveOptions(
    transaction: Transaction,
    productId: string,
  ): Promise<ProductOption[]> {
    const [options, values] = await Promise.all([
      transaction
        .select()
        .from(schema.productOptions)
        .where(
          and(
            eq(schema.productOptions.productId, productId),
            isNull(schema.productOptions.archivedAt),
          ),
        ),
      transaction
        .select()
        .from(schema.productOptionValues)
        .where(
          and(
            eq(schema.productOptionValues.productId, productId),
            isNull(schema.productOptionValues.archivedAt),
          ),
        ),
    ]);
    return sortOptions(options).map((option) => ({
      id: option.id,
      nameAr: option.nameAr,
      kind: option.kind,
      sortOrder: option.sortOrder,
      values: values
        .filter((value) => value.optionId === option.id)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((value) => ({
          id: value.id,
          valueAr: value.valueAr,
          sortOrder: value.sortOrder,
        })),
    }));
  }

  private validateSelection(
    options: ProductOption[],
    selection: OptionSelection,
  ) {
    const known = new Set(options.map((option) => option.id));
    if (Object.keys(selection).some((optionId) => !known.has(optionId))) {
      throw new ProductOptionsError("invalid_input");
    }
    for (const option of options) {
      const valueId = selection[option.id];
      if (!valueId)
        throw new ProductOptionsError("incomplete_combination", option.nameAr);
      if (!option.values.some((value) => value.id === valueId)) {
        throw new ProductOptionsError("invalid_input");
      }
    }
  }

  private async writeSelection(
    transaction: Transaction,
    productId: string,
    variantId: string,
    options: ProductOption[],
    selection: OptionSelection,
  ) {
    await transaction
      .delete(schema.productVariantOptionValues)
      .where(eq(schema.productVariantOptionValues.variantId, variantId));
    const rows = options.map((option) => ({
      variantId,
      productId,
      optionId: option.id,
      valueId: selection[option.id]!,
    }));
    if (rows.length)
      await transaction.insert(schema.productVariantOptionValues).values(rows);
  }

  // Labels, attribute snapshots and combination keys follow the option values whenever they change.
  private async resyncVariants(transaction: Transaction, productId: string) {
    const options = await transaction
      .select()
      .from(schema.productOptions)
      .where(eq(schema.productOptions.productId, productId));
    const values = await transaction
      .select()
      .from(schema.productOptionValues)
      .where(eq(schema.productOptionValues.productId, productId));
    const allOptions: ProductOption[] = sortOptions(options).map((option) => ({
      id: option.id,
      nameAr: option.nameAr,
      kind: option.kind,
      sortOrder: option.sortOrder,
      values: values
        .filter((value) => value.optionId === option.id)
        .map((value) => ({
          id: value.id,
          valueAr: value.valueAr,
          sortOrder: value.sortOrder,
        })),
    }));
    const links = await transaction
      .select()
      .from(schema.productVariantOptionValues)
      .where(eq(schema.productVariantOptionValues.productId, productId));
    const byVariant = new Map<string, Record<string, string>>();
    for (const link of links) {
      byVariant.set(link.variantId, {
        ...(byVariant.get(link.variantId) ?? {}),
        [link.optionId]: link.valueId,
      });
    }
    for (const [variantId, selection] of byVariant) {
      await transaction
        .update(schema.productVariants)
        .set({
          labelAr:
            selectionLabel(allOptions, selection).slice(0, 120) || undefined,
          attributes: selectionAttributes(allOptions, selection),
          combinationKey: combinationKey(selection),
          updatedAt: new Date(),
        })
        .where(eq(schema.productVariants.id, variantId));
    }
  }

  async setVariantSelection(
    actor: AdminActor,
    variantDomainId: string,
    input: { selection: OptionSelection; packCount?: number | null },
  ) {
    assertPermission(actor, "settings.manage");
    try {
      await this.database.transaction(async (transaction) => {
        const [variant] = await transaction
          .select()
          .from(schema.productVariants)
          .where(eq(schema.productVariants.domainId, variantDomainId))
          .for("update");
        if (!variant) throw new ProductOptionsError("not_found");
        const options = await this.liveOptions(transaction, variant.productId);
        this.validateSelection(options, input.selection);
        await this.writeSelection(
          transaction,
          variant.productId,
          variant.id,
          options,
          input.selection,
        );
        await transaction
          .update(schema.productVariants)
          .set({
            labelAr:
              selectionLabel(options, input.selection).slice(0, 120) ||
              variant.labelAr,
            attributes: selectionAttributes(options, input.selection),
            combinationKey: combinationKey(input.selection),
            ...(input.packCount === undefined
              ? {}
              : { packCount: input.packCount }),
            updatedAt: new Date(),
          })
          .where(eq(schema.productVariants.id, variant.id));
        const [product] = await transaction
          .select({ domainId: schema.products.domainId })
          .from(schema.products)
          .where(eq(schema.products.id, variant.productId));
        await this.audit(
          transaction,
          actor,
          "product_variant_options",
          product!.domainId,
          {
            variant: variant.domainId,
            options: options.length,
          },
        );
      });
    } catch (error) {
      if (isUnique(error, "product_variants_active_combination_uidx")) {
        throw new ProductOptionsError("duplicate_combination");
      }
      throw error;
    }
  }

  // All variants are created in one transaction: a single invalid row leaves nothing behind.
  async generateVariants(
    actor: AdminActor,
    productDomainId: string,
    rows: GeneratedVariant[],
    idempotencyKey: string,
  ): Promise<{ variantIds: string[] }> {
    assertPermission(actor, "settings.manage");
    const parsed = z.array(generatedVariantSchema).min(1).max(60).parse(rows);
    if (parsed.some((row) => row.openingStock))
      assertPermission(actor, "stock.adjust");
    try {
      return await this.database.transaction(async (transaction) => {
        const product = await this.lockProduct(transaction, productDomainId);
        const options = await this.liveOptions(transaction, product.id);
        if (!options.length)
          throw new ProductOptionsError("incomplete_combination");
        await this.authoring.lockIdentifiers(transaction);
        const keys = new Set<string>();
        for (const row of parsed) {
          this.validateSelection(options, row.selection);
          const key = combinationKey(row.selection)!;
          if (keys.has(key))
            throw new ProductOptionsError("duplicate_combination");
          keys.add(key);
        }
        const variantIds = await this.insertVariants(
          transaction,
          actor,
          product,
          options,
          parsed,
          idempotencyKey,
        );
        await syncImageMirrors(transaction, product.id);
        await this.audit(
          transaction,
          actor,
          "product_variants_generate",
          product.domainId,
          {
            variants: variantIds.length,
          },
        );
        return { variantIds };
      });
    } catch (error) {
      if (isUnique(error, "product_variants_active_combination_uidx")) {
        throw new ProductOptionsError("duplicate_combination");
      }
      throw error;
    }
  }

  // Product, options, values, every variant, gallery images and opening stock commit together or not at all.
  async createProductSet(
    actor: AdminActor,
    input: ProductSetInput,
    idempotencyKey: string,
  ): Promise<{ domainId: string; variantIds: string[]; replayed: boolean }> {
    assertPermission(actor, "settings.manage");
    const data = productSetSchema.parse(input);
    if (data.variants.some((row) => row.openingStock)) {
      assertPermission(actor, "stock.adjust");
    }
    const replayRef = createHash("sha256")
      .update(`product_create:${idempotencyKey}`)
      .digest("hex")
      .slice(0, 32);
    try {
      return await this.database.transaction(async (transaction) => {
        const [first, ...rest] = data.variants;
        const created = await this.authoring.createProductIn(
          transaction,
          actor,
          {
            ...data.product,
            priceAgorot: first!.priceAgorot,
            availability: first!.available ? "available" : "unavailable",
            variantLabel: "الأساسي",
            attributes: {},
            sku: first!.sku,
            barcode: first!.barcode,
            specifications: [],
            image: null,
            openingStock: first!.openingStock,
          },
          {},
          replayRef,
          idempotencyKey,
        );
        if (created.replayed) {
          return { domainId: created.domainId, variantIds: [], replayed: true };
        }
        const product = await this.lockProduct(transaction, created.domainId);
        for (const [sortOrder, option] of data.options.entries()) {
          const [row] = await transaction
            .insert(schema.productOptions)
            .values({
              productId: product.id,
              nameAr: option.nameAr,
              normalizedName: normalizeOptionText(option.nameAr),
              kind: option.kind,
              sortOrder,
            })
            .returning({ id: schema.productOptions.id });
          await transaction.insert(schema.productOptionValues).values(
            option.values.map((valueAr, valueOrder) => ({
              optionId: row!.id,
              productId: product.id,
              valueAr,
              normalizedValue: normalizeOptionText(valueAr),
              sortOrder: valueOrder,
            })),
          );
        }
        const options = await this.liveOptions(transaction, product.id);
        const selections = data.variants.map((variant) =>
          Object.fromEntries(
            options.map((option) => {
              const wanted = variant.values[option.nameAr];
              const value = option.values.find(
                (item) =>
                  wanted !== undefined &&
                  normalizeOptionText(item.valueAr) ===
                    normalizeOptionText(wanted),
              );
              if (!value) {
                throw new ProductOptionsError(
                  "incomplete_combination",
                  option.nameAr,
                );
              }
              return [option.id, value.id];
            }),
          ),
        );
        const keys = selections.map(
          (selection) => combinationKey(selection) ?? "",
        );
        if (new Set(keys).size !== keys.length) {
          throw new ProductOptionsError("duplicate_combination");
        }
        const [defaultVariant] = await transaction
          .select()
          .from(schema.productVariants)
          .where(eq(schema.productVariants.domainId, created.variantId));
        if (options.length) {
          await this.writeSelection(
            transaction,
            product.id,
            defaultVariant!.id,
            options,
            selections[0]!,
          );
        }
        await transaction
          .update(schema.productVariants)
          .set({
            labelAr:
              selectionLabel(options, selections[0]!).slice(0, 120) ||
              "الأساسي",
            attributes: selectionAttributes(options, selections[0]!),
            combinationKey: combinationKey(selections[0]!),
            packCount: first!.packCount,
          })
          .where(eq(schema.productVariants.id, defaultVariant!.id));
        const others = await this.insertVariants(
          transaction,
          actor,
          product,
          options,
          rest.map((row, index) => ({
            ...row,
            selection: selections[index + 1]!,
          })),
          idempotencyKey,
          1,
        );
        const variantIds = [created.variantId, ...others];
        for (const image of data.images) {
          const variantDomainId =
            image.variantIndex === null ? null : variantIds[image.variantIndex];
          if (image.variantIndex !== null && !variantDomainId) {
            throw new ProductOptionsError("invalid_input");
          }
          await addGalleryImage(transaction, product.id, {
            src: image.src,
            alt: image.alt,
            width: image.width,
            height: image.height,
            primary: image.primary,
            variantId: variantDomainId
              ? await this.variantOfProduct(
                  transaction,
                  product.id,
                  variantDomainId,
                )
              : null,
          });
        }
        await syncImageMirrors(transaction, product.id);
        await this.audit(
          transaction,
          actor,
          "product_set_create",
          product.domainId,
          {
            variants: variantIds.length,
            options: options.length,
            images: data.images.length,
          },
        );
        return { domainId: created.domainId, variantIds, replayed: false };
      });
    } catch (error) {
      if (isUnique(error, "product_variants_active_combination_uidx")) {
        throw new ProductOptionsError("duplicate_combination");
      }
      throw error;
    }
  }

  private async insertVariants(
    transaction: Transaction,
    actor: AdminActor,
    product: typeof schema.products.$inferSelect,
    options: ProductOption[],
    rows: Array<z.output<typeof generatedVariantSchema>>,
    idempotencyKey: string,
    stockOffset = 0,
  ): Promise<string[]> {
    for (const row of rows) {
      await this.authoring.assertIdentifiersFree(transaction, row);
    }
    const identifiers = rows
      .flatMap((row) => [row.sku?.toLowerCase(), row.barcode])
      .filter(Boolean);
    if (new Set(identifiers).size !== identifiers.length) {
      throw new ProductOptionsError("invalid_input");
    }
    const [{ next } = { next: 0 }] = await transaction
      .select({
        next: sql<number>`coalesce(max(${schema.productVariants.sortOrder}), -1) + 1`,
      })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, product.id));
    const variantIds: string[] = [];
    for (const [index, row] of rows.entries()) {
      const domainId = `${product.domainId}--v${randomUUID().slice(0, 6)}`;
      const [created] = await transaction
        .insert(schema.productVariants)
        .values({
          productId: product.id,
          domainId,
          labelAr: selectionLabel(options, row.selection).slice(0, 120),
          attributes: selectionAttributes(options, row.selection),
          combinationKey: combinationKey(row.selection),
          priceAgorot: row.priceAgorot,
          availability: row.available ? "available" : "unavailable",
          sku: row.sku,
          barcode: row.barcode,
          packCount: row.packCount,
          sortOrder: Number(next) + index,
          isDefault: false,
          imageKind: "placeholder",
          placeholderVariant: product.placeholderVariant ?? placeholderKinds[0],
        })
        .returning({ id: schema.productVariants.id });
      await this.writeSelection(
        transaction,
        product.id,
        created!.id,
        options,
        row.selection,
      );
      if (row.openingStock) {
        await postStockAdjustment(transaction, actor, {
          idempotencyKey: derived(
            `opening:${idempotencyKey}:${index + stockOffset}`,
          ),
          variantId: domainId,
          reason: "opening_balance",
          quantityMilli: row.openingStock.quantityMilli,
          unitCostAgorot: row.openingStock.unitCostAgorot,
          note: "رصيد افتتاحي عند إضافة الصنف",
        });
      }
      variantIds.push(domainId);
    }
    return variantIds;
  }

  async addImages(
    actor: AdminActor,
    productDomainId: string,
    images: Array<
      Omit<
        NewGalleryImage,
        "variantId" | "scope" | "optionId" | "optionValueId"
      > & {
        variantDomainId?: string | null;
        target?: ImageTarget;
      }
    >,
  ): Promise<{ imageIds: string[] }> {
    assertPermission(actor, "settings.manage");
    return this.database.transaction(async (transaction) => {
      const product = await this.lockProduct(transaction, productDomainId);
      const fallback = await this.defaultTarget(transaction, product.id);
      const imageIds: string[] = [];
      for (const image of images) {
        const target: ImageTarget = image.target
          ? image.target
          : image.variantDomainId
            ? { scope: "variant", variantDomainId: image.variantDomainId }
            : fallback;
        const columns = await this.targetColumns(
          transaction,
          product.id,
          target,
        );
        if (columns.variantId)
          await this.assertVariantRoom(transaction, columns.variantId);
        const row = await addGalleryImage(transaction, product.id, {
          ...image,
          ...columns,
        }).catch((error: unknown) => {
          if (error instanceof Error && error.message === "gallery_full") {
            throw new ProductOptionsError("gallery_full");
          }
          throw error;
        });
        imageIds.push(row.id);
      }
      await syncImageMirrors(transaction, product.id);
      await this.audit(
        transaction,
        actor,
        "product_images_add",
        product.domainId,
        {
          images: images.length,
        },
      );
      return { imageIds };
    });
  }

  // A product whose customers choose between colours or scents gets new images unclassified, so nobody's picture is assumed;
  // a product with a single variant needs no choice and its images are shared.
  private async defaultTarget(
    transaction: Transaction,
    productId: string,
  ): Promise<ImageTarget> {
    const [variants] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.productId, productId),
          isNull(schema.productVariants.archivedAt),
        ),
      );
    if ((variants?.total ?? 0) < 2) return { scope: "product" };
    const [visual] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.productOptions)
      .where(
        and(
          eq(schema.productOptions.productId, productId),
          isNull(schema.productOptions.archivedAt),
          inArray(schema.productOptions.kind, [...VISUAL_OPTION_KINDS]),
        ),
      );
    return (visual?.total ?? 0) > 0
      ? { scope: "unassigned" }
      : { scope: "product" };
  }

  // Checks the target belongs to this product and is live, and returns the columns that record it.
  private async targetColumns(
    transaction: Transaction,
    productId: string,
    target: ImageTarget,
  ) {
    if (target.scope === "variant") {
      const [variant] = await transaction
        .select({
          id: schema.productVariants.id,
          archivedAt: schema.productVariants.archivedAt,
        })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.domainId, target.variantDomainId),
            eq(schema.productVariants.productId, productId),
          ),
        );
      if (!variant) throw new ProductOptionsError("not_found");
      if (variant.archivedAt) throw new ProductOptionsError("archived");
      return {
        scope: "variant" as const,
        variantId: variant.id,
        optionId: null,
        optionValueId: null,
      };
    }
    if (target.scope === "option_value") {
      const [value] = await transaction
        .select({
          id: schema.productOptionValues.id,
          optionId: schema.productOptionValues.optionId,
          archivedAt: schema.productOptionValues.archivedAt,
          optionArchivedAt: schema.productOptions.archivedAt,
        })
        .from(schema.productOptionValues)
        .innerJoin(
          schema.productOptions,
          eq(schema.productOptions.id, schema.productOptionValues.optionId),
        )
        .where(
          and(
            eq(schema.productOptionValues.id, target.valueId),
            eq(schema.productOptionValues.productId, productId),
          ),
        );
      if (!value) throw new ProductOptionsError("not_found");
      if (value.archivedAt || value.optionArchivedAt)
        throw new ProductOptionsError("archived");
      return {
        scope: "option_value" as const,
        variantId: null,
        optionId: value.optionId,
        optionValueId: value.id,
      };
    }
    return {
      scope: target.scope,
      variantId: null,
      optionId: null,
      optionValueId: null,
    };
  }

  /**
   * Moves an image to a new place without touching its file. The product row is locked, so two owners
   * changing the same product's images run one after the other.
   */
  async setImageScope(
    actor: AdminActor,
    imageId: string,
    target: ImageTarget,
  ): Promise<{ changed: boolean }> {
    assertPermission(actor, "settings.manage");
    return this.database.transaction(async (transaction) => {
      const { image, product } = await this.productOfImage(
        transaction,
        imageId,
      );
      if (image.archivedAt) throw new ProductOptionsError("archived");
      const columns = await this.targetColumns(transaction, product.id, target);
      if (
        image.scope === columns.scope &&
        image.variantId === columns.variantId &&
        image.optionValueId === columns.optionValueId
      ) {
        return { changed: false };
      }
      if (columns.variantId && columns.variantId !== image.variantId)
        await this.assertVariantRoom(transaction, columns.variantId);
      // The primary image is always a shared one; when it stops being shared the next shared image takes over.
      const losesPrimary = image.isPrimary && columns.scope !== "product";
      await transaction
        .update(schema.productImages)
        .set({
          ...columns,
          isPrimary: losesPrimary ? false : image.isPrimary,
          updatedAt: new Date(),
        })
        .where(eq(schema.productImages.id, image.id));
      if (losesPrimary)
        await this.promoteSharedPrimary(transaction, product.id);
      await syncImageMirrors(transaction, product.id);
      await this.audit(
        transaction,
        actor,
        "product_image_scope",
        product.domainId,
        {
          image: image.id,
          from: image.scope,
          to: columns.scope,
        },
      );
      return { changed: true };
    });
  }

  private async promoteSharedPrimary(
    transaction: Transaction,
    productId: string,
  ) {
    const active = await activeGallery(transaction, productId);
    if (active.some((row) => row.isPrimary)) return;
    const next = active.find((row) => row.scope === "product");
    if (!next) return;
    await transaction
      .update(schema.productImages)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(schema.productImages.id, next.id));
    await renumber(transaction, productId, next.id);
  }

  /** The owner's explicit choice to show the shared product image for a colour or scent that has no picture. */
  async setValueSharedImage(
    actor: AdminActor,
    valueId: string,
    usesSharedImage: boolean,
  ): Promise<{ changed: boolean }> {
    assertPermission(actor, "settings.manage");
    return this.database.transaction(async (transaction) => {
      const { value, product } = await this.productOfValue(
        transaction,
        valueId,
      );
      if (value.archivedAt) throw new ProductOptionsError("archived");
      if (value.usesSharedImage === usesSharedImage) return { changed: false };
      await transaction
        .update(schema.productOptionValues)
        .set({ usesSharedImage, updatedAt: new Date() })
        .where(eq(schema.productOptionValues.id, value.id));
      await this.audit(
        transaction,
        actor,
        "product_option_value_shared_image",
        product.domainId,
        { value: value.valueAr, usesSharedImage },
      );
      return { changed: true };
    });
  }

  private async variantOfProduct(
    transaction: Transaction,
    productId: string,
    variantDomainId: string,
  ) {
    const [variant] = await transaction
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.domainId, variantDomainId),
          eq(schema.productVariants.productId, productId),
        ),
      );
    if (!variant) throw new ProductOptionsError("not_found");
    return variant.id;
  }

  private async assertVariantRoom(transaction: Transaction, variantId: string) {
    const [row] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.productImages)
      .where(
        and(
          eq(schema.productImages.variantId, variantId),
          isNull(schema.productImages.archivedAt),
        ),
      );
    if ((row?.total ?? 0) >= MAX_VARIANT_IMAGES)
      throw new ProductOptionsError("too_many");
  }

  async reorderImages(
    actor: AdminActor,
    productDomainId: string,
    imageIds: string[],
  ) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const product = await this.lockProduct(transaction, productDomainId);
      const active = await activeGallery(transaction, product.id);
      if (
        !isPermutation(
          active.map((row) => row.id),
          imageIds,
        )
      ) {
        throw new ProductOptionsError("invalid_input");
      }
      // Clear the old primary first so the one-primary index never sees two.
      await transaction
        .update(schema.productImages)
        .set({ isPrimary: false })
        .where(
          and(
            eq(schema.productImages.productId, product.id),
            eq(schema.productImages.isPrimary, true),
          ),
        );
      // The first shared image in the new order becomes the primary one.
      const primaryId = imageIds.find(
        (id) => active.find((row) => row.id === id)?.scope === "product",
      );
      for (const [sortOrder, id] of imageIds.entries()) {
        await transaction
          .update(schema.productImages)
          .set({
            sortOrder,
            isPrimary: id === primaryId,
            updatedAt: new Date(),
          })
          .where(eq(schema.productImages.id, id));
      }
      await syncImageMirrors(transaction, product.id);
      await this.audit(
        transaction,
        actor,
        "product_images_reorder",
        product.domainId,
        {
          images: imageIds.length,
        },
      );
    });
  }

  async setPrimaryImage(actor: AdminActor, imageId: string) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { image, product } = await this.productOfImage(
        transaction,
        imageId,
      );
      if (image.archivedAt) throw new ProductOptionsError("archived");
      if (image.scope !== "product")
        throw new ProductOptionsError("primary_must_be_shared");
      await transaction
        .update(schema.productImages)
        .set({ isPrimary: false })
        .where(
          and(
            eq(schema.productImages.productId, product.id),
            eq(schema.productImages.isPrimary, true),
          ),
        );
      await transaction
        .update(schema.productImages)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(schema.productImages.id, image.id));
      await renumber(transaction, product.id, image.id);
      await syncImageMirrors(transaction, product.id);
      await this.audit(
        transaction,
        actor,
        "product_image_primary",
        product.domainId,
        { image: image.id },
      );
    });
  }

  async updateImageAlt(actor: AdminActor, imageId: string, altAr: string) {
    assertPermission(actor, "settings.manage");
    const alt = z.string().trim().min(1).max(250).parse(altAr);
    await this.database.transaction(async (transaction) => {
      const { image, product } = await this.productOfImage(
        transaction,
        imageId,
      );
      await transaction
        .update(schema.productImages)
        .set({ altAr: alt, updatedAt: new Date() })
        .where(eq(schema.productImages.id, image.id));
      await syncImageMirrors(transaction, product.id);
      await this.audit(
        transaction,
        actor,
        "product_image_alt",
        product.domainId,
        { image: image.id },
      );
    });
  }

  // Kept for confirmation cards prepared before image scopes existed.
  async assignImage(
    actor: AdminActor,
    imageId: string,
    variantDomainId: string | null,
  ) {
    await this.setImageScope(
      actor,
      imageId,
      variantDomainId
        ? { scope: "variant", variantDomainId }
        : { scope: "product" },
    );
  }

  async setImageArchived(
    actor: AdminActor,
    imageId: string,
    archived: boolean,
  ) {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const { image, product } = await this.productOfImage(
        transaction,
        imageId,
      );
      const now = new Date();
      if (archived) {
        await transaction
          .update(schema.productImages)
          .set({ archivedAt: now, isPrimary: false, updatedAt: now })
          .where(eq(schema.productImages.id, image.id));
        if (image.isPrimary)
          await this.promoteSharedPrimary(transaction, product.id);
      } else {
        const active = await activeGallery(transaction, product.id);
        if (active.length >= 8) throw new ProductOptionsError("gallery_full");
        await transaction
          .update(schema.productImages)
          .set({
            archivedAt: null,
            isPrimary:
              image.scope === "product" && !active.some((row) => row.isPrimary),
            sortOrder: active.length,
            updatedAt: now,
          })
          .where(eq(schema.productImages.id, image.id));
      }
      await renumber(transaction, product.id);
      await syncImageMirrors(transaction, product.id);
      await this.audit(
        transaction,
        actor,
        archived ? "product_image_archive" : "product_image_restore",
        product.domainId,
        { image: image.id },
      );
    });
  }

  // Only an archived image is deleted; the caller removes the stored file after the commit when nothing else uses it.
  async deleteImage(
    actor: AdminActor,
    imageId: string,
  ): Promise<{ src: string; fileStillUsed: boolean }> {
    assertPermission(actor, "settings.manage");
    return this.database.transaction(async (transaction) => {
      const { image, product } = await this.productOfImage(
        transaction,
        imageId,
      );
      if (!image.archivedAt) throw new ProductOptionsError("in_use");
      await transaction
        .delete(schema.productImages)
        .where(eq(schema.productImages.id, image.id));
      const [{ total } = { total: 0 }] = await transaction
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.productImages)
        .where(eq(schema.productImages.src, image.src));
      const [legacy] = await transaction
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.imageSrc, image.src));
      await this.audit(
        transaction,
        actor,
        "product_image_delete",
        product.domainId,
        { image: image.id },
      );
      return {
        src: image.src,
        fileStillUsed: total + (legacy?.total ?? 0) > 0,
      };
    });
  }

  async variantsUsingValues(valueIds: string[]): Promise<number> {
    if (!valueIds.length) return 0;
    const [row] = await this.database
      .select({
        total: sql<number>`count(distinct ${schema.productVariantOptionValues.variantId})::int`,
      })
      .from(schema.productVariantOptionValues)
      .where(inArray(schema.productVariantOptionValues.valueId, valueIds));
    return row?.total ?? 0;
  }
}

function derived(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
