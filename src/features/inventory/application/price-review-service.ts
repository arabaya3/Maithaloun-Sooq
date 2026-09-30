import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission } from "@/features/admin/domain/permissions";
import {
  compareCostToSalePrice,
  type CostComparison,
} from "@/features/inventory/domain/pricing";
import type { PriceReviewStatus } from "@/features/purchasing/domain/purchase-constants";
import * as schema from "@/server/db/schema";

import { InventoryError, type Database } from "./stock-ledger";

export const priceReviewDecisionSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(["keep", "later", "change"]),
    newPriceAgorot: z.number().int().min(1).max(10_000_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.action === "change") === (value.newPriceAgorot !== undefined),
  );

export interface PriceReviewItem {
  id: string;
  variantId: string;
  productSlug: string;
  name: string;
  variantLabel: string | null;
  status: PriceReviewStatus;
  createdAt: string;
  comparison: CostComparison;
}

export class PriceReviewService {
  constructor(private readonly database: Database) {}

  async listOpen(actor: AdminActor): Promise<PriceReviewItem[]> {
    assertPermission(actor, "pricing.review");
    const rows = await this.database
      .select({
        review: schema.priceReviews,
        variantId: schema.productVariants.domainId,
        labelAr: schema.productVariants.labelAr,
        priceAgorot: schema.productVariants.priceAgorot,
        nameAr: schema.products.nameAr,
        latinName: schema.products.latinName,
        slug: schema.products.slug,
      })
      .from(schema.priceReviews)
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.priceReviews.variantId),
      )
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(inArray(schema.priceReviews.status, ["pending", "later"]))
      .orderBy(desc(schema.priceReviews.createdAt))
      .limit(100);

    return rows.map((row) => ({
      id: row.review.id,
      variantId: row.variantId,
      productSlug: row.slug,
      name: row.latinName ? `${row.nameAr} ${row.latinName}` : row.nameAr,
      variantLabel: row.labelAr === "الافتراضي" ? null : row.labelAr,
      status: row.review.status,
      createdAt: row.review.createdAt.toISOString(),
      // Percentages and profit come from code, against the price the customer pays today.
      comparison: compareCostToSalePrice({
        previousCostAgorot: row.review.previousCostAgorot,
        newCostAgorot: row.review.newCostAgorot,
        salePriceAgorot: row.priceAgorot,
      }),
    }));
  }

  async countPending(actor: AdminActor): Promise<number> {
    return (await this.listOpen(actor)).filter(
      (item) => item.status === "pending",
    ).length;
  }

  async decide(
    actor: AdminActor,
    input: z.input<typeof priceReviewDecisionSchema>,
  ): Promise<{ productSlug: string | null }> {
    assertPermission(actor, "pricing.review");
    const parsed = priceReviewDecisionSchema.safeParse(input);
    if (!parsed.success) throw new InventoryError("invalid_input");
    const data = parsed.data;

    return this.database.transaction(async (transaction) => {
      const [review] = await transaction
        .select()
        .from(schema.priceReviews)
        .where(
          and(
            eq(schema.priceReviews.id, data.id),
            inArray(schema.priceReviews.status, ["pending", "later"]),
          ),
        )
        .for("update");
      if (!review) throw new InventoryError("not_found");

      const now = new Date();
      let productSlug: string | null = null;
      let previousPriceAgorot: number | null = null;
      if (data.action === "change") {
        const [variant] = await transaction
          .select()
          .from(schema.productVariants)
          .where(eq(schema.productVariants.id, review.variantId))
          .for("update");
        if (!variant) throw new InventoryError("not_found");
        previousPriceAgorot = variant.priceAgorot;
        await transaction
          .update(schema.productVariants)
          .set({ priceAgorot: data.newPriceAgorot!, updatedAt: now })
          .where(eq(schema.productVariants.id, variant.id));
        const [product] = await transaction
          .select({ id: schema.products.id, slug: schema.products.slug })
          .from(schema.products)
          .where(eq(schema.products.id, variant.productId));
        productSlug = product?.slug ?? null;
        // The product row mirrors its default variant's price.
        if (variant.isDefault && product) {
          await transaction
            .update(schema.products)
            .set({ priceAgorot: data.newPriceAgorot!, updatedAt: now })
            .where(eq(schema.products.id, product.id));
        }
      }

      const status: PriceReviewStatus =
        data.action === "keep"
          ? "kept"
          : data.action === "later"
            ? "later"
            : "price_changed";
      await transaction
        .update(schema.priceReviews)
        .set({
          status,
          newSalePriceAgorot: data.newPriceAgorot ?? null,
          resolvedBy: actor.id,
          resolvedAt: now,
        })
        .where(eq(schema.priceReviews.id, review.id));
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "price_review_decision",
        entityType: "price_review",
        entityId: review.id,
        beforeState: {
          status: review.status,
          priceAgorot: previousPriceAgorot,
        },
        afterState: { status, priceAgorot: data.newPriceAgorot ?? null },
        createdAt: now,
      });
      return { productSlug };
    });
  }
}
