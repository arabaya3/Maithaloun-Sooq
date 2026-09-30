import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission, can } from "@/features/admin/domain/permissions";
import type { Database } from "@/features/inventory/application/stock-ledger";
import { toLatinDigits } from "@/shared/lib/digits";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import * as schema from "@/server/db/schema";

export class SupplierError extends Error {
  constructor(
    readonly code:
      "invalid_input" | "not_found" | "duplicate" | "payment_exceeds_balance",
  ) {
    super(code);
    this.name = "SupplierError";
  }
}

const phoneSchema = z
  .string()
  .transform((value) => toLatinDigits(value).replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\+?\d{7,15}$/));

export const supplierInputSchema = z
  .object({
    nameAr: z.string().trim().min(2).max(120),
    phone: phoneSchema.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const supplierPaymentSchema = z
  .object({
    supplierId: z.uuid(),
    amountAgorot: z.number().int().min(1).max(1_000_000_000),
    note: z.string().trim().max(240).optional(),
    idempotencyKey: z.uuid(),
  })
  .strict();

export interface SupplierListItem {
  id: string;
  nameAr: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
  balanceAgorot: number | null;
  invoiceCount: number;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: string }).code === "23505"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class SupplierService {
  constructor(private readonly database: Database) {}

  async list(actor: AdminActor): Promise<SupplierListItem[]> {
    // Correlated subqueries name the outer table explicitly; Drizzle leaves single-table columns unqualified.
    assertPermission(actor, "suppliers.manage");
    const showBalances = can(actor, "suppliers.balances");
    const rows = await this.database
      .select({
        id: schema.suppliers.id,
        nameAr: schema.suppliers.nameAr,
        phone: schema.suppliers.phone,
        notes: schema.suppliers.notes,
        active: schema.suppliers.active,
        balanceAgorot: sql<number>`(
          select coalesce(sum(${schema.supplierLedgerEntries.amountAgorot}), 0)::int
          from ${schema.supplierLedgerEntries}
          where ${schema.supplierLedgerEntries.supplierId} = "suppliers"."id"
        )`,
        invoiceCount: sql<number>`(
          select count(*)::int from ${schema.purchaseInvoices}
          where ${schema.purchaseInvoices.supplierId} = "suppliers"."id"
        )`,
      })
      .from(schema.suppliers)
      .orderBy(desc(schema.suppliers.active), asc(schema.suppliers.nameAr));
    return rows.map((row) => ({
      ...row,
      balanceAgorot: showBalances ? row.balanceAgorot : null,
    }));
  }

  async create(
    actor: AdminActor,
    input: z.input<typeof supplierInputSchema>,
  ): Promise<{ id: string }> {
    assertPermission(actor, "suppliers.manage");
    const parsed = supplierInputSchema.safeParse(input);
    if (!parsed.success) throw new SupplierError("invalid_input");
    const normalizedName = normalizeArabicText(parsed.data.nameAr);
    if (normalizedName.length < 2) throw new SupplierError("invalid_input");

    try {
      return await this.database.transaction(async (transaction) => {
        const [supplier] = await transaction
          .insert(schema.suppliers)
          .values({
            nameAr: parsed.data.nameAr,
            normalizedName,
            phone: parsed.data.phone ?? null,
            notes: parsed.data.notes || null,
          })
          .returning({ id: schema.suppliers.id });
        if (!supplier) throw new SupplierError("invalid_input");
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "supplier_create",
          entityType: "supplier",
          entityId: supplier.id,
          beforeState: null,
          afterState: { nameAr: parsed.data.nameAr },
        });
        return supplier;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new SupplierError("duplicate");
      throw error;
    }
  }

  async update(
    actor: AdminActor,
    input: z.input<typeof supplierInputSchema> & {
      id: string;
      active: boolean;
    },
  ): Promise<void> {
    assertPermission(actor, "suppliers.manage");
    const { id, active, ...rest } = input;
    const parsed = supplierInputSchema.safeParse(rest);
    if (!parsed.success || !z.uuid().safeParse(id).success) {
      throw new SupplierError("invalid_input");
    }
    const normalizedName = normalizeArabicText(parsed.data.nameAr);

    try {
      await this.database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(schema.suppliers)
          .where(eq(schema.suppliers.id, id))
          .for("update");
        if (!existing) throw new SupplierError("not_found");
        await transaction
          .update(schema.suppliers)
          .set({
            nameAr: parsed.data.nameAr,
            normalizedName,
            phone: parsed.data.phone ?? null,
            notes: parsed.data.notes || null,
            active,
            updatedAt: new Date(),
          })
          .where(eq(schema.suppliers.id, id));
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "supplier_update",
          entityType: "supplier",
          entityId: id,
          beforeState: { nameAr: existing.nameAr, active: existing.active },
          afterState: { nameAr: parsed.data.nameAr, active },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new SupplierError("duplicate");
      throw error;
    }
  }

  async recordPayment(
    actor: AdminActor,
    input: z.input<typeof supplierPaymentSchema>,
  ): Promise<{ balanceAgorot: number; replayed: boolean }> {
    assertPermission(actor, "suppliers.balances");
    const parsed = supplierPaymentSchema.safeParse(input);
    if (!parsed.success) throw new SupplierError("invalid_input");
    const data = parsed.data;
    const idempotencyKey = `supplier-payment:${data.idempotencyKey}`;

    return this.database.transaction(async (transaction) => {
      const [supplier] = await transaction
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, data.supplierId))
        .for("update");
      if (!supplier) throw new SupplierError("not_found");

      const balance = async () => {
        const [row] = await transaction
          .select({
            total: sql<number>`coalesce(sum(${schema.supplierLedgerEntries.amountAgorot}), 0)::int`,
          })
          .from(schema.supplierLedgerEntries)
          .where(eq(schema.supplierLedgerEntries.supplierId, supplier.id));
        return row?.total ?? 0;
      };

      const [existing] = await transaction
        .select({ id: schema.supplierLedgerEntries.id })
        .from(schema.supplierLedgerEntries)
        .where(eq(schema.supplierLedgerEntries.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) return { balanceAgorot: await balance(), replayed: true };

      const before = await balance();
      if (data.amountAgorot > before) {
        throw new SupplierError("payment_exceeds_balance");
      }
      await transaction.insert(schema.supplierLedgerEntries).values({
        supplierId: supplier.id,
        type: "payment",
        amountAgorot: -data.amountAgorot,
        note: data.note || null,
        idempotencyKey,
        createdBy: actor.id,
      });
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "supplier_payment",
        entityType: "supplier",
        entityId: supplier.id,
        beforeState: { balanceAgorot: before },
        afterState: { balanceAgorot: before - data.amountAgorot },
      });
      return { balanceAgorot: before - data.amountAgorot, replayed: false };
    });
  }
}
