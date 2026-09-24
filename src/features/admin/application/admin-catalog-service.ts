import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import {
  assertOwnerActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import {
  assertSafeAuditState,
  redactProductAuditState,
  redactProductSpecificationAuditState,
  redactProductVariantAuditState,
} from "@/features/admin/domain/audit";
import {
  placeholderKinds,
  productAvailabilityValues,
  productCategorySchema,
  productDetailsStatusValues,
  productIdSchema,
  productSlugSchema,
  type Product,
} from "@/features/catalog/domain/product";
import {
  variantAttributesSchema,
  variantDomainIdSchema,
} from "@/features/catalog/domain/product-variant";
import { mapProductRow } from "@/features/catalog/infrastructure/product-row-mapper";
import * as schema from "@/server/db/schema";

export class AdminCatalogError extends Error {
  constructor(
    readonly code:
      "not_found" | "invalid_input" | "duplicate" | "in_use" | "last_default",
  ) {
    super(code);
    this.name = "AdminCatalogError";
  }
}

const optionalText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(1).max(max).optional(),
  );

export const adminProductUpdateSchema = z
  .object({
    domainId: productIdSchema,
    nameAr: z.string().trim().min(1).max(160),
    latinName: optionalText(120),
    priceAgorot: z.number().int().positive().max(10_000_000),
    categoryId: productCategorySchema,
    availability: z.enum(productAvailabilityValues),
    sortOrder: z.number().int().min(0).max(100_000),
    description: optionalText(4_000),
    usageNotes: optionalText(4_000),
    unit: optionalText(80),
    detailsStatus: z.enum(productDetailsStatusValues),
    placeholderVariant: z.enum(placeholderKinds),
  })
  .strict();

export const adminProductCreateSchema = adminProductUpdateSchema
  .extend({
    slug: productSlugSchema,
  })
  .strict();

const attributePairSchema = z
  .object({
    key: z.string().trim().min(1).max(40),
    value: z.string().trim().min(1).max(80),
  })
  .strict();

export const adminVariantUpsertSchema = z
  .object({
    productDomainId: productIdSchema,
    variantDomainId: variantDomainIdSchema,
    labelAr: z.string().trim().min(1).max(120),
    attributes: z.array(attributePairSchema).max(8),
    priceAgorot: z.number().int().nonnegative().max(10_000_000),
    availability: z.enum(productAvailabilityValues),
    sortOrder: z.number().int().min(0).max(100_000),
    isDefault: z.boolean(),
    imageMode: z.enum(["placeholder", "image"]),
    placeholderVariant: z.enum(placeholderKinds).optional(),
    imageSrc: optionalText(500),
    imageAlt: optionalText(250),
    imageWidth: z.number().int().positive().optional(),
    imageHeight: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.imageMode === "placeholder" && !value.placeholderVariant) {
      context.addIssue({
        code: "custom",
        path: ["placeholderVariant"],
        message: "Placeholder required.",
      });
    }
    if (value.imageMode === "image") {
      if (!value.imageSrc || !value.imageAlt) {
        context.addIssue({
          code: "custom",
          path: ["imageSrc"],
          message: "Image path and alt required.",
        });
      }
      if (!value.imageWidth || !value.imageHeight) {
        context.addIssue({
          code: "custom",
          path: ["imageWidth"],
          message: "Image dimensions required.",
        });
      }
    }
  });

export const adminVariantDeactivateSchema = z
  .object({
    productDomainId: productIdSchema,
    variantDomainId: variantDomainIdSchema,
  })
  .strict();

