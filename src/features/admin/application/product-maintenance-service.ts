import "server-only";

import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  assertOperationsActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { assertSafeAuditState } from "@/features/admin/domain/audit";
import { assertPermission } from "@/features/admin/domain/permissions";
import { productIdSchema } from "@/features/catalog/domain/product";
import {
  getDefaultLocationId,
  type Database,
} from "@/features/inventory/application/stock-ledger";
import { transferStockInTransaction } from "@/features/inventory/application/inventory-service";
import * as schema from "@/server/db/schema";

export class ProductMaintenanceError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "invalid_input"
      | "in_use"
      | "archived"
      | "reserved_stock"
      | "same_product",
  ) {
    super(code);
    this.name = "ProductMaintenanceError";
  }
}

const archiveSchema = z
  .object({
    domainId: productIdSchema,
    reason: z.string().trim().min(2).max(200),
  })
  .strict();

const mergeSchema = z
  .object({
    idempotencyKey: z.uuid(),
    sourceDomainId: productIdSchema,
    targetDomainId: productIdSchema,
  })
  .strict();

function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: string }).code === "23503") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface ProductReferenceSummary {
  orders: number;
  purchases: number;
  sales: number;
  stockMovements: number;
}

export class ProductMaintenanceService {
  constructor(private readonly database: Database) {}

