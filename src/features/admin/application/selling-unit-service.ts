import "server-only";

import { createHash } from "node:crypto";

import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertSafeAuditState } from "@/features/admin/domain/audit";
import { assertPermission } from "@/features/admin/domain/permissions";
import {
  MAX_SELLING_UNITS_PER_VARIANT,
  MAX_UNITS_PER_SALE,
  SELLING_UNIT_LABEL_MAX,
  sellingUnitMessages,
} from "@/features/catalog/domain/selling-unit";
import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";

export type SellingUnitErrorCode =
  | "not_found"
  | "invalid_label"
  | "invalid_units"
  | "invalid_price"
  | "invalid_identifier"
  | "duplicate_sku"
  | "duplicate_barcode"
  | "duplicate_units"
  | "duplicate_label"
  | "in_use"
  | "last_active"
  | "default_archived"
  | "stale"
  | "too_many";

export class SellingUnitError extends Error {
  constructor(
    readonly code: SellingUnitErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "SellingUnitError";
  }
}

export const sellingUnitErrorMessages: Record<SellingUnitErrorCode, string> = {
  not_found: "طريقة البيع أو الصنف غير موجود. حدّث الصفحة.",
  invalid_label: sellingUnitMessages.label,
  invalid_units: sellingUnitMessages.unitsPerSale,
  invalid_price: sellingUnitMessages.price,
  invalid_identifier: "رمز SKU أو الباركود أطول من 64 حرفاً.",
  duplicate_sku: sellingUnitMessages.duplicateSku,
  duplicate_barcode: sellingUnitMessages.duplicateBarcode,
  duplicate_units: sellingUnitMessages.duplicateUnits,
  duplicate_label: sellingUnitMessages.duplicateLabel,
  in_use: sellingUnitMessages.inUse,
  last_active: sellingUnitMessages.lastActive,
  default_archived: sellingUnitMessages.defaultArchived,
  stale: sellingUnitMessages.stale,
  too_many: sellingUnitMessages.tooMany,
};

const optionalIdentifier = z
  .string()
  .trim()
  .max(64)
  .transform((value) => value || null)
  .nullable();

// Field-level checks report the specific Arabic message instead of a generic parse failure.
export function parseSellingUnitInput(input: {
  labelAr: unknown;
  unitsPerSale: unknown;
  priceAgorot: unknown;
  sku?: unknown;
  barcode?: unknown;
}) {
  const label = z
    .string()
    .trim()
    .min(1)
    .max(SELLING_UNIT_LABEL_MAX)
    .safeParse(input.labelAr);
  if (!label.success) throw new SellingUnitError("invalid_label");
  const units = z
    .number()
    .int()
    .min(1)
    .max(MAX_UNITS_PER_SALE)
    .safeParse(input.unitsPerSale);
  if (!units.success) throw new SellingUnitError("invalid_units");
  const price = z
    .number()
    .int()
    .min(1)
    .max(10_000_000)
    .safeParse(input.priceAgorot);
  if (!price.success) throw new SellingUnitError("invalid_price");
  const sku = optionalIdentifier.optional().safeParse(input.sku ?? null);
  const barcode = optionalIdentifier
    .optional()
    .safeParse(input.barcode ?? null);
  if (!sku.success || !barcode.success) {
    throw new SellingUnitError("invalid_identifier");
  }
  return {
    labelAr: label.data,
    unitsPerSale: units.data,
    priceAgorot: price.data,
    sku: sku.data ?? null,
    barcode: barcode.data ?? null,
  };
}
export type SellingUnitInput = ReturnType<typeof parseSellingUnitInput>;
export type SellingUnitCreateInput = Parameters<
  typeof parseSellingUnitInput
>[0] & {
  isDefault?: boolean;
};

export interface SellingUnitAdminView {
  id: string;
  labelAr: string;
  unitsPerSale: number;
  priceAgorot: number;
  isDefault: boolean;
  // The base unit whose price follows the variant price.
  mirrorsVariant: boolean;
  sku: string | null;
  barcode: string | null;
  sortOrder: number;
  archived: boolean;
  version: number;
  // Orders and invoices that point at this unit; a referenced unit can only be archived.
  references: number;
}

export interface VariantSellingUnits {
  variantId: string;
  label: string;
  isDefaultVariant: boolean;
  priceAgorot: number;
  // Free base stock (on hand − reserved) in milli-units; null when not stock-tracked.
  freeBaseMilli: number | null;
  units: SellingUnitAdminView[];
}

