import "server-only";

import { and, asc, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertSafeAuditState } from "@/features/admin/domain/audit";
import { assertPermission } from "@/features/admin/domain/permissions";
import type { Database } from "@/features/inventory/application/stock-ledger";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { addDays, startOfStoreDay } from "@/shared/lib/store-time";
import * as schema from "@/server/db/schema";

export class CustomerMaintenanceError extends Error {
  constructor(
    readonly code:
      "not_found" | "invalid_input" | "same_customer" | "in_use" | "merged",
  ) {
    super(code);
    this.name = "CustomerMaintenanceError";
  }
}

export interface CustomerReferences {
  invoices: number;
  payments: number;
  ledgerEntries: number;
  reminders: number;
  aliases: number;
}

export const ledgerTypeLabels: Record<string, string> = {
  invoice: "فاتورة بيع",
  payment: "دفعة",
  payment_reversal: "إلغاء دفعة",
  invoice_cancellation: "إلغاء فاتورة",
  adjustment: "تسوية",
};

export interface CustomerStatement {
  from: string;
  to: string;
  openingAgorot: number;
  closingAgorot: number;
  lines: Array<{
    date: string;
    type: string;
    label: string;
    amountAgorot: number;
    balanceAgorot: number;
    note: string | null;
  }>;
  truncated: boolean;
}

const STATEMENT_LIMIT = 200;

export class CustomerMaintenanceService {
  constructor(private readonly database: Database) {}

