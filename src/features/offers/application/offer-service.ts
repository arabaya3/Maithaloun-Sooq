import "server-only";

import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertSafeAuditState } from "@/features/admin/domain/audit";
import { assertPermission } from "@/features/admin/domain/permissions";
import {
  isOfferLive,
  offerKinds,
  offerUnitPrice,
  windowsOverlap,
  type OfferKind,
} from "@/features/catalog/domain/offer-pricing";
import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export class OfferError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "invalid_input"
      | "invalid_price"
      | "conflict"
      | "in_use"
      | "empty_target"
      | "stale",
    readonly detail?: string,
  ) {
    super(code);
    this.name = "OfferError";
  }
}

const domainId = z.string().regex(/^[a-z0-9-]{1,100}$/);

export const offerTargetsSchema = z
  .object({
    productIds: z.array(domainId).max(50).default([]),
    variantIds: z.array(domainId).max(50).default([]),
    categoryCodes: z.array(z.string().max(40)).max(10).default([]),
  })
  .strict();
export type OfferTargets = z.infer<typeof offerTargetsSchema>;

export const offerInputSchema = z
  .object({
    nameAr: z.string().trim().min(2).max(80),
    displayText: z.string().trim().max(120).nullable(),
    kind: z.enum(offerKinds),
    value: z.number().int().positive().max(10_000_000),
    minQuantity: z.number().int().min(1).max(100),
    startsAt: z.date().nullable(),
    endsAt: z.date().nullable(),
    enabled: z.boolean(),
    targets: offerTargetsSchema,
  })
  .strict();
export type OfferInput = z.infer<typeof offerInputSchema>;

export interface OfferVariantPreview {
  variantId: string;
  label: string;
  listPriceAgorot: number;
  finalPriceAgorot: number | null;
  avgCostAgorot: number | null;
}

export interface OfferSummary {
  id: string;
  nameAr: string;
  displayText: string | null;
  kind: OfferKind;
  value: number;
  minQuantity: number;
  startsAt: string | null;
  endsAt: string | null;
  enabled: boolean;
  archived: boolean;
  live: boolean;
  targets: OfferTargets;
  usage: number;
  updatedAt: string;
}

export class OfferService {
  constructor(private readonly database: Database) {}

  // Every variant an offer would price, resolved from its products, variants and categories.
  async resolveVariants(
    executor: Executor,
    targets: OfferTargets,
  ): Promise<OfferVariantPreview[]> {
    const conditions = [
      targets.variantIds.length
        ? inArray(schema.productVariants.domainId, targets.variantIds)
        : undefined,
      targets.productIds.length
        ? inArray(schema.products.domainId, targets.productIds)
        : undefined,
      targets.categoryCodes.length
        ? inArray(schema.products.categoryId, targets.categoryCodes)
        : undefined,
    ].filter(Boolean);
    if (!conditions.length) return [];
    const rows = await executor
      .select({
        variantId: schema.productVariants.domainId,
        variantUuid: schema.productVariants.id,
        labelAr: schema.productVariants.labelAr,
        variantCount: sql<number>`(select count(*)::int from ${schema.productVariants} v2 where v2.product_id = "products"."id" and v2.archived_at is null)`,
        nameAr: schema.products.nameAr,
        latinName: schema.products.latinName,
        priceAgorot: schema.productVariants.priceAgorot,
        avgCostAgorot: schema.inventoryItems.avgCostAgorot,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .leftJoin(
        schema.inventoryItems,
        eq(schema.inventoryItems.variantId, schema.productVariants.id),
      )
      .where(
        and(
          isNull(schema.productVariants.archivedAt),
          isNull(schema.products.archivedAt),
          sql`(${sql.join(conditions as never[], sql` OR `)})`,
        ),
      );
    const seen = new Set<string>();
    return rows
      .filter((row) => !seen.has(row.variantId) && seen.add(row.variantId))
      .map((row) => {
        // Several products share an Arabic name (three floor cleaners); the Latin name tells them apart.
        const name = row.latinName
          ? `${row.nameAr} ${row.latinName}`
          : row.nameAr;
        return {
          variantId: row.variantId,
          label:
            Number(row.variantCount) > 1 ? `${name} — ${row.labelAr}` : name,
          listPriceAgorot: row.priceAgorot,
          finalPriceAgorot: null,
          avgCostAgorot: row.avgCostAgorot,
        };
      });
  }

  async preview(
    input: Pick<OfferInput, "kind" | "value" | "targets">,
    executor: Executor = this.database,
  ): Promise<OfferVariantPreview[]> {
    const variants = await this.resolveVariants(executor, input.targets);
    return variants.map((row) => ({
      ...row,
      finalPriceAgorot: offerUnitPrice(row.listPriceAgorot, input),
    }));
  }

  // Enabled offers with overlapping dates may not price the same variant.
  async conflicts(
    input: Pick<OfferInput, "startsAt" | "endsAt" | "targets">,
    exceptOfferId?: string,
    executor: Executor = this.database,
  ): Promise<Array<{ offerId: string; nameAr: string; variants: string[] }>> {
    const mine = new Set(
      (await this.resolveVariants(executor, input.targets)).map(
        (row) => row.variantId,
      ),
    );
    if (!mine.size) return [];
    const others = await executor
      .select()
      .from(schema.offers)
      .where(
        and(
          eq(schema.offers.enabled, true),
          isNull(schema.offers.archivedAt),
          exceptOfferId ? ne(schema.offers.id, exceptOfferId) : undefined,
        ),
      );
    const found = [];
    for (const other of others) {
      if (!windowsOverlap(input, other)) continue;
      const targets = await this.targetsOf(executor, other.id);
      const shared = (await this.resolveVariants(executor, targets))
        .filter((row) => mine.has(row.variantId))
        .map((row) => row.label);
      if (shared.length) {
        found.push({
          offerId: other.id,
          nameAr: other.nameAr,
          variants: shared,
        });
      }
    }
    return found;
  }

  private async targetsOf(
    executor: Executor,
    offerId: string,
  ): Promise<OfferTargets> {
    const rows = await executor
      .select({
        productId: schema.products.domainId,
        variantId: schema.productVariants.domainId,
        categoryCode: schema.offerTargets.categoryCode,
      })
      .from(schema.offerTargets)
      .leftJoin(
        schema.products,
        eq(schema.products.id, schema.offerTargets.productId),
      )
      .leftJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.offerTargets.variantId),
      )
      .where(eq(schema.offerTargets.offerId, offerId));
    return {
      productIds: rows.flatMap((row) => (row.productId ? [row.productId] : [])),
      variantIds: rows.flatMap((row) => (row.variantId ? [row.variantId] : [])),
      categoryCodes: rows.flatMap((row) =>
        row.categoryCode ? [row.categoryCode] : [],
      ),
    };
  }

