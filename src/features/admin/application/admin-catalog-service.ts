import "server-only";

import { asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import {
  assertOwnerActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import {
  assertSafeAuditState,
  redactProductAuditState,
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
import { mapProductRow } from "@/features/catalog/infrastructure/product-row-mapper";
import * as schema from "@/server/db/schema";

export class AdminCatalogError extends Error {
  constructor(readonly code: "not_found" | "invalid_input" | "duplicate") {
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

export type AdminProductUpdate = z.infer<typeof adminProductUpdateSchema>;
export type AdminProductCreate = z.infer<typeof adminProductCreateSchema>;

export class AdminCatalogService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async list(actor: AdminActor): Promise<readonly Product[]> {
    assertOwnerActor(actor);
    const rows = await this.database
      .select()
      .from(schema.products)
      .orderBy(asc(schema.products.sortOrder), asc(schema.products.domainId));
    return rows.map(mapProductRow);
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
    return { ...mapProductRow(row), sortOrder: row.sortOrder };
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

    return { product: mapProductRow(updated), slug: updated.slug };
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
        return row;
      });
      return mapProductRow(created);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AdminCatalogError("duplicate");
      throw error;
    }
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
