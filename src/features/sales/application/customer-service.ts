import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission } from "@/features/admin/domain/permissions";
import type { Database } from "@/features/inventory/application/stock-ledger";
import { normalizePalestinianPhone } from "@/features/orders/domain/phone";
import {
  allocateInvoices,
  summarizeCustomer,
  type CustomerLedgerEntryType,
  type CustomerSummary,
  type InvoicePaymentState,
} from "@/features/sales/domain/customer-balance";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { toStoreDate, todayInStoreZone } from "@/shared/lib/store-time";
import * as schema from "@/server/db/schema";

export class CustomerError extends Error {
  constructor(
    readonly code:
      "invalid_input" | "not_found" | "duplicate" | "invalid_phone",
  ) {
    super(code);
    this.name = "CustomerError";
  }
}

export const customerInputSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(500).optional(),
    address: z.string().trim().max(300).optional(),
    landmark: z.string().trim().max(160).optional(),
  })
  .strict();

export interface CustomerListItem {
  id: string;
  name: string;
  hasPhone: boolean;
  balanceAgorot: number;
  lastActivityAt: string | null;
}

export interface CustomerDetail {
  id: string;
  name: string;
  phoneE164: string | null;
  address: string | null;
  landmark: string | null;
  notes: string | null;
  aliases: string[];
  summary: CustomerSummary;
  lastActivityAt: string | null;
  invoices: Array<{
    id: string;
    invoiceNumber: number;
    date: string;
    totalAgorot: number;
    remainingAgorot: number;
    state: InvoicePaymentState;
  }>;
  payments: Array<{
    id: string;
    amountAgorot: number;
    note: string | null;
    createdAt: string;
    reversed: boolean;
    isReversal: boolean;
    atSale: boolean;
  }>;
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

function parsePhone(input: string | undefined): string | null {
  if (!input) return null;
  const phone = normalizePalestinianPhone(input);
  if (!phone) throw new CustomerError("invalid_phone");
  return phone;
}

export class CustomerService {
  constructor(private readonly database: Database) {}

  async list(
    actor: AdminActor,
    query: { search?: string; onlyOwing?: boolean } = {},
  ): Promise<CustomerListItem[]> {
    assertPermission(actor, "customers.view");
    const rows = await this.database
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        normalizedName: schema.customers.normalizedName,
        phoneE164: schema.customers.phoneE164,
        balanceAgorot: sql<number>`(
          select coalesce(sum(${schema.customerLedgerEntries.amountAgorot}), 0)::int
          from ${schema.customerLedgerEntries}
          where ${schema.customerLedgerEntries.customerId} = "customers"."id"
        )`,
        lastActivityAt: sql<Date | null>`(
          select max(${schema.customerLedgerEntries.createdAt})
          from ${schema.customerLedgerEntries}
          where ${schema.customerLedgerEntries.customerId} = "customers"."id"
        )`,
      })
      .from(schema.customers)
      .where(eq(schema.customers.active, true))
      .orderBy(asc(schema.customers.name));