export const adminSpecificationUpsertSchema = z
  .object({
    productDomainId: productIdSchema,
    specificationId: z.string().uuid().optional(),
    labelAr: z.string().trim().min(1).max(80),
    valueAr: z.string().trim().min(1).max(200),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .strict();

export const adminSpecificationRemoveSchema = z
  .object({
    productDomainId: productIdSchema,
    specificationId: z.string().uuid(),
  })
  .strict();

export type AdminProductUpdate = z.infer<typeof adminProductUpdateSchema>;
export type AdminProductCreate = z.infer<typeof adminProductCreateSchema>;
export type AdminVariantUpsert = z.infer<typeof adminVariantUpsertSchema>;
export type AdminVariantDeactivate = z.infer<
  typeof adminVariantDeactivateSchema
>;
export type AdminSpecificationUpsert = z.infer<
  typeof adminSpecificationUpsertSchema
>;
export type AdminSpecificationRemove = z.infer<
  typeof adminSpecificationRemoveSchema
>;

export class AdminCatalogService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async list(actor: AdminActor): Promise<readonly Product[]> {
    assertOwnerActor(actor);
    const rows = await this.database
      .select()
      .from(schema.products)
      .orderBy(asc(schema.products.sortOrder), asc(schema.products.domainId));
    return this.mapProducts(rows);
  }

  async getByDomainId(
    actor: AdminActor,
    domainId: string,
  ): Promise<(Product & { sortOrder: number }) | null> {
    assertOwnerActor(actor);
    if (!productIdSchema.safeParse(domainId).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.products)
      .where(eq(schema.products.domainId, domainId))
      .limit(1);
    if (!row) return null;
    const [product] = await this.mapProducts([row]);
    if (!product) return null;
    return { ...product, sortOrder: row.sortOrder };
  }

  async update(
    actor: AdminActor,
    input: AdminProductUpdate,
  ): Promise<{ product: Product; slug: string }> {
    assertOwnerActor(actor);
    const parsed = adminProductUpdateSchema.safeParse(input);
    if (!parsed.success) throw new AdminCatalogError("invalid_input");

    const updated = await this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(schema.products)
        .where(eq(schema.products.domainId, parsed.data.domainId))
        .for("update");
      if (!existing) throw new AdminCatalogError("not_found");

      const now = new Date();
      const [row] = await transaction
        .update(schema.products)
        .set({
          nameAr: parsed.data.nameAr,
          latinName: parsed.data.latinName ?? null,
          priceAgorot: parsed.data.priceAgorot,
          categoryId: parsed.data.categoryId,
          availability: parsed.data.availability,
          sortOrder: parsed.data.sortOrder,
          description: parsed.data.description ?? null,
          usageNotes: parsed.data.usageNotes ?? null,
          unit: parsed.data.unit ?? null,
          detailsStatus: parsed.data.detailsStatus,
          imageKind: "placeholder",
          placeholderVariant: parsed.data.placeholderVariant,
          imageSrc: null,
          imageAlt: null,
          imageWidth: null,
          imageHeight: null,
          updatedAt: now,
        })
        .where(eq(schema.products.id, existing.id))
        .returning();
      if (!row) throw new AdminCatalogError("not_found");

      await this.syncDefaultVariantFromProduct(transaction, row, {
        priceAgorot: parsed.data.priceAgorot,
        availability: parsed.data.availability,
        imageKind: "placeholder",
        placeholderVariant: parsed.data.placeholderVariant,
        imageSrc: null,
        imageAlt: null,
        imageWidth: null,
        imageHeight: null,
      });

      const beforeState = redactProductAuditState(existing);
      const afterState = redactProductAuditState(row);
      assertSafeAuditState(beforeState);
      assertSafeAuditState(afterState);
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "product_update",
        entityType: "product",
        entityId: row.domainId,
        beforeState,
        afterState,
        createdAt: now,
      });
      return row;
    });

    const [product] = await this.mapProducts([updated]);
    if (!product) throw new AdminCatalogError("not_found");
    return { product, slug: updated.slug };
  }

  async create(actor: AdminActor, input: AdminProductCreate): Promise<Product> {
    assertOwnerActor(actor);
    const parsed = adminProductCreateSchema.safeParse(input);
    if (!parsed.success) throw new AdminCatalogError("invalid_input");

    try {
      const created = await this.database.transaction(async (transaction) => {
        const [row] = await transaction
          .insert(schema.products)
          .values({
            domainId: parsed.data.domainId,
            slug: parsed.data.slug,
            nameAr: parsed.data.nameAr,
            latinName: parsed.data.latinName ?? null,
            priceAgorot: parsed.data.priceAgorot,
            categoryId: parsed.data.categoryId,
            availability: "unavailable",
            sortOrder: parsed.data.sortOrder,
            description: parsed.data.description ?? null,
            usageNotes: parsed.data.usageNotes ?? null,
            unit: parsed.data.unit ?? null,
            detailsStatus: parsed.data.detailsStatus,
            imageKind: "placeholder",
            placeholderVariant: parsed.data.placeholderVariant,
          })
          .returning();
        if (!row) throw new AdminCatalogError("invalid_input");

        const defaultVariantId = `${row.domainId}--default`;
        const [variant] = await transaction
          .insert(schema.productVariants)
          .values({
            productId: row.id,
            domainId: defaultVariantId,
            labelAr: row.unit?.trim() || "الافتراضي",
            attributes: row.unit?.trim() ? { الوحدة: row.unit.trim() } : {},
            priceAgorot: row.priceAgorot,
            availability: "unavailable",
            imageKind: "placeholder",
            placeholderVariant: parsed.data.placeholderVariant,
            sortOrder: 0,
            isDefault: true,
          })
          .returning();
        if (!variant) throw new AdminCatalogError("invalid_input");

        const afterState = redactProductAuditState(row);
        assertSafeAuditState(afterState);
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "product_create",
          entityType: "product",
          entityId: row.domainId,
          beforeState: null,
          afterState,
        });

        const variantAudit = redactProductVariantAuditState(variant);
        assertSafeAuditState(variantAudit);
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "product_variant_create",
          entityType: "product_variant",
          entityId: variant.domainId,
          beforeState: null,
          afterState: variantAudit,
        });
        return row;
      });
      const [product] = await this.mapProducts([created]);
      if (!product) throw new AdminCatalogError("not_found");
      return product;
    } catch (error) {
      if (error instanceof AdminCatalogError) throw error;
      if (isUniqueViolation(error)) throw new AdminCatalogError("duplicate");
      throw error;
    }
  }

  async upsertVariant(
    actor: AdminActor,
    input: AdminVariantUpsert,
  ): Promise<Product> {
    assertOwnerActor(actor);
    const parsed = adminVariantUpsertSchema.safeParse(input);
    if (!parsed.success) throw new AdminCatalogError("invalid_input");

    const attributes = Object.fromEntries(
      parsed.data.attributes.map((pair) => [pair.key, pair.value]),
    );
    const attributesParsed = variantAttributesSchema.safeParse(attributes);
    if (!attributesParsed.success) {
      throw new AdminCatalogError("invalid_input");
    }

    try {
      await this.database.transaction(async (transaction) => {
        const [product] = await transaction
          .select()
          .from(schema.products)
          .where(eq(schema.products.domainId, parsed.data.productDomainId))
          .for("update");
        if (!product) throw new AdminCatalogError("not_found");

        const [existing] = await transaction
          .select()
          .from(schema.productVariants)
          .where(
            eq(schema.productVariants.domainId, parsed.data.variantDomainId),
          )
          .limit(1);

        if (existing && existing.productId !== product.id) {
          throw new AdminCatalogError("invalid_input");
        }

        const imageFields =
          parsed.data.imageMode === "placeholder"
            ? {
                imageKind: "placeholder" as const,
                placeholderVariant: parsed.data.placeholderVariant!,
                imageSrc: null,
                imageAlt: null,
                imageWidth: null,
                imageHeight: null,
              }
            : {
                imageKind: "image" as const,
                placeholderVariant: null,
                imageSrc: parsed.data.imageSrc!,
                imageAlt: parsed.data.imageAlt!,
                imageWidth: parsed.data.imageWidth!,
                imageHeight: parsed.data.imageHeight!,
              };

        if (parsed.data.isDefault) {
          await transaction
            .update(schema.productVariants)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(schema.productVariants.productId, product.id));
        }

        let saved: typeof schema.productVariants.$inferSelect;
        if (existing) {
          const [row] = await transaction
            .update(schema.productVariants)
            .set({
              labelAr: parsed.data.labelAr,
              attributes: attributesParsed.data,
              priceAgorot: parsed.data.priceAgorot,
              availability: parsed.data.availability,
              sortOrder: parsed.data.sortOrder,
              isDefault: parsed.data.isDefault,
              ...imageFields,
              updatedAt: new Date(),
            })
            .where(eq(schema.productVariants.id, existing.id))
            .returning();
          if (!row) throw new AdminCatalogError("not_found");
          saved = row;

          const beforeState = redactProductVariantAuditState(existing);
          const afterState = redactProductVariantAuditState(saved);
          assertSafeAuditState(beforeState);
          assertSafeAuditState(afterState);
          await transaction.insert(schema.adminAuditEvents).values({
            adminUserId: actor.id,
            actionType: "product_variant_update",
            entityType: "product_variant",
            entityId: saved.domainId,
            beforeState,
            afterState,
          });
        } else {
          if (!parsed.data.isDefault) {
            const [defaultVariant] = await transaction
              .select()
              .from(schema.productVariants)
              .where(
                and(
                  eq(schema.productVariants.productId, product.id),
                  eq(schema.productVariants.isDefault, true),
                ),
              )
              .limit(1);
            if (!defaultVariant) {
              throw new AdminCatalogError("last_default");
            }
          }

          const [row] = await transaction
            .insert(schema.productVariants)
            .values({
              productId: product.id,
              domainId: parsed.data.variantDomainId,
              labelAr: parsed.data.labelAr,
              attributes: attributesParsed.data,
              priceAgorot: parsed.data.priceAgorot,
              availability: parsed.data.availability,
              sortOrder: parsed.data.sortOrder,
              isDefault: parsed.data.isDefault,
              ...imageFields,
            })
            .returning();
          if (!row) throw new AdminCatalogError("invalid_input");
          saved = row;

          const afterState = redactProductVariantAuditState(saved);
          assertSafeAuditState(afterState);
          await transaction.insert(schema.adminAuditEvents).values({
            adminUserId: actor.id,
            actionType: "product_variant_create",
            entityType: "product_variant",
            entityId: saved.domainId,
            beforeState: null,
            afterState,
          });
        }

        if (saved.isDefault) {
          await this.syncProductFromVariant(transaction, product, saved);
        }
      });
    } catch (error) {
      if (error instanceof AdminCatalogError) throw error;
      if (isUniqueViolation(error)) throw new AdminCatalogError("duplicate");
      throw error;
    }

    const product = await this.getByDomainId(
      actor,
      parsed.data.productDomainId,
    );
    if (!product) throw new AdminCatalogError("not_found");
    return product;
  }

  async deactivateVariant(
    actor: AdminActor,
    input: AdminVariantDeactivate,
  ): Promise<Product> {
    assertOwnerActor(actor);
    const parsed = adminVariantDeactivateSchema.safeParse(input);
    if (!parsed.success) throw new AdminCatalogError("invalid_input");

    await this.database.transaction(async (transaction) => {
      const [product] = await transaction
        .select()
        .from(schema.products)
        .where(eq(schema.products.domainId, parsed.data.productDomainId))
        .for("update");
      if (!product) throw new AdminCatalogError("not_found");

      const [variant] = await transaction
        .select()
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.productId, product.id),
            eq(schema.productVariants.domainId, parsed.data.variantDomainId),
          ),
        )
        .for("update");
      if (!variant) throw new AdminCatalogError("not_found");

      if (variant.isDefault) {
        throw new AdminCatalogError("last_default");
      }

      const [inUse] = await transaction
        .select({ id: schema.orderItems.id })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.variantDomainId, variant.domainId))
        .limit(1);
      if (inUse) throw new AdminCatalogError("in_use");

      const [updated] = await transaction
        .update(schema.productVariants)
        .set({ availability: "unavailable", updatedAt: new Date() })
        .where(eq(schema.productVariants.id, variant.id))
        .returning();
      if (!updated) throw new AdminCatalogError("not_found");

      const beforeState = redactProductVariantAuditState(variant);
      const afterState = redactProductVariantAuditState(updated);
      assertSafeAuditState(beforeState);
      assertSafeAuditState(afterState);
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "product_variant_deactivate",
        entityType: "product_variant",
        entityId: updated.domainId,
        beforeState,
        afterState,
      });
    });

    const product = await this.getByDomainId(
      actor,
      parsed.data.productDomainId,
    );
    if (!product) throw new AdminCatalogError("not_found");
    return product;
  }

  async upsertSpecification(
    actor: AdminActor,
    input: AdminSpecificationUpsert,
  ): Promise<Product> {
    assertOwnerActor(actor);
    const parsed = adminSpecificationUpsertSchema.safeParse(input);
    if (!parsed.success) throw new AdminCatalogError("invalid_input");

    try {
      await this.database.transaction(async (transaction) => {
        const [product] = await transaction
          .select()
          .from(schema.products)
          .where(eq(schema.products.domainId, parsed.data.productDomainId))
          .for("update");
        if (!product) throw new AdminCatalogError("not_found");

        if (parsed.data.specificationId) {
          const [existing] = await transaction
            .select()
            .from(schema.productSpecifications)
            .where(
              and(
                eq(
                  schema.productSpecifications.id,
                  parsed.data.specificationId,
                ),
                eq(schema.productSpecifications.productId, product.id),
              ),
            )
            .for("update");
          if (!existing) throw new AdminCatalogError("not_found");

          const [updated] = await transaction
            .update(schema.productSpecifications)
            .set({
              labelAr: parsed.data.labelAr,
              valueAr: parsed.data.valueAr,
              sortOrder: parsed.data.sortOrder,
              updatedAt: new Date(),
            })
            .where(eq(schema.productSpecifications.id, existing.id))
            .returning();
          if (!updated) throw new AdminCatalogError("not_found");

          const beforeState = redactProductSpecificationAuditState(existing);
          const afterState = redactProductSpecificationAuditState(updated);
          assertSafeAuditState(beforeState);
          assertSafeAuditState(afterState);
          await transaction.insert(schema.adminAuditEvents).values({
            adminUserId: actor.id,
            actionType: "product_specification_update",
            entityType: "product_specification",
            entityId: updated.id,
            beforeState,
            afterState,
          });
          return;
        }

        const [created] = await transaction
          .insert(schema.productSpecifications)
          .values({
            productId: product.id,
            labelAr: parsed.data.labelAr,
            valueAr: parsed.data.valueAr,
            sortOrder: parsed.data.sortOrder,
          })
          .returning();
        if (!created) throw new AdminCatalogError("invalid_input");

        const afterState = redactProductSpecificationAuditState(created);
        assertSafeAuditState(afterState);
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "product_specification_create",
          entityType: "product_specification",
          entityId: created.id,
          beforeState: null,
          afterState,
        });
      });
    } catch (error) {
      if (error instanceof AdminCatalogError) throw error;
      if (isUniqueViolation(error)) throw new AdminCatalogError("duplicate");
      throw error;
    }

    const product = await this.getByDomainId(
      actor,
      parsed.data.productDomainId,
    );
    if (!product) throw new AdminCatalogError("not_found");
    return product;
  }

  async removeSpecification(
    actor: AdminActor,
    input: AdminSpecificationRemove,
  ): Promise<Product> {
    assertOwnerActor(actor);
    const parsed = adminSpecificationRemoveSchema.safeParse(input);
    if (!parsed.success) throw new AdminCatalogError("invalid_input");

    await this.database.transaction(async (transaction) => {
      const [product] = await transaction
        .select()
        .from(schema.products)
        .where(eq(schema.products.domainId, parsed.data.productDomainId))
        .for("update");
      if (!product) throw new AdminCatalogError("not_found");

      const [existing] = await transaction
        .select()
        .from(schema.productSpecifications)
        .where(
          and(
            eq(schema.productSpecifications.id, parsed.data.specificationId),
            eq(schema.productSpecifications.productId, product.id),
          ),
        )
        .for("update");
      if (!existing) throw new AdminCatalogError("not_found");

      await transaction
        .delete(schema.productSpecifications)
        .where(eq(schema.productSpecifications.id, existing.id));

      const beforeState = redactProductSpecificationAuditState(existing);
      assertSafeAuditState(beforeState);
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "product_specification_remove",
        entityType: "product_specification",
        entityId: existing.id,
        beforeState,
        afterState: null,
      });
    });

    const product = await this.getByDomainId(
      actor,
      parsed.data.productDomainId,
    );
    if (!product) throw new AdminCatalogError("not_found");
    return product;
  }

  private async mapProducts(
    rows: (typeof schema.products.$inferSelect)[],
  ): Promise<Product[]> {
    if (!rows.length) return [];
    const productIds = rows.map((row) => row.id);
    const [variantRows, specRows] = await Promise.all([
      this.database
        .select()
        .from(schema.productVariants)
        .where(inArray(schema.productVariants.productId, productIds))
        .orderBy(asc(schema.productVariants.sortOrder)),
      this.database
        .select()
        .from(schema.productSpecifications)
        .where(inArray(schema.productSpecifications.productId, productIds))
        .orderBy(asc(schema.productSpecifications.sortOrder)),
    ]);

    const variantsByProductId = new Map<
      string,
      (typeof schema.productVariants.$inferSelect)[]
    >();
    for (const variant of variantRows) {
      const list = variantsByProductId.get(variant.productId) ?? [];
      list.push(variant);
      variantsByProductId.set(variant.productId, list);
    }

    const specsByProductId = new Map<
      string,
      (typeof schema.productSpecifications.$inferSelect)[]
    >();
    for (const spec of specRows) {
      const list = specsByProductId.get(spec.productId) ?? [];
      list.push(spec);
      specsByProductId.set(spec.productId, list);
    }

    return rows.map((row) =>
      mapProductRow(
        row,
        variantsByProductId.get(row.id) ?? [],
        specsByProductId.get(row.id) ?? [],
      ),
    );
  }

  private async syncProductFromVariant(
    transaction: PostgresJsDatabase<typeof schema>,
    product: typeof schema.products.$inferSelect,
    variant: typeof schema.productVariants.$inferSelect,
  ): Promise<void> {
    await transaction
      .update(schema.products)
      .set({
        priceAgorot: variant.priceAgorot,
        availability: variant.availability,
        imageKind: variant.imageKind,
        placeholderVariant: variant.placeholderVariant,
        imageSrc: variant.imageSrc,
        imageAlt: variant.imageAlt,
        imageWidth: variant.imageWidth,
        imageHeight: variant.imageHeight,
        updatedAt: new Date(),
      })
      .where(eq(schema.products.id, product.id));
  }

  private async syncDefaultVariantFromProduct(
    transaction: PostgresJsDatabase<typeof schema>,
    product: typeof schema.products.$inferSelect,
    patch: {
      priceAgorot: number;
      availability: (typeof productAvailabilityValues)[number];
      imageKind: "placeholder" | "image";
      placeholderVariant: (typeof placeholderKinds)[number] | null;
      imageSrc: string | null;
      imageAlt: string | null;
      imageWidth: number | null;
      imageHeight: number | null;
    },
  ): Promise<void> {
    const [defaultVariant] = await transaction
      .select()
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.productId, product.id),
          eq(schema.productVariants.isDefault, true),
        ),
      )
      .limit(1);
    if (!defaultVariant) return;

    await transaction
      .update(schema.productVariants)
      .set({
        priceAgorot: patch.priceAgorot,
        availability: patch.availability,
        imageKind: patch.imageKind,
        placeholderVariant: patch.placeholderVariant,
        imageSrc: patch.imageSrc,
        imageAlt: patch.imageAlt,
        imageWidth: patch.imageWidth,
        imageHeight: patch.imageHeight,
        updatedAt: new Date(),
      })
      .where(eq(schema.productVariants.id, defaultVariant.id));
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