  async references(customerId: string): Promise<CustomerReferences | null> {
    if (!z.uuid().safeParse(customerId).success) return null;
    const [customer] = await this.database
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);
    if (!customer) return null;
    const total = async (query: Promise<Array<{ value: number }>>) =>
      Number((await query)[0]?.value ?? 0);
    const [invoices, payments, ledgerEntries, reminders, aliases] =
      await Promise.all([
        total(
          this.database
            .select({ value: count() })
            .from(schema.customerInvoices)
            .where(eq(schema.customerInvoices.customerId, customerId)),
        ),
        total(
          this.database
            .select({ value: count() })
            .from(schema.customerPayments)
            .where(eq(schema.customerPayments.customerId, customerId)),
        ),
        total(
          this.database
            .select({ value: count() })
            .from(schema.customerLedgerEntries)
            .where(eq(schema.customerLedgerEntries.customerId, customerId)),
        ),
        total(
          this.database
            .select({ value: count() })
            .from(schema.customerReminders)
            .where(eq(schema.customerReminders.customerId, customerId)),
        ),
        total(
          this.database
            .select({ value: count() })
            .from(schema.customerAliases)
            .where(eq(schema.customerAliases.customerId, customerId)),
        ),
      ]);
    return { invoices, payments, ledgerEntries, reminders, aliases };
  }

  async balance(customerId: string): Promise<number> {
    const [row] = await this.database
      .select({
        value: sql<number>`coalesce(sum(${schema.customerLedgerEntries.amountAgorot}), 0)::int`,
      })
      .from(schema.customerLedgerEntries)
      .where(eq(schema.customerLedgerEntries.customerId, customerId));
    return Number(row?.value ?? 0);
  }

  async contact(
    customerId: string,
  ): Promise<{ address: string | null; landmark: string | null } | null> {
    const [row] = await this.database
      .select({
        address: schema.customers.address,
        landmark: schema.customers.landmark,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);
    return row ?? null;
  }

  async nameTaken(name: string): Promise<boolean> {
    const [row] = await this.database
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.normalizedName, normalizeArabicText(name)))
      .limit(1);
    return Boolean(row);
  }

  // Archived and merged customers included, for restore and deletion.
  async findAny(query: string): Promise<
    | { ok: true; id: string; name: string }
    | {
        ok: false;
        result:
          | { status: "rejected"; code: string; message: string }
          | {
              status: "needs_selection";
              field: string;
              question: string;
              options: Array<{ id: string; label: string }>;
            };
      }
  > {
    const text = query.trim();
    const needle = normalizeArabicText(text);
    const rows = await this.database
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        normalizedName: schema.customers.normalizedName,
      })
      .from(schema.customers)
      .limit(500);
    const exact = rows.filter(
      (row) => row.id === text || row.normalizedName === needle,
    );
    const matches = exact.length
      ? exact
      : rows.filter(
          (row) => needle.length >= 2 && row.normalizedName.includes(needle),
        );
    if (matches.length === 1)
      return { ok: true, id: matches[0]!.id, name: matches[0]!.name };
    if (!matches.length) {
      return {
        ok: false,
        result: {
          status: "rejected",
          code: "not_found",
          message: "الزبون غير موجود.",
        },
      };
    }
    return {
      ok: false,
      result: {
        status: "needs_selection",
        field: "customer",
        question: "أي زبون تقصدين؟",
        options: matches
          .slice(0, 6)
          .map((row) => ({ id: row.id, label: row.name })),
      },
    };
  }

  async version(customerId: string): Promise<string | null> {
    const [row] = await this.database
      .select({
        updatedAt: schema.customers.updatedAt,
        active: schema.customers.active,
        ledger: sql<string>`(select coalesce(sum(amount_agorot), 0)::text || ':' || count(*)::text from ${schema.customerLedgerEntries} where customer_id = "customers"."id")`,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);
    return row
      ? `${row.updatedAt.toISOString()}|${row.active}|${row.ledger}`
      : null;
  }

  private async audit(
    executor: Pick<Database, "insert">,
    actor: AdminActor,
    actionType: string,
    entityId: string,
    afterState: Record<string, string | number | boolean | null>,
  ) {
    assertSafeAuditState(afterState);
    await executor.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType,
      entityType: "customer",
      entityId,
      beforeState: null,
      afterState,
    });
  }

  async setActive(
    actor: AdminActor,
    customerId: string,
    active: boolean,
  ): Promise<void> {
    assertPermission(actor, "settings.manage");
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId))
        .for("update");
      if (!row) throw new CustomerMaintenanceError("not_found");
      if (row.mergedIntoCustomerId)
        throw new CustomerMaintenanceError("merged");
      if (row.active === active) return;
      await transaction
        .update(schema.customers)
        .set({ active, updatedAt: new Date() })
        .where(eq(schema.customers.id, customerId));
      await this.audit(
        transaction,
        actor,
        active ? "customer_restore" : "customer_archive",
        customerId,
        {
          active,
        },
      );
    });
  }

  // Ledger rows are append-only, so history stays with the duplicate and only its balance moves, as two transfer entries.
  async merge(
    actor: AdminActor,
    input: { sourceId: string; targetId: string; idempotencyKey: string },
  ): Promise<{ transferredAgorot: number; aliases: number }> {
    assertPermission(actor, "settings.manage");
    if (input.sourceId === input.targetId) {
      throw new CustomerMaintenanceError("same_customer");
    }
    return this.database.transaction(async (transaction) => {
      const locked = await transaction
        .select()
        .from(schema.customers)
        .where(inArray(schema.customers.id, [input.sourceId, input.targetId]))
        .orderBy(asc(schema.customers.id))
        .for("update");
      const source = locked.find((row) => row.id === input.sourceId);
      const target = locked.find((row) => row.id === input.targetId);
      if (!source || !target) throw new CustomerMaintenanceError("not_found");
      if (
        source.mergedIntoCustomerId ||
        target.mergedIntoCustomerId ||
        !target.active
      ) {
        throw new CustomerMaintenanceError("merged");
      }
      const [row] = await transaction
        .select({
          value: sql<number>`coalesce(sum(${schema.customerLedgerEntries.amountAgorot}), 0)::int`,
        })
        .from(schema.customerLedgerEntries)
        .where(eq(schema.customerLedgerEntries.customerId, source.id));
      const balance = Number(row?.value ?? 0);
      if (balance !== 0) {
        await transaction.insert(schema.customerLedgerEntries).values([
          {
            customerId: source.id,
            type: "adjustment",
            amountAgorot: -balance,
            note: `نقل الرصيد إلى ${target.name}`.slice(0, 240),
            idempotencyKey: `merge-out:${input.idempotencyKey}`,
            createdBy: actor.id,
          },
          {
            customerId: target.id,
            type: "adjustment",
            amountAgorot: balance,
            note: `رصيد منقول من ${source.name}`.slice(0, 240),
            idempotencyKey: `merge-in:${input.idempotencyKey}`,
            createdBy: actor.id,
          },
        ]);
      }
      const aliases = (
        await transaction
          .update(schema.customerAliases)
          .set({ customerId: target.id })
          .where(eq(schema.customerAliases.customerId, source.id))
          .returning({ id: schema.customerAliases.id })
      ).length;
      await transaction
        .insert(schema.customerAliases)
        .values({
          customerId: target.id,
          alias: source.name,
          normalizedAlias: normalizeArabicText(source.name).slice(0, 100),
        })
        .onConflictDoNothing();
      await transaction
        .delete(schema.customerReminderState)
        .where(eq(schema.customerReminderState.customerId, source.id));
      await transaction
        .update(schema.customers)
        .set({
          active: false,
          mergedIntoCustomerId: target.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.customers.id, source.id));
      await transaction
        .update(schema.customers)
        .set({ updatedAt: new Date() })
        .where(eq(schema.customers.id, target.id));
      await this.audit(transaction, actor, "customer_merge", source.id, {
        mergedInto: target.id,
        transferredAgorot: balance,
        aliases,
      });
      return { transferredAgorot: balance, aliases };
    });
  }

  async deleteUnused(actor: AdminActor, customerId: string): Promise<void> {
    assertPermission(actor, "settings.manage");
    const references = await this.references(customerId);
    if (!references) throw new CustomerMaintenanceError("not_found");
    if (
      references.invoices +
        references.payments +
        references.ledgerEntries +
        references.reminders >
      0
    ) {
      throw new CustomerMaintenanceError("in_use");
    }
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId))
        .for("update");
      if (!row) throw new CustomerMaintenanceError("not_found");
      const [mergedInto] = await transaction
        .select({ value: count() })
        .from(schema.customers)
        .where(eq(schema.customers.mergedIntoCustomerId, customerId));
      if (Number(mergedInto?.value ?? 0) > 0)
        throw new CustomerMaintenanceError("in_use");
      await transaction
        .delete(schema.customers)
        .where(eq(schema.customers.id, customerId));
      await this.audit(transaction, actor, "customer_delete", customerId, {
        deleted: true,
      });
    });
  }

  // Corrections never edit past entries; they append one signed adjustment.
  async adjustBalance(
    actor: AdminActor,
    input: {
      customerId: string;
      amountAgorot: number;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<{ balanceAgorot: number; replayed: boolean }> {
    assertPermission(actor, "ledger.correct");
    const reason = input.reason.trim();
    if (
      !Number.isSafeInteger(input.amountAgorot) ||
      input.amountAgorot === 0 ||
      Math.abs(input.amountAgorot) > 100_000_000 ||
      reason.length < 2 ||
      reason.length > 240
    ) {
      throw new CustomerMaintenanceError("invalid_input");
    }
    const key = `adjustment:${input.idempotencyKey}`;
    return this.database.transaction(async (transaction) => {
      const [customer] = await transaction
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(eq(schema.customers.id, input.customerId))
        .for("update");
      if (!customer) throw new CustomerMaintenanceError("not_found");
      const balance = async () =>
        Number(
          (
            await transaction
              .select({
                value: sql<number>`coalesce(sum(${schema.customerLedgerEntries.amountAgorot}), 0)::int`,
              })
              .from(schema.customerLedgerEntries)
              .where(
                eq(schema.customerLedgerEntries.customerId, input.customerId),
              )
          )[0]?.value ?? 0,
        );
      const [existing] = await transaction
        .select({ id: schema.customerLedgerEntries.id })
        .from(schema.customerLedgerEntries)
        .where(eq(schema.customerLedgerEntries.idempotencyKey, key))
        .limit(1);
      if (existing) return { balanceAgorot: await balance(), replayed: true };
      const before = await balance();
      await transaction.insert(schema.customerLedgerEntries).values({
        customerId: input.customerId,
        type: "adjustment",
        amountAgorot: input.amountAgorot,
        note: reason,
        idempotencyKey: key,
        createdBy: actor.id,
      });
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "customer_balance_adjustment",
        entityType: "customer",
        entityId: input.customerId,
        beforeState: { balanceAgorot: before },
        afterState: { balanceAgorot: before + input.amountAgorot },
      });
      return { balanceAgorot: before + input.amountAgorot, replayed: false };
    });
  }

  async statement(
    customerId: string,
    from: string,
    to: string,
  ): Promise<CustomerStatement> {
    const fromStart = startOfStoreDay(from);
    const toEnd = startOfStoreDay(addDays(to, 1));
    const [opening] = await this.database
      .select({
        value: sql<number>`coalesce(sum(${schema.customerLedgerEntries.amountAgorot}), 0)::int`,
      })
      .from(schema.customerLedgerEntries)
      .where(
        and(
          eq(schema.customerLedgerEntries.customerId, customerId),
          lt(schema.customerLedgerEntries.createdAt, fromStart),
        ),
      );
    const rows = await this.database
      .select()
      .from(schema.customerLedgerEntries)
      .where(
        and(
          eq(schema.customerLedgerEntries.customerId, customerId),
          gte(schema.customerLedgerEntries.createdAt, fromStart),
          lt(schema.customerLedgerEntries.createdAt, toEnd),
        ),
      )
      .orderBy(
        asc(schema.customerLedgerEntries.createdAt),
        asc(schema.customerLedgerEntries.id),
      )
      .limit(STATEMENT_LIMIT + 1);
    let running = Number(opening?.value ?? 0);
    const lines = rows.slice(0, STATEMENT_LIMIT).map((row) => {
      running += row.amountAgorot;
      return {
        date: row.createdAt.toISOString(),
        type: row.type,
        label: ledgerTypeLabels[row.type] ?? row.type,
        amountAgorot: row.amountAgorot,
        balanceAgorot: running,
        note: row.note,
      };
    });
    return {
      from,
      to,
      openingAgorot: Number(opening?.value ?? 0),
      closingAgorot: running,
      lines,
      truncated: rows.length > STATEMENT_LIMIT,
    };
  }

  async scheduleReminder(
    actor: AdminActor,
    input: {
      customerId: string;
      mode: "date" | "pause" | "resume" | "handled";
      date?: string;
      today: string;
    },
  ): Promise<void> {
    assertPermission(actor, "reminders.manage");
    const patch =
      input.mode === "date"
        ? { snoozedUntil: input.date ?? null, disputed: false }
        : input.mode === "handled"
          ? { snoozedUntil: addDays(input.today, 7) }
          : input.mode === "pause"
            ? { disputed: true, disputeNote: "إيقاف التذكير من المساعد" }
            : { disputed: false, disputeNote: null, snoozedUntil: null };
    if (input.mode === "date" && (!input.date || input.date < input.today)) {
      throw new CustomerMaintenanceError("invalid_input");
    }
    await this.database.transaction(async (transaction) => {
      const [customer] = await transaction
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(eq(schema.customers.id, input.customerId))
        .for("update");
      if (!customer) throw new CustomerMaintenanceError("not_found");
      const now = new Date();
      await transaction
        .insert(schema.customerReminderState)
        .values({
          customerId: input.customerId,
          ...patch,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.customerReminderState.customerId,
          set: { ...patch, updatedBy: actor.id, updatedAt: now },
        });
      await this.audit(
        transaction,
        actor,
        "reminder_state_update",
        input.customerId,
        {
          mode: input.mode,
          snoozedUntil:
            "snoozedUntil" in patch ? (patch.snoozedUntil ?? null) : null,
        },
      );
    });
  }
}