  private async summary(
    executor: Executor,
    row: typeof schema.offers.$inferSelect,
  ) {
    const [usage] = await executor
      .select({ value: count() })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.offerId, row.id));
    return {
      id: row.id,
      nameAr: row.nameAr,
      displayText: row.displayText,
      kind: row.kind,
      value: row.value,
      minQuantity: row.minQuantity,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      enabled: row.enabled,
      archived: Boolean(row.archivedAt),
      live: isOfferLive(row, new Date()),
      targets: await this.targetsOf(executor, row.id),
      usage: Number(usage?.value ?? 0),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies OfferSummary;
  }

  async list(
    actor: AdminActor,
    query: { search?: string; includeArchived?: boolean } = {},
  ): Promise<OfferSummary[]> {
    assertPermission(actor, "settings.manage");
    const rows = await this.database
      .select()
      .from(schema.offers)
      .where(
        query.includeArchived ? undefined : isNull(schema.offers.archivedAt),
      )
      .orderBy(desc(schema.offers.updatedAt))
      .limit(50);
    const needle = query.search?.trim() ?? "";
    const filtered = needle
      ? rows.filter((row) => row.nameAr.includes(needle))
      : rows;
    return Promise.all(filtered.map((row) => this.summary(this.database, row)));
  }

  async get(actor: AdminActor, offerId: string): Promise<OfferSummary | null> {
    assertPermission(actor, "settings.manage");
    if (!z.uuid().safeParse(offerId).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.offers)
      .where(eq(schema.offers.id, offerId))
      .limit(1);
    return row ? this.summary(this.database, row) : null;
  }

  async version(offerId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ updatedAt: schema.offers.updatedAt })
      .from(schema.offers)
      .where(eq(schema.offers.id, offerId))
      .limit(1);
    return row ? row.updatedAt.toISOString() : null;
  }

  private async lock(transaction: Transaction) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('offers'))`,
    );
  }

  private async validate(
    transaction: Transaction,
    input: OfferInput,
    exceptOfferId?: string,
  ) {
    const preview = await this.preview(input, transaction);
    if (!preview.length) throw new OfferError("empty_target");
    const invalid = preview.find((row) => row.finalPriceAgorot === null);
    if (invalid) throw new OfferError("invalid_price", invalid.label);
    if (input.enabled) {
      const conflicts = await this.conflicts(input, exceptOfferId, transaction);
      if (conflicts.length)
        throw new OfferError("conflict", conflicts[0]!.nameAr);
    }
  }

  private async writeTargets(
    transaction: Transaction,
    offerId: string,
    targets: OfferTargets,
  ) {
    await transaction
      .delete(schema.offerTargets)
      .where(eq(schema.offerTargets.offerId, offerId));
    const [products, variants] = await Promise.all([
      targets.productIds.length
        ? transaction
            .select({ id: schema.products.id })
            .from(schema.products)
            .where(inArray(schema.products.domainId, targets.productIds))
        : [],
      targets.variantIds.length
        ? transaction
            .select({ id: schema.productVariants.id })
            .from(schema.productVariants)
            .where(inArray(schema.productVariants.domainId, targets.variantIds))
        : [],
    ]);
    if (
      products.length !== new Set(targets.productIds).size ||
      variants.length !== new Set(targets.variantIds).size
    ) {
      throw new OfferError("invalid_input");
    }
    const values = [
      ...products.map((row) => ({ offerId, productId: row.id })),
      ...variants.map((row) => ({ offerId, variantId: row.id })),
      ...targets.categoryCodes.map((code) => ({ offerId, categoryCode: code })),
    ];
    if (values.length)
      await transaction.insert(schema.offerTargets).values(values);
  }

  private async audit(
    transaction: Transaction,
    actor: AdminActor,
    actionType: string,
    entityId: string,
    afterState: Record<string, string | number | boolean | null>,
  ) {
    assertSafeAuditState(afterState);
    await transaction.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType,
      entityType: "offer",
      entityId,
      beforeState: null,
      afterState,
    });
  }

  async create(actor: AdminActor, raw: OfferInput): Promise<{ id: string }> {
    assertPermission(actor, "settings.manage");
    const input = offerInputSchema.parse(raw);
    return this.database.transaction(async (transaction) => {
      await this.lock(transaction);
      await this.validate(transaction, input);
      const [row] = await transaction
        .insert(schema.offers)
        .values({
          nameAr: input.nameAr,
          displayText: input.displayText,
          kind: input.kind,
          value: input.value,
          minQuantity: input.minQuantity,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          enabled: input.enabled,
        })
        .returning({ id: schema.offers.id });
      await this.writeTargets(transaction, row!.id, input.targets);
      await this.audit(transaction, actor, "offer_create", row!.id, {
        kind: input.kind,
        value: input.value,
        enabled: input.enabled,
      });
      return { id: row!.id };
    });
  }

  async update(
    actor: AdminActor,
    offerId: string,
    raw: OfferInput,
    /** The updatedAt the editor loaded; a newer row means someone else saved in between. */
    expectedVersion?: string,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    const input = offerInputSchema.parse(raw);
    await this.database.transaction(async (transaction) => {
      await this.lock(transaction);
      const [row] = await transaction
        .select()
        .from(schema.offers)
        .where(eq(schema.offers.id, offerId))
        .for("update");
      if (!row || row.archivedAt) throw new OfferError("not_found");
      if (expectedVersion && row.updatedAt.toISOString() !== expectedVersion)
        throw new OfferError("stale");
      await this.validate(transaction, input, offerId);
      await transaction
        .update(schema.offers)
        .set({
          nameAr: input.nameAr,
          displayText: input.displayText,
          kind: input.kind,
          value: input.value,
          minQuantity: input.minQuantity,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          enabled: input.enabled,
          updatedAt: new Date(),
        })
        .where(eq(schema.offers.id, offerId));
      await this.writeTargets(transaction, offerId, input.targets);
      await this.audit(transaction, actor, "offer_update", offerId, {
        kind: input.kind,
        value: input.value,
        enabled: input.enabled,
      });
    });
  }

  async inputOf(offerId: string): Promise<OfferInput | null> {
    const [row] = await this.database
      .select()
      .from(schema.offers)
      .where(eq(schema.offers.id, offerId))
      .limit(1);
    if (!row) return null;
    return {
      nameAr: row.nameAr,
      displayText: row.displayText,
      kind: row.kind,
      value: row.value,
      minQuantity: row.minQuantity,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      enabled: row.enabled,
      targets: await this.targetsOf(this.database, offerId),
    };
  }

  async setArchived(
    actor: AdminActor,
    offerId: string,
    archived: boolean,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(schema.offers)
        .where(eq(schema.offers.id, offerId))
        .for("update");
      if (!row) throw new OfferError("not_found");
      if (Boolean(row.archivedAt) === archived) return;
      // Restored offers come back disabled so they never collide with what replaced them.
      await transaction
        .update(schema.offers)
        .set({
          archivedAt: archived ? new Date() : null,
          enabled: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.offers.id, offerId));
      await this.audit(
        transaction,
        actor,
        archived ? "offer_archive" : "offer_restore",
        offerId,
        {
          archived,
        },
      );
    });
  }

  async deleteUnused(actor: AdminActor, offerId: string): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(schema.offers)
        .where(eq(schema.offers.id, offerId))
        .for("update");
      if (!row) throw new OfferError("not_found");
      const [usage] = await transaction
        .select({ value: count() })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.offerId, offerId));
      if (Number(usage?.value ?? 0) > 0) throw new OfferError("in_use");
      await transaction
        .delete(schema.offers)
        .where(eq(schema.offers.id, offerId));
      await this.audit(transaction, actor, "offer_delete", offerId, {
        deleted: true,
      });
    });
  }
}