  async references(
    actor: AdminActor,
    domainId: string,
  ): Promise<ProductReferenceSummary | null> {
    assertOperationsActor(actor);
    const [product] = await this.database
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.domainId, domainId))
      .limit(1);
    if (!product) return null;
    const variants = await this.database
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, product.id));
    const variantIds = variants.map((row) => row.id);
    const count = async (query: Promise<{ id: string }[]>) =>
      (await query).length;
    const none = Promise.resolve([] as { id: string }[]);
    const [orders, purchases, sales, stockMovements] = await Promise.all([
      count(
        this.database
          .select({ id: schema.orderItems.id })
          .from(schema.orderItems)
          .where(eq(schema.orderItems.productDomainId, domainId))
          .limit(1000),
      ),
      count(
        variantIds.length
          ? this.database
              .select({ id: schema.purchaseInvoiceItems.id })
              .from(schema.purchaseInvoiceItems)
              .where(inArray(schema.purchaseInvoiceItems.variantId, variantIds))
              .limit(1000)
          : none,
      ),
      count(
        variantIds.length
          ? this.database
              .select({ id: schema.customerInvoiceLines.id })
              .from(schema.customerInvoiceLines)
              .where(inArray(schema.customerInvoiceLines.variantId, variantIds))
              .limit(1000)
          : none,
      ),
      count(
        variantIds.length
          ? this.database
              .select({ id: schema.stockMovements.id })
              .from(schema.stockMovements)
              .innerJoin(
                schema.inventoryItems,
                eq(
                  schema.inventoryItems.id,
                  schema.stockMovements.inventoryItemId,
                ),
              )
              .where(inArray(schema.inventoryItems.variantId, variantIds))
              .limit(1000)
          : none,
      ),
    ]);
    return { orders, purchases, sales, stockMovements };
  }

  async archive(
    actor: AdminActor,
    input: z.infer<typeof archiveSchema>,
  ): Promise<{ domainId: string; replayed: boolean }> {
    assertPermission(actor, "settings.manage");
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success) throw new ProductMaintenanceError("invalid_input");
    return this.database.transaction(async (transaction) => {
      const [product] = await transaction
        .select()
        .from(schema.products)
        .where(eq(schema.products.domainId, parsed.data.domainId))
        .for("update");
      if (!product) throw new ProductMaintenanceError("not_found");
      if (product.archivedAt) {
        return { domainId: product.domainId, replayed: true };
      }
      const now = new Date();
      await transaction
        .update(schema.products)
        .set({ archivedAt: now, availability: "unavailable", updatedAt: now })
        .where(eq(schema.products.id, product.id));
      await transaction
        .update(schema.productVariants)
        .set({ availability: "unavailable", updatedAt: now })
        .where(eq(schema.productVariants.productId, product.id));
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "product_archive",
        entityType: "product",
        entityId: product.domainId,
        beforeState: { availability: product.availability },
        afterState: { archived: true, reason: parsed.data.reason },
        createdAt: now,
      });
      return { domainId: product.domainId, replayed: false };
    });
  }

  // Only a product nothing points to can disappear; the foreign keys decide.
  async deleteUnreferenced(
    actor: AdminActor,
    domainId: string,
  ): Promise<{ deleted: boolean }> {
    assertPermission(actor, "settings.manage");
    if (!productIdSchema.safeParse(domainId).success) {
      throw new ProductMaintenanceError("invalid_input");
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const [product] = await transaction
          .select()
          .from(schema.products)
          .where(eq(schema.products.domainId, domainId))
          .for("update");
        if (!product) return { deleted: false };
        await transaction
          .delete(schema.products)
          .where(eq(schema.products.id, product.id));
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "product_delete",
          entityType: "product",
          entityId: product.domainId,
          beforeState: { nameAr: product.nameAr },
          afterState: { deleted: true },
        });
        return { deleted: true };
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ProductMaintenanceError("in_use");
      }
      throw error;
    }
  }

  async merge(
    actor: AdminActor,
    input: z.infer<typeof mergeSchema>,
  ): Promise<{ movedVariants: number; replayed: boolean }> {
    assertPermission(actor, "settings.manage");
    assertPermission(actor, "stock.adjust");
    const parsed = mergeSchema.safeParse(input);
    if (!parsed.success) throw new ProductMaintenanceError("invalid_input");
    const data = parsed.data;
    if (data.sourceDomainId === data.targetDomainId) {
      throw new ProductMaintenanceError("same_product");
    }

    return this.database.transaction(async (transaction) => {
      const products = await transaction
        .select()
        .from(schema.products)
        .where(
          inArray(schema.products.domainId, [
            data.sourceDomainId,
            data.targetDomainId,
          ]),
        )
        .orderBy(asc(schema.products.id))
        .for("update");
      const source = products.find(
        (row) => row.domainId === data.sourceDomainId,
      );
      const target = products.find(
        (row) => row.domainId === data.targetDomainId,
      );
      if (!source || !target) throw new ProductMaintenanceError("not_found");
      if (source.mergedIntoProductId === target.id) {
        return { movedVariants: 0, replayed: true };
      }
      if (source.archivedAt || target.archivedAt) {
        throw new ProductMaintenanceError("archived");
      }

      const [targetVariant] = await transaction
        .select()
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.productId, target.id),
            eq(schema.productVariants.isDefault, true),
          ),
        )
        .limit(1);
      if (!targetVariant) throw new ProductMaintenanceError("not_found");

      const locationId = await getDefaultLocationId(transaction);
      const sourceVariants = await transaction
        .select({
          id: schema.productVariants.id,
          domainId: schema.productVariants.domainId,
          onHandMilli: schema.inventoryItems.onHandMilli,
          reservedMilli: schema.inventoryItems.reservedMilli,
        })
        .from(schema.productVariants)
        .leftJoin(
          schema.inventoryItems,
          and(
            eq(schema.inventoryItems.variantId, schema.productVariants.id),
            eq(schema.inventoryItems.locationId, locationId),
          ),
        )
        .where(eq(schema.productVariants.productId, source.id));
      if (sourceVariants.some((row) => (row.reservedMilli ?? 0) > 0)) {
        throw new ProductMaintenanceError("reserved_stock");
      }

      let movedVariants = 0;
      for (const variant of sourceVariants) {
        if ((variant.onHandMilli ?? 0) <= 0) continue;
        await transferStockInTransaction(transaction, actor.id, {
          idempotencyKey: `${data.idempotencyKey}:${variant.domainId}`,
          fromVariantId: variant.domainId,
          toVariantId: targetVariant.domainId,
          quantityMilli: variant.onHandMilli ?? 0,
          note: `دمج ${source.nameAr} في ${target.nameAr}`.slice(0, 200),
        });
        movedVariants += 1;
      }

      const sourceVariantIds = sourceVariants.map((row) => row.id);
      if (sourceVariantIds.length) {
        // Aliases that would collide with one the target already has are left on the archived product.
        const existing = await transaction
          .select({
            supplierId: schema.supplierProductAliases.supplierId,
            normalizedAlias: schema.supplierProductAliases.normalizedAlias,
          })
          .from(schema.supplierProductAliases)
          .where(eq(schema.supplierProductAliases.variantId, targetVariant.id));
        const taken = new Set(
          existing.map((row) => `${row.supplierId}:${row.normalizedAlias}`),
        );
        const aliases = await transaction
          .select()
          .from(schema.supplierProductAliases)
          .where(
            inArray(schema.supplierProductAliases.variantId, sourceVariantIds),
          );
        for (const alias of aliases) {
          const key = `${alias.supplierId}:${alias.normalizedAlias}`;
          if (taken.has(key)) continue;
          taken.add(key);
          await transaction
            .update(schema.supplierProductAliases)
            .set({ variantId: targetVariant.id })
            .where(eq(schema.supplierProductAliases.id, alias.id));
        }
      }

      const now = new Date();
      await transaction
        .update(schema.products)
        .set({
          archivedAt: now,
          mergedIntoProductId: target.id,
          availability: "unavailable",
          updatedAt: now,
        })
        .where(eq(schema.products.id, source.id));
      await transaction
        .update(schema.productVariants)
        .set({ availability: "unavailable", updatedAt: now })
        .where(eq(schema.productVariants.productId, source.id));

      const afterState = {
        mergedInto: target.domainId,
        movedVariants,
      };
      assertSafeAuditState(afterState);
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "product_merge",
        entityType: "product",
        entityId: source.domainId,
        beforeState: { archived: false },
        afterState,
        createdAt: now,
      });
      return { movedVariants, replayed: false };
    });
  }

  async onHandByVariant(
    productDomainId: string,
  ): Promise<
    Array<{ variantId: string; onHandMilli: number; reservedMilli: number }>
  > {
    const locationId = await getDefaultLocationId(this.database);
    return this.database
      .select({
        variantId: schema.productVariants.domainId,
        onHandMilli: schema.inventoryItems.onHandMilli,
        reservedMilli: schema.inventoryItems.reservedMilli,
      })
      .from(schema.inventoryItems)
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.inventoryItems.variantId),
      )
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(
        and(
          eq(schema.products.domainId, productDomainId),
          eq(schema.inventoryItems.locationId, locationId),
          gt(schema.inventoryItems.onHandMilli, 0),
          isNull(schema.products.archivedAt),
        ),
      );
  }
}