export interface SaleSellingUnitOption {
  id: string;
  labelAr: string;
  unitsPerSale: number;
  priceAgorot: number;
  isDefault: boolean;
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type UnitRow = typeof schema.productSellingUnits.$inferSelect;

function violatedConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: string }).code === "23505"
    ) {
      return (current as { constraint_name?: string }).constraint_name ?? "";
    }
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: string }).code === "23503"
    ) {
      return "foreign_key";
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function mapConstraint(error: unknown): never {
  const constraint = violatedConstraint(error);
  if (constraint === "foreign_key") throw new SellingUnitError("in_use");
  if (constraint?.includes("active_sku"))
    throw new SellingUnitError("duplicate_sku");
  if (constraint?.includes("active_barcode"))
    throw new SellingUnitError("duplicate_barcode");
  if (constraint?.includes("active_units"))
    throw new SellingUnitError("duplicate_units");
  if (constraint?.includes("active_label"))
    throw new SellingUnitError("duplicate_label");
  throw error;
}

export class SellingUnitService {
  constructor(private readonly database: Database) {}

  // The owner's editor: every live variant of a product with all its units, stock and references.
  async listForProduct(
    productDomainId: string,
  ): Promise<VariantSellingUnits[]> {
    const variants = await this.database
      .select({
        id: schema.productVariants.id,
        domainId: schema.productVariants.domainId,
        labelAr: schema.productVariants.labelAr,
        isDefault: schema.productVariants.isDefault,
        priceAgorot: schema.productVariants.priceAgorot,
        sortOrder: schema.productVariants.sortOrder,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(
        and(
          eq(schema.products.domainId, productDomainId),
          isNull(schema.productVariants.archivedAt),
        ),
      )
      .orderBy(asc(schema.productVariants.sortOrder));
    if (!variants.length) return [];
    const ids = variants.map((variant) => variant.id);
    const [units, stock, orderRefs, saleRefs] = await Promise.all([
      this.database
        .select()
        .from(schema.productSellingUnits)
        .where(inArray(schema.productSellingUnits.variantId, ids))
        .orderBy(
          asc(schema.productSellingUnits.sortOrder),
          asc(schema.productSellingUnits.unitsPerSale),
        ),
      this.database
        .select({
          variantId: schema.inventoryItems.variantId,
          free: sql<number>`${schema.inventoryItems.onHandMilli} - ${schema.inventoryItems.reservedMilli}`,
        })
        .from(schema.inventoryItems)
        .innerJoin(
          schema.inventoryLocations,
          and(
            eq(schema.inventoryLocations.id, schema.inventoryItems.locationId),
            eq(schema.inventoryLocations.isDefault, true),
          ),
        )
        .where(inArray(schema.inventoryItems.variantId, ids)),
      this.database
        .select({
          unitId: schema.orderItems.sellingUnitId,
          total: count(),
        })
        .from(schema.orderItems)
        .innerJoin(
          schema.productSellingUnits,
          eq(schema.productSellingUnits.id, schema.orderItems.sellingUnitId),
        )
        .where(inArray(schema.productSellingUnits.variantId, ids))
        .groupBy(schema.orderItems.sellingUnitId),
      this.database
        .select({
          unitId: schema.customerInvoiceLines.sellingUnitId,
          total: count(),
        })
        .from(schema.customerInvoiceLines)
        .innerJoin(
          schema.productSellingUnits,
          eq(
            schema.productSellingUnits.id,
            schema.customerInvoiceLines.sellingUnitId,
          ),
        )
        .where(inArray(schema.productSellingUnits.variantId, ids))
        .groupBy(schema.customerInvoiceLines.sellingUnitId),
    ]);
    const references = new Map<string, number>();
    for (const row of [...orderRefs, ...saleRefs]) {
      const key = String(row.unitId);
      references.set(key, (references.get(key) ?? 0) + row.total);
    }
    const free = new Map(stock.map((row) => [row.variantId, Number(row.free)]));
    return variants.map((variant) => ({
      variantId: variant.domainId,
      label: variant.labelAr,
      isDefaultVariant: variant.isDefault,
      priceAgorot: variant.priceAgorot,
      freeBaseMilli: free.has(variant.id) ? free.get(variant.id)! : null,
      units: units
        .filter((unit) => unit.variantId === variant.id)
        .map((unit) => this.view(unit, references.get(unit.id) ?? 0)),
    }));
  }

  private view(unit: UnitRow, references: number): SellingUnitAdminView {
    return {
      id: unit.id,
      labelAr: unit.labelAr,
      unitsPerSale: unit.unitsPerSale,
      priceAgorot: unit.priceAgorot,
      isDefault: unit.isDefault,
      mirrorsVariant: unit.mirrorsVariant,
      sku: unit.sku,
      barcode: unit.barcode,
      sortOrder: unit.sortOrder,
      archived: unit.archivedAt !== null,
      version: unit.version,
      references,
    };
  }

  /** Active units for every live variant, keyed by variant domain id; feeds the manual sale form. */
  async activeByVariant(): Promise<Map<string, SaleSellingUnitOption[]>> {
    const rows = await this.database
      .select({
        variantDomainId: schema.productVariants.domainId,
        unit: schema.productSellingUnits,
      })
      .from(schema.productSellingUnits)
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.productSellingUnits.variantId),
      )
      .where(
        and(
          isNull(schema.productSellingUnits.archivedAt),
          isNull(schema.productVariants.archivedAt),
        ),
      )
      .orderBy(
        asc(schema.productSellingUnits.sortOrder),
        asc(schema.productSellingUnits.unitsPerSale),
      );
    const result = new Map<string, SaleSellingUnitOption[]>();
    for (const { variantDomainId, unit } of rows) {
      result.set(variantDomainId, [
        ...(result.get(variantDomainId) ?? []),
        {
          id: unit.id,
          labelAr: unit.labelAr,
          unitsPerSale: unit.unitsPerSale,
          priceAgorot: unit.priceAgorot,
          isDefault: unit.isDefault,
        },
      ]);
    }
    return result;
  }

  /** Live variants that cannot be bought because they have no active selling unit. */
  async variantsWithoutUnits(): Promise<
    Array<{
      productId: string;
      productName: string;
      variantId: string;
      variantLabel: string;
      published: boolean;
    }>
  > {
    const rows = await this.database
      .select({
        productId: schema.products.domainId,
        productName: schema.products.nameAr,
        variantId: schema.productVariants.domainId,
        variantLabel: schema.productVariants.labelAr,
        publication: schema.products.publication,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(
        and(
          isNull(schema.productVariants.archivedAt),
          isNull(schema.products.archivedAt),
          eq(schema.productVariants.qaOwned, false),
          sql`not exists (
            select 1 from ${schema.productSellingUnits} s
            where s.variant_id = ${schema.productVariants.id} and s.archived_at is null
          )`,
        ),
      )
      .orderBy(asc(schema.products.nameAr))
      .limit(100);
    return rows.map(({ publication, ...row }) => ({
      ...row,
      published: publication === "published",
    }));
  }

  /** Stale-card fingerprint of one variant's units; any change to them or the variant changes it. */
  async variantVersion(variantDomainId: string): Promise<string | null> {
    const [variant] = await this.database
      .select({
        id: schema.productVariants.id,
        updatedAt: schema.productVariants.updatedAt,
        archivedAt: schema.productVariants.archivedAt,
      })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.domainId, variantDomainId))
      .limit(1);
    if (!variant || variant.archivedAt) return null;
    return this.variantVersionIn(this.database, variant.id);
  }

  private async variantVersionIn(
    executor: Database | Transaction,
    variantId: string,
  ): Promise<string> {
    const [variant] = await executor
      .select({ updatedAt: schema.productVariants.updatedAt })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, variantId));
    const units = await executor
      .select({
        id: schema.productSellingUnits.id,
        version: schema.productSellingUnits.version,
        archivedAt: schema.productSellingUnits.archivedAt,
      })
      .from(schema.productSellingUnits)
      .where(eq(schema.productSellingUnits.variantId, variantId))
      .orderBy(asc(schema.productSellingUnits.id));
    return createHash("sha256")
      .update(
        JSON.stringify([
          variant?.updatedAt.toISOString() ?? "-",
          units.map((unit) => [
            unit.id,
            unit.version,
            unit.archivedAt !== null,
          ]),
        ]),
      )
      .digest("hex");
  }

  async create(
    actor: AdminActor,
    variantDomainId: string,
    input: SellingUnitCreateInput,
  ): Promise<{ id: string }> {
    const [created] = await this.createMany(actor, variantDomainId, [input]);
    return created!;
  }

  /** Adds several ways of buying one variant in one transaction: all of them, or none. */
  async createMany(
    actor: AdminActor,
    variantDomainId: string,
    inputs: readonly SellingUnitCreateInput[],
    expectedVariantVersion?: string,
  ): Promise<Array<{ id: string }>> {
    assertPermission(actor, "settings.manage");
    if (!inputs.length) throw new SellingUnitError("invalid_units");
    const parsed = inputs.map((input) => ({
      data: parseSellingUnitInput(input),
      isDefault: input.isDefault === true,
    }));
    try {
      return await this.database.transaction(async (transaction) => {
        const variant = await this.lockVariant(transaction, variantDomainId);
        if (
          expectedVariantVersion !== undefined &&
          (await this.variantVersionIn(transaction, variant.id)) !==
            expectedVariantVersion
        ) {
          throw new SellingUnitError("stale");
        }
        const units = await this.units(transaction, variant.id);
        const active = units.filter((unit) => !unit.archivedAt);
        if (active.length + parsed.length > MAX_SELLING_UNITS_PER_VARIANT) {
          throw new SellingUnitError("too_many");
        }
        let sortOrder = Math.max(-1, ...units.map((unit) => unit.sortOrder));
        const wantsDefault = parsed.findIndex((entry) => entry.isDefault);
        const defaultIndex =
          wantsDefault >= 0 ? wantsDefault : active.length ? -1 : 0;
        if (defaultIndex >= 0) await this.clearDefault(transaction, variant.id);
        const created: Array<{ id: string }> = [];
        const siblings = [...active];
        for (const [index, { data }] of parsed.entries()) {
          this.assertDistinct(siblings, data);
          await this.assertIdentifiersFree(transaction, data);
          sortOrder += 1;
          const [row] = await transaction
            .insert(schema.productSellingUnits)
            .values({
              productId: variant.productId,
              variantId: variant.id,
              ...data,
              isDefault: index === defaultIndex,
              sortOrder,
            })
            .returning();
          siblings.push(row!);
          created.push({ id: row!.id });
          await this.audit(
            transaction,
            actor,
            "selling_unit_create",
            row!.id,
            null,
            {
              variantId: variantDomainId,
              unitsPerSale: data.unitsPerSale,
              priceAgorot: data.priceAgorot,
              isDefault: index === defaultIndex,
            },
          );
        }
        await this.touch(transaction, variant);
        return created;
      });
    } catch (error) {
      if (error instanceof SellingUnitError) throw error;
      return mapConstraint(error);
    }
  }

  /** SKU or barcode already used by a live variant or selling unit, checked without taking locks. */
  async identifierClash(
    data: { sku: string | null; barcode: string | null },
    exceptUnitId?: string,
  ): Promise<"duplicate_sku" | "duplicate_barcode" | null> {
    try {
      await this.database.transaction((transaction) =>
        this.assertIdentifiersFree(transaction, data, exceptUnitId),
      );
      return null;
    } catch (error) {
      if (
        error instanceof SellingUnitError &&
        (error.code === "duplicate_sku" || error.code === "duplicate_barcode")
      ) {
        return error.code;
      }
      throw error;
    }
  }

  async update(
    actor: AdminActor,
    unitId: string,
    expectedVersion: number,
    input: Parameters<typeof parseSellingUnitInput>[0],
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    const data = parseSellingUnitInput(input);
    await this.mutate(
      actor,
      unitId,
      expectedVersion,
      async (transaction, unit, variant, units) => {
        if (unit.archivedAt) throw new SellingUnitError("not_found");
        // The base unit is always one piece; its count is not editable.
        if (unit.mirrorsVariant && data.unitsPerSale !== 1) {
          throw new SellingUnitError("invalid_units");
        }
        this.assertDistinct(
          units.filter((row) => !row.archivedAt && row.id !== unit.id),
          data,
        );
        await this.assertIdentifiersFree(transaction, data, unit.id);
        if (unit.mirrorsVariant && data.priceAgorot !== unit.priceAgorot) {
          // The variant price is the source of the base unit price; its trigger updates the unit.
          await transaction
            .update(schema.productVariants)
            .set({ priceAgorot: data.priceAgorot, updatedAt: new Date() })
            .where(eq(schema.productVariants.id, variant.id));
          if (variant.isDefault) {
            await transaction
              .update(schema.products)
              .set({ priceAgorot: data.priceAgorot, updatedAt: new Date() })
              .where(eq(schema.products.id, variant.productId));
          }
        }
        await transaction
          .update(schema.productSellingUnits)
          .set({
            ...data,
            version: sql`${schema.productSellingUnits.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.productSellingUnits.id, unit.id));
        return {
          action: "selling_unit_update",
          before: {
            unitsPerSale: unit.unitsPerSale,
            priceAgorot: unit.priceAgorot,
          },
          after: {
            unitsPerSale: data.unitsPerSale,
            priceAgorot: data.priceAgorot,
          },
        };
      },
    );
  }

  async setDefault(
    actor: AdminActor,
    unitId: string,
    expectedVersion: number,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.mutate(
      actor,
      unitId,
      expectedVersion,
      async (transaction, unit, variant) => {
        if (unit.archivedAt) throw new SellingUnitError("default_archived");
        if (unit.isDefault) return null;
        await this.clearDefault(transaction, variant.id);
        await transaction
          .update(schema.productSellingUnits)
          .set({
            isDefault: true,
            version: sql`${schema.productSellingUnits.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.productSellingUnits.id, unit.id));
        return {
          action: "selling_unit_default",
          before: { isDefault: false },
          after: { isDefault: true },
        };
      },
    );
  }

  async setArchived(
    actor: AdminActor,
    unitId: string,
    expectedVersion: number,
    archived: boolean,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.mutate(
      actor,
      unitId,
      expectedVersion,
      async (transaction, unit, _variant, units) => {
        if ((unit.archivedAt !== null) === archived) return null;
        if (archived) {
          if (unit.isDefault) throw new SellingUnitError("default_archived");
          if (!units.some((row) => !row.archivedAt && row.id !== unit.id)) {
            throw new SellingUnitError("last_active");
          }
        } else {
          this.assertDistinct(
            units.filter((row) => !row.archivedAt),
            unit,
          );
          await this.assertIdentifiersFree(transaction, unit, unit.id);
        }
        const noActive = !units.some((row) => !row.archivedAt);
        await transaction
          .update(schema.productSellingUnits)
          .set({
            archivedAt: archived ? new Date() : null,
            // A restored unit becomes the default only when nothing else can be bought.
            ...(!archived && noActive ? { isDefault: true } : {}),
            version: sql`${schema.productSellingUnits.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.productSellingUnits.id, unit.id));
        return {
          action: archived ? "selling_unit_archive" : "selling_unit_restore",
          before: { archived: !archived },
          after: { archived },
        };
      },
    );
  }

  // Permanent removal is only for units no order or invoice ever used; others are archived.
  async delete(
    actor: AdminActor,
    unitId: string,
    expectedVersion: number,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.mutate(
      actor,
      unitId,
      expectedVersion,
      async (transaction, unit, _variant, units) => {
        if (await this.isReferenced(transaction, unit.id)) {
          throw new SellingUnitError("in_use");
        }
        if (unit.isDefault) throw new SellingUnitError("default_archived");
        if (
          !unit.archivedAt &&
          !units.some((row) => !row.archivedAt && row.id !== unit.id)
        ) {
          throw new SellingUnitError("last_active");
        }
        await transaction
          .delete(schema.productSellingUnits)
          .where(eq(schema.productSellingUnits.id, unit.id));
        return {
          action: "selling_unit_delete",
          before: { unitsPerSale: unit.unitsPerSale },
          after: { deleted: true },
        };
      },
    );
  }

  async isReferenced(
    executor: Database | Transaction,
    unitId: string,
  ): Promise<boolean> {
    const [order] = await executor
      .select({ id: schema.orderItems.id })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.sellingUnitId, unitId))
      .limit(1);
    if (order) return true;
    const [sale] = await executor
      .select({ id: schema.customerInvoiceLines.id })
      .from(schema.customerInvoiceLines)
      .where(eq(schema.customerInvoiceLines.sellingUnitId, unitId))
      .limit(1);
    return Boolean(sale);
  }

  /** Locks the unit's variant, re-checks the version the owner saw, then applies one change. */
  private async mutate(
    actor: AdminActor,
    unitId: string,
    expectedVersion: number,
    change: (
      transaction: Transaction,
      unit: UnitRow,
      variant: typeof schema.productVariants.$inferSelect,
      units: UnitRow[],
    ) => Promise<{
      action: string;
      before: Record<string, string | number | boolean | null>;
      after: Record<string, string | number | boolean | null>;
    } | null>,
  ): Promise<void> {
    if (!z.uuid().safeParse(unitId).success) {
      throw new SellingUnitError("not_found");
    }
    try {
      await this.database.transaction(async (transaction) => {
        const [target] = await transaction
          .select({ variantId: schema.productSellingUnits.variantId })
          .from(schema.productSellingUnits)
          .where(eq(schema.productSellingUnits.id, unitId))
          .limit(1);
        if (!target) throw new SellingUnitError("not_found");
        const [variant] = await transaction
          .select()
          .from(schema.productVariants)
          .where(eq(schema.productVariants.id, target.variantId))
          .for("update");
        if (!variant || variant.archivedAt) {
          throw new SellingUnitError("not_found");
        }
        const units = await this.units(transaction, variant.id);
        const unit = units.find((row) => row.id === unitId);
        if (!unit) throw new SellingUnitError("not_found");
        if (unit.version !== expectedVersion) {
          throw new SellingUnitError("stale");
        }
        const result = await change(transaction, unit, variant, units);
        if (!result) return;
        await this.touch(transaction, variant);
        await this.audit(
          transaction,
          actor,
          result.action,
          unit.id,
          result.before,
          { variantId: variant.domainId, ...result.after },
        );
      });
    } catch (error) {
      if (error instanceof SellingUnitError) throw error;
      mapConstraint(error);
    }
  }

  private async lockVariant(transaction: Transaction, variantDomainId: string) {
    const [variant] = await transaction
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.domainId, variantDomainId))
      .for("update");
    if (!variant || variant.archivedAt) throw new SellingUnitError("not_found");
    return variant;
  }

  private units(transaction: Transaction, variantId: string) {
    return transaction
      .select()
      .from(schema.productSellingUnits)
      .where(eq(schema.productSellingUnits.variantId, variantId));
  }

  private assertDistinct(
    others: readonly UnitRow[],
    data: { labelAr: string; unitsPerSale: number },
  ) {
    if (others.some((row) => row.unitsPerSale === data.unitsPerSale)) {
      throw new SellingUnitError("duplicate_units");
    }
    const label = data.labelAr.trim().toLowerCase();
    if (others.some((row) => row.labelAr.trim().toLowerCase() === label)) {
      throw new SellingUnitError("duplicate_label");
    }
  }

  // SKU and barcode stay unique across variants and selling units, under the catalog identifier lock.
  private async assertIdentifiersFree(
    transaction: Transaction,
    data: { sku: string | null; barcode: string | null },
    exceptUnitId?: string,
  ) {
    if (!data.sku && !data.barcode) return;
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('catalog-identifiers'))`,
    );
    for (const [column, value] of [
      ["sku", data.sku],
      ["barcode", data.barcode],
    ] as const) {
      if (!value) continue;
      const [variant] = await transaction
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(
          and(
            sql`lower(${schema.productVariants[column]}) = lower(${value})`,
            isNull(schema.productVariants.archivedAt),
          ),
        )
        .limit(1);
      const [unit] = await transaction
        .select({ id: schema.productSellingUnits.id })
        .from(schema.productSellingUnits)
        .where(
          and(
            sql`lower(${schema.productSellingUnits[column]}) = lower(${value})`,
            isNull(schema.productSellingUnits.archivedAt),
            exceptUnitId
              ? ne(schema.productSellingUnits.id, exceptUnitId)
              : undefined,
          ),
        )
        .limit(1);
      if (variant || unit) {
        throw new SellingUnitError(
          column === "sku" ? "duplicate_sku" : "duplicate_barcode",
        );
      }
    }
  }

  private async clearDefault(transaction: Transaction, variantId: string) {
    await transaction
      .update(schema.productSellingUnits)
      .set({
        isDefault: false,
        version: sql`${schema.productSellingUnits.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.productSellingUnits.variantId, variantId),
          eq(schema.productSellingUnits.isDefault, true),
        ),
      );
  }

  // Product and variant timestamps move so storefront caches and other stale checks notice.
  private async touch(
    transaction: Transaction,
    variant: typeof schema.productVariants.$inferSelect,
  ) {
    const now = new Date();
    await transaction
      .update(schema.productVariants)
      .set({ updatedAt: now })
      .where(eq(schema.productVariants.id, variant.id));
    await transaction
      .update(schema.products)
      .set({ updatedAt: now })
      .where(eq(schema.products.id, variant.productId));
  }

  private async audit(
    transaction: Transaction,
    actor: AdminActor,
    actionType: string,
    entityId: string,
    beforeState: Record<string, string | number | boolean | null> | null,
    afterState: Record<string, string | number | boolean | null>,
  ) {
    if (beforeState) assertSafeAuditState(beforeState);
    assertSafeAuditState(afterState);
    await transaction.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType,
      entityType: "selling_unit",
      entityId,
      beforeState,
      afterState,
    });
  }
}