    const needle = query.search ? normalizeArabicText(query.search) : "";
    return rows
      .filter((row) => !needle || row.normalizedName.includes(needle))
      .filter((row) => !query.onlyOwing || row.balanceAgorot > 0)
      .map((row) => ({
        id: row.id,
        name: row.name,
        hasPhone: Boolean(row.phoneE164),
        balanceAgorot: row.balanceAgorot,
        lastActivityAt: row.lastActivityAt
          ? new Date(row.lastActivityAt).toISOString()
          : null,
      }))
      .sort(
        (a, b) =>
          b.balanceAgorot - a.balanceAgorot ||
          a.name.localeCompare(b.name, "ar"),
      );
  }

  async getDetail(
    actor: AdminActor,
    customerId: string,
  ): Promise<CustomerDetail | null> {
    assertPermission(actor, "customers.view");
    if (!z.uuid().safeParse(customerId).success) return null;
    const [customer] = await this.database
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);
    if (!customer) return null;

    const [aliases, invoices, entries, payments] = await Promise.all([
      this.database
        .select({ alias: schema.customerAliases.alias })
        .from(schema.customerAliases)
        .where(eq(schema.customerAliases.customerId, customerId)),
      this.database
        .select()
        .from(schema.customerInvoices)
        .where(eq(schema.customerInvoices.customerId, customerId))
        .orderBy(desc(schema.customerInvoices.createdAt)),
      this.database
        .select({
          type: schema.customerLedgerEntries.type,
          amountAgorot: schema.customerLedgerEntries.amountAgorot,
          createdAt: schema.customerLedgerEntries.createdAt,
        })
        .from(schema.customerLedgerEntries)
        .where(eq(schema.customerLedgerEntries.customerId, customerId)),
      this.database
        .select()
        .from(schema.customerPayments)
        .where(eq(schema.customerPayments.customerId, customerId))
        .orderBy(desc(schema.customerPayments.createdAt)),
    ]);

    const today = todayInStoreZone();
    const forAllocation = invoices.map((invoice) => ({
      id: invoice.id,
      date: toStoreDate(invoice.createdAt),
      totalAgorot: invoice.totalAgorot,
      status: invoice.status,
    }));
    const summary = summarizeCustomer({
      invoices: forAllocation,
      entries: entries.map((entry) => ({
        type: entry.type as CustomerLedgerEntryType,
        amountAgorot: entry.amountAgorot,
      })),
      today,
    });
    const allocations = allocateInvoices(
      forAllocation,
      summary.balanceAgorot,
      today,
    );
    const reversedIds = new Set(
      payments
        .map((payment) => payment.reversesPaymentId)
        .filter((id): id is string => Boolean(id)),
    );
    const lastActivity = entries.reduce<Date | null>(
      (latest, entry) =>
        !latest || entry.createdAt > latest ? entry.createdAt : latest,
      null,
    );

    return {
      id: customer.id,
      name: customer.name,
      phoneE164: customer.phoneE164,
      address: customer.address,
      landmark: customer.landmark,
      notes: customer.notes,
      aliases: aliases.map((row) => row.alias),
      summary,
      lastActivityAt: lastActivity?.toISOString() ?? null,
      invoices: invoices.map((invoice, index) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        date: forAllocation[index]!.date,
        totalAgorot: invoice.totalAgorot,
        remainingAgorot: allocations[index]!.remainingAgorot,
        state: allocations[index]!.state,
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        amountAgorot: payment.amountAgorot,
        note: payment.note,
        createdAt: payment.createdAt.toISOString(),
        reversed: reversedIds.has(payment.id),
        isReversal: payment.reversesPaymentId !== null,
        atSale:
          payment.invoiceId !== null && payment.reversesPaymentId === null,
      })),
    };
  }

  async create(
    actor: AdminActor,
    input: z.input<typeof customerInputSchema>,
  ): Promise<{ id: string }> {
    assertPermission(actor, "sales.record");
    const parsed = customerInputSchema.safeParse(input);
    if (!parsed.success) throw new CustomerError("invalid_input");
    const normalizedName = normalizeArabicText(parsed.data.name);
    if (normalizedName.length < 2) throw new CustomerError("invalid_input");
    const phoneE164 = parsePhone(parsed.data.phone);
    try {
      return await this.database.transaction(async (transaction) => {
        const [customer] = await transaction
          .insert(schema.customers)
          .values({
            name: parsed.data.name,
            normalizedName,
            phoneE164,
            notes: parsed.data.notes || null,
            address: parsed.data.address || null,
            landmark: parsed.data.landmark || null,
          })
          .returning({ id: schema.customers.id });
        if (!customer) throw new CustomerError("invalid_input");
        // Audit rows carry no customer name or phone number.
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "customer_create",
          entityType: "customer",
          entityId: customer.id,
          beforeState: null,
          afterState: { hasContact: Boolean(phoneE164) },
        });
        return customer;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomerError("duplicate");
      throw error;
    }
  }

  async update(
    actor: AdminActor,
    input: z.input<typeof customerInputSchema> & { id: string; alias?: string },
  ): Promise<void> {
    assertPermission(actor, "sales.record");
    const { id, alias, ...rest } = input;
    const parsed = customerInputSchema.safeParse(rest);
    if (!parsed.success || !z.uuid().safeParse(id).success) {
      throw new CustomerError("invalid_input");
    }
    const phoneE164 = parsePhone(parsed.data.phone);
    const normalizedAlias = alias ? normalizeArabicText(alias) : "";
    try {
      await this.database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(eq(schema.customers.id, id))
          .for("update");
        if (!existing) throw new CustomerError("not_found");
        await transaction
          .update(schema.customers)
          .set({
            name: parsed.data.name,
            normalizedName: normalizeArabicText(parsed.data.name),
            phoneE164,
            notes: parsed.data.notes || null,
            ...(parsed.data.address !== undefined
              ? { address: parsed.data.address || null }
              : {}),
            ...(parsed.data.landmark !== undefined
              ? { landmark: parsed.data.landmark || null }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.customers.id, id));
        if (alias && normalizedAlias.length >= 2) {
          await transaction.insert(schema.customerAliases).values({
            customerId: id,
            alias: alias.trim().slice(0, 100),
            normalizedAlias: normalizedAlias.slice(0, 100),
          });
        }
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: actor.id,
          actionType: "customer_update",
          entityType: "customer",
          entityId: id,
          beforeState: null,
          afterState: { hasContact: Boolean(phoneE164) },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomerError("duplicate");
      throw error;
    }
  }

  // Name lookup for voice commands: exact name or alias first, then close candidates.
  async findByName(
    actor: AdminActor,
    name: string,
  ): Promise<Array<{ id: string; name: string; exact: boolean }>> {
    assertPermission(actor, "customers.view");
    const needle = normalizeArabicText(name);
    if (needle.length < 2) return [];
    const [customers, aliases] = await Promise.all([
      this.database
        .select({
          id: schema.customers.id,
          name: schema.customers.name,
          normalizedName: schema.customers.normalizedName,
        })
        .from(schema.customers)
        .where(eq(schema.customers.active, true)),
      this.database
        .select({
          customerId: schema.customerAliases.customerId,
          normalizedAlias: schema.customerAliases.normalizedAlias,
        })
        .from(schema.customerAliases),
    ]);
    const aliasOwner = new Map(
      aliases.map((row) => [row.normalizedAlias, row.customerId]),
    );
    const exact = customers.filter(
      (customer) =>
        customer.normalizedName === needle ||
        aliasOwner.get(needle) === customer.id,
    );
    if (exact.length) {
      return exact.map((customer) => ({
        id: customer.id,
        name: customer.name,
        exact: true,
      }));
    }
    return customers
      .filter(
        (customer) =>
          customer.normalizedName.includes(needle) ||
          needle.includes(customer.normalizedName),
      )
      .slice(0, 5)
      .map((customer) => ({
        id: customer.id,
        name: customer.name,
        exact: false,
      }));
  }
}
