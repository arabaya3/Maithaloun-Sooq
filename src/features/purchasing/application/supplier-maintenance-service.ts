import "server-only";

import { and, asc, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertSafeAuditState } from "@/features/admin/domain/audit";
import { assertPermission } from "@/features/admin/domain/permissions";
import type { Database } from "@/features/inventory/application/stock-ledger";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { addDays, startOfStoreDay } from "@/shared/lib/store-time";
import * as schema from "@/server/db/schema";

export class SupplierMaintenanceError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "invalid_input"
      | "same_supplier"
      | "in_use"
      | "merged"
      | "duplicate"
      | "exceeds_balance",
  ) {
    super(code);
    this.name = "SupplierMaintenanceError";
  }
}

export interface SupplierReferences {
  invoices: number;
  ledgerEntries: number;
  aliases: number;
}

export const supplierLedgerLabels: Record<string, string> = {
  purchase: "فاتورة شراء",
  payment: "دفعة للمورد",
  correction: "تصحيح",
};

const STATEMENT_LIMIT = 200;

export class SupplierMaintenanceService {
  constructor(private readonly database: Database) {}

  async references(supplierId: string): Promise<SupplierReferences | null> {
    if (!z.uuid().safeParse(supplierId).success) return null;
    const [supplier] = await this.database
      .select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, supplierId))
      .limit(1);
    if (!supplier) return null;
    const total = async (query: Promise<Array<{ value: number }>>) =>
      Number((await query)[0]?.value ?? 0);
    const [invoices, ledgerEntries, aliases] = await Promise.all([
      total(
        this.database
          .select({ value: count() })
          .from(schema.purchaseInvoices)
          .where(eq(schema.purchaseInvoices.supplierId, supplierId)),
      ),
      total(
        this.database
          .select({ value: count() })
          .from(schema.supplierLedgerEntries)
          .where(eq(schema.supplierLedgerEntries.supplierId, supplierId)),
      ),
      total(
        this.database
          .select({ value: count() })
          .from(schema.supplierProductAliases)
          .where(eq(schema.supplierProductAliases.supplierId, supplierId)),
      ),
    ]);
    return { invoices, ledgerEntries, aliases };
  }

  async balance(
    executor: Pick<Database, "select">,
    supplierId: string,
  ): Promise<number> {
    const [row] = await executor
      .select({
        value: sql<number>`coalesce(sum(${schema.supplierLedgerEntries.amountAgorot}), 0)::int`,
      })
      .from(schema.supplierLedgerEntries)
      .where(eq(schema.supplierLedgerEntries.supplierId, supplierId));
    return Number(row?.value ?? 0);
  }

  async version(supplierId: string): Promise<string | null> {
    const [row] = await this.database
      .select({
        updatedAt: schema.suppliers.updatedAt,
        active: schema.suppliers.active,
        ledger: sql<string>`(select coalesce(sum(amount_agorot), 0)::text || ':' || count(*)::text from ${schema.supplierLedgerEntries} where supplier_id = "suppliers"."id")`,
      })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, supplierId))
      .limit(1);
    return row
      ? `${row.updatedAt.toISOString()}|${row.active}|${row.ledger}`
      : null;
  }

  async purchaseHistory(supplierId: string, limit = 15) {
    return this.database
      .select({
        id: schema.purchaseInvoices.id,
        reference: schema.purchaseInvoices.reference,
        invoiceDate: schema.purchaseInvoices.invoiceDate,
        totalAgorot: schema.purchaseInvoices.totalAgorot,
      })
      .from(schema.purchaseInvoices)
      .where(eq(schema.purchaseInvoices.supplierId, supplierId))
      .orderBy(desc(schema.purchaseInvoices.invoiceDate))
      .limit(limit);
  }

  private async audit(
    executor: Pick<Database, "insert">,
    actor: AdminActor,
    actionType: string,
    entityId: string,
    afterState: Record<string, string | number | boolean | null>,
    beforeState: Record<string, string | number | boolean | null> | null = null,
  ) {
    assertSafeAuditState(afterState);
    await executor.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType,
      entityType: "supplier",
      entityId,
      beforeState,
      afterState,
    });
  }

  async setActive(
    actor: AdminActor,
    supplierId: string,
    active: boolean,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, supplierId))
        .for("update");
      if (!row) throw new SupplierMaintenanceError("not_found");
      if (row.mergedIntoSupplierId)
        throw new SupplierMaintenanceError("merged");
      if (row.active === active) return;
      await transaction
        .update(schema.suppliers)
        .set({ active, updatedAt: new Date() })
        .where(eq(schema.suppliers.id, supplierId));
      await this.audit(
        transaction,
        actor,
        active ? "supplier_restore" : "supplier_archive",
        supplierId,
        { active },
      );
    });
  }

  // Purchases and ledger rows are append-only: they stay with the duplicate and the payable moves as two corrections.
  async merge(
    actor: AdminActor,
    input: { sourceId: string; targetId: string; idempotencyKey: string },
  ): Promise<{ transferredAgorot: number; aliases: number }> {
    assertPermission(actor, "settings.manage");
    if (input.sourceId === input.targetId)
      throw new SupplierMaintenanceError("same_supplier");
    return this.database.transaction(async (transaction) => {
      const locked = await transaction
        .select()
        .from(schema.suppliers)
        .where(inArray(schema.suppliers.id, [input.sourceId, input.targetId]))
        .orderBy(asc(schema.suppliers.id))
        .for("update");
      const source = locked.find((row) => row.id === input.sourceId);
      const target = locked.find((row) => row.id === input.targetId);
      if (!source || !target) throw new SupplierMaintenanceError("not_found");
      if (
        source.mergedIntoSupplierId ||
        target.mergedIntoSupplierId ||
        !target.active
      ) {
        throw new SupplierMaintenanceError("merged");
      }
      const balance = await this.balance(transaction, source.id);
      if (balance !== 0) {
        await transaction.insert(schema.supplierLedgerEntries).values([
          {
            supplierId: source.id,
            type: "correction",
            amountAgorot: -balance,
            note: `نقل المستحق إلى ${target.nameAr}`.slice(0, 240),
            idempotencyKey: `merge-out:${input.idempotencyKey}`,
            createdBy: actor.id,
          },
          {
            supplierId: target.id,
            type: "correction",
            amountAgorot: balance,
            note: `مستحق منقول من ${source.nameAr}`.slice(0, 240),
            idempotencyKey: `merge-in:${input.idempotencyKey}`,
            createdBy: actor.id,
          },
        ]);
      }
      await transaction.execute(sql`
        delete from ${schema.supplierProductAliases} a
        where a.supplier_id = ${source.id}
          and exists (select 1 from ${schema.supplierProductAliases} t
            where t.supplier_id = ${target.id} and t.normalized_alias = a.normalized_alias)`);
      const aliases = (
        await transaction
          .update(schema.supplierProductAliases)
          .set({ supplierId: target.id })
          .where(eq(schema.supplierProductAliases.supplierId, source.id))
          .returning({ id: schema.supplierProductAliases.id })
      ).length;
      await transaction
        .update(schema.suppliers)
        .set({
          active: false,
          mergedIntoSupplierId: target.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.suppliers.id, source.id));
      await transaction
        .update(schema.suppliers)
        .set({ updatedAt: new Date() })
        .where(eq(schema.suppliers.id, target.id));
      await this.audit(transaction, actor, "supplier_merge", source.id, {
        mergedInto: target.id,
        transferredAgorot: balance,
        aliases,
      });
      return { transferredAgorot: balance, aliases };
    });
  }

  async deleteUnused(actor: AdminActor, supplierId: string): Promise<void> {
    assertPermission(actor, "settings.manage");
    const references = await this.references(supplierId);
    if (!references) throw new SupplierMaintenanceError("not_found");
    if (references.invoices + references.ledgerEntries > 0) {
      throw new SupplierMaintenanceError("in_use");
    }
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, supplierId))
        .for("update");
      if (!row) throw new SupplierMaintenanceError("not_found");
      const [mergedInto] = await transaction
        .select({ value: count() })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.mergedIntoSupplierId, supplierId));
      if (Number(mergedInto?.value ?? 0) > 0)
        throw new SupplierMaintenanceError("in_use");
      await transaction
        .delete(schema.suppliers)
        .where(eq(schema.suppliers.id, supplierId));
      await this.audit(transaction, actor, "supplier_delete", supplierId, {
        deleted: true,
      });
    });
  }

  async correction(
    actor: AdminActor,
    input: {
      supplierId: string;
      amountAgorot: number;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<{ balanceAgorot: number; replayed: boolean }> {
    assertPermission(actor, "suppliers.balances");
    const reason = input.reason.trim();
    if (
      !Number.isSafeInteger(input.amountAgorot) ||
      input.amountAgorot === 0 ||
      Math.abs(input.amountAgorot) > 100_000_000 ||
      reason.length < 2 ||
      reason.length > 240
    ) {
      throw new SupplierMaintenanceError("invalid_input");
    }
    const key = `correction:${input.idempotencyKey}`;
    return this.database.transaction(async (transaction) => {
      const [supplier] = await transaction
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, input.supplierId))
        .for("update");
      if (!supplier) throw new SupplierMaintenanceError("not_found");
      const [existing] = await transaction
        .select({ id: schema.supplierLedgerEntries.id })
        .from(schema.supplierLedgerEntries)
        .where(eq(schema.supplierLedgerEntries.idempotencyKey, key))
        .limit(1);
      if (existing) {
        return {
          balanceAgorot: await this.balance(transaction, input.supplierId),
          replayed: true,
        };
      }
      const before = await this.balance(transaction, input.supplierId);
      await transaction.insert(schema.supplierLedgerEntries).values({
        supplierId: input.supplierId,
        type: "correction",
        amountAgorot: input.amountAgorot,
        note: reason,
        idempotencyKey: key,
        createdBy: actor.id,
      });
      await this.audit(
        transaction,
        actor,
        "supplier_balance_correction",
        input.supplierId,
        { balanceAgorot: before + input.amountAgorot },
        { balanceAgorot: before },
      );
      return { balanceAgorot: before + input.amountAgorot, replayed: false };
    });
  }

  // A supplier credit note (e.g. for returned goods) lowers what we owe; it is recorded, never edited.
  async creditNote(
    actor: AdminActor,
    input: {
      supplierId: string;
      amountAgorot: number;
      reference: string;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<{ balanceAgorot: number; replayed: boolean }> {
    assertPermission(actor, "suppliers.balances");
    const reference = input.reference.trim();
    const reason = input.reason.trim();
    if (
      !Number.isSafeInteger(input.amountAgorot) ||
      input.amountAgorot <= 0 ||
      input.amountAgorot > 100_000_000 ||
      reference.length < 1 ||
      reference.length > 80 ||
      reason.length < 2 ||
      reason.length > 240 ||
      !z.uuid().safeParse(input.idempotencyKey).success
    ) {
      throw new SupplierMaintenanceError("invalid_input");
    }
    const key = `credit-note:${input.idempotencyKey}`;
    return this.database.transaction(async (transaction) => {
      const [supplier] = await transaction
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, input.supplierId))
        .for("update");
      if (!supplier) throw new SupplierMaintenanceError("not_found");
      const [existing] = await transaction
        .select({ id: schema.supplierLedgerEntries.id })
        .from(schema.supplierLedgerEntries)
        .where(eq(schema.supplierLedgerEntries.idempotencyKey, key))
        .limit(1);
      if (existing) {
        return {
          balanceAgorot: await this.balance(transaction, input.supplierId),
          replayed: true,
        };
      }
      const before = await this.balance(transaction, input.supplierId);
      // A credit larger than the payable would turn the supplier into a debtor; record that as a correction instead.
      if (input.amountAgorot > before) {
        throw new SupplierMaintenanceError("exceeds_balance");
      }
      await transaction.insert(schema.supplierLedgerEntries).values({
        supplierId: input.supplierId,
        type: "correction",
        amountAgorot: -input.amountAgorot,
        note: reason,
        documentKind: "credit_note",
        documentReference: reference,
        idempotencyKey: key,
        createdBy: actor.id,
      });
      await this.audit(
        transaction,
        actor,
        "supplier_credit_note",
        input.supplierId,
        { balanceAgorot: before - input.amountAgorot },
        { balanceAgorot: before },
      );
      return { balanceAgorot: before - input.amountAgorot, replayed: false };
    });
  }

  async statement(supplierId: string, from: string, to: string) {
    const fromStart = startOfStoreDay(from);
    const toEnd = startOfStoreDay(addDays(to, 1));
    const opening = Number(
      (
        await this.database
          .select({
            value: sql<number>`coalesce(sum(${schema.supplierLedgerEntries.amountAgorot}), 0)::int`,
          })
          .from(schema.supplierLedgerEntries)
          .where(
            and(
              eq(schema.supplierLedgerEntries.supplierId, supplierId),
              lt(schema.supplierLedgerEntries.createdAt, fromStart),
            ),
          )
      )[0]?.value ?? 0,
    );
    const rows = await this.database
      .select()
      .from(schema.supplierLedgerEntries)
      .where(
        and(
          eq(schema.supplierLedgerEntries.supplierId, supplierId),
          gte(schema.supplierLedgerEntries.createdAt, fromStart),
          lt(schema.supplierLedgerEntries.createdAt, toEnd),
        ),
      )
      .orderBy(
        asc(schema.supplierLedgerEntries.createdAt),
        asc(schema.supplierLedgerEntries.id),
      )
      .limit(STATEMENT_LIMIT + 1);
    let running = opening;
    const lines = rows.slice(0, STATEMENT_LIMIT).map((row) => {
      running += row.amountAgorot;
      return {
        date: row.createdAt.toISOString(),
        type: row.type,
        label:
          row.documentKind === "credit_note"
            ? `إشعار دائن ${row.documentReference ?? ""}`.trim()
            : (supplierLedgerLabels[row.type] ?? row.type),
        amountAgorot: row.amountAgorot,
        balanceAgorot: running,
        note: row.note,
      };
    });
    return {
      from,
      to,
      openingAgorot: opening,
      closingAgorot: running,
      lines,
      truncated: rows.length > STATEMENT_LIMIT,
    };
  }

  async addProductAlias(
    actor: AdminActor,
    input: { supplierId: string; variantDomainId: string; aliasText: string },
  ): Promise<void> {
    assertPermission(actor, "suppliers.manage");
    const aliasText = input.aliasText.trim();
    const normalizedAlias = normalizeArabicText(aliasText);
    if (normalizedAlias.length < 2 || aliasText.length > 280) {
      throw new SupplierMaintenanceError("invalid_input");
    }
    await this.database.transaction(async (transaction) => {
      const [variant] = await transaction
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.domainId, input.variantDomainId))
        .limit(1);
      const [supplier] = await transaction
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, input.supplierId))
        .for("update");
      if (!variant || !supplier)
        throw new SupplierMaintenanceError("not_found");
      const inserted = await transaction
        .insert(schema.supplierProductAliases)
        .values({
          supplierId: supplier.id,
          variantId: variant.id,
          aliasText,
          normalizedAlias,
        })
        .onConflictDoNothing()
        .returning({ id: schema.supplierProductAliases.id });
      if (!inserted.length) throw new SupplierMaintenanceError("duplicate");
      await this.audit(
        transaction,
        actor,
        "supplier_alias_create",
        supplier.id,
        { variant: input.variantDomainId },
      );
    });
  }
}
