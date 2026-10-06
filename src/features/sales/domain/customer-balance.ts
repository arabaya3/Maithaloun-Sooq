import { daysBetween } from "@/shared/lib/store-time";

export const OVERDUE_AFTER_DAYS = 14;

export const customerLedgerEntryTypes = [
  "invoice",
  "payment",
  "payment_reversal",
  "invoice_cancellation",
  "adjustment",
] as const;
export type CustomerLedgerEntryType = (typeof customerLedgerEntryTypes)[number];

export const customerInvoiceStatuses = ["posted", "cancelled"] as const;
export type CustomerInvoiceStatus = (typeof customerInvoiceStatuses)[number];

export const saleSources = ["manual", "voice", "assistant"] as const;
export type SaleSource = (typeof saleSources)[number];

export const invoicePaymentStates = [
  "paid",
  "unpaid",
  "partially_paid",
  "overdue",
  "cancelled",
] as const;
export type InvoicePaymentState = (typeof invoicePaymentStates)[number];

export const invoicePaymentStateLabels: Record<InvoicePaymentState, string> = {
  paid: "مدفوعة",
  unpaid: "غير مدفوعة",
  partially_paid: "مدفوعة جزئياً",
  overdue: "متأخرة",
  cancelled: "ملغاة",
};

export interface LedgerEntryAmount {
  amountAgorot: number;
}

// The balance is never stored: it is always the sum of the append-only ledger.
export function ledgerBalance(entries: readonly LedgerEntryAmount[]): number {
  const balance = entries.reduce((sum, entry) => sum + entry.amountAgorot, 0);
  if (!Number.isSafeInteger(balance)) throw new RangeError("AMOUNT_OVERFLOW");
  return balance;
}

export interface InvoiceForAllocation {
  id: string;
  date: string;
  totalAgorot: number;
  status: CustomerInvoiceStatus;
}

export interface InvoiceAllocation {
  id: string;
  paidAgorot: number;
  remainingAgorot: number;
  state: InvoicePaymentState;
  ageDays: number;
}

// Money received settles the oldest open invoice first, whatever order it arrived in.
export function allocateInvoices(
  invoices: readonly InvoiceForAllocation[],
  balanceAgorot: number,
  today: string,
): InvoiceAllocation[] {
  const active = invoices
    .filter((invoice) => invoice.status === "posted")
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const invoiced = active.reduce(
    (sum, invoice) => sum + invoice.totalAgorot,
    0,
  );
  let settled = Math.max(0, invoiced - Math.max(balanceAgorot, 0));

  const byId = new Map<string, InvoiceAllocation>();
  for (const invoice of active) {
    const paidAgorot = Math.min(settled, invoice.totalAgorot);
    settled -= paidAgorot;
    const remainingAgorot = invoice.totalAgorot - paidAgorot;
    const ageDays = Math.max(0, daysBetween(invoice.date, today));
    byId.set(invoice.id, {
      id: invoice.id,
      paidAgorot,
      remainingAgorot,
      ageDays,
      state:
        remainingAgorot === 0
          ? "paid"
          : ageDays > OVERDUE_AFTER_DAYS
            ? "overdue"
            : paidAgorot > 0
              ? "partially_paid"
              : "unpaid",
    });
  }

  return invoices.map(
    (invoice) =>
      byId.get(invoice.id) ?? {
        id: invoice.id,
        paidAgorot: 0,
        remainingAgorot: 0,
        ageDays: Math.max(0, daysBetween(invoice.date, today)),
        state: "cancelled" as const,
      },
  );
}

export interface CustomerSummary {
  balanceAgorot: number;
  totalPurchasesAgorot: number;
  totalPaidAgorot: number;
  oldestUnpaid: { amountAgorot: number; date: string; ageDays: number } | null;
}

export function summarizeCustomer(input: {
  invoices: readonly InvoiceForAllocation[];
  entries: ReadonlyArray<LedgerEntryAmount & { type: CustomerLedgerEntryType }>;
  today: string;
}): CustomerSummary {
  const balanceAgorot = ledgerBalance(input.entries);
  const allocations = allocateInvoices(
    input.invoices,
    balanceAgorot,
    input.today,
  );
  const oldest = input.invoices
    .map((invoice, index) => ({ invoice, allocation: allocations[index]! }))
    .filter(({ allocation }) => allocation.remainingAgorot > 0)
    .sort((a, b) => a.invoice.date.localeCompare(b.invoice.date))[0];

  return {
    balanceAgorot,
    totalPurchasesAgorot: input.invoices
      .filter((invoice) => invoice.status === "posted")
      .reduce((sum, invoice) => sum + invoice.totalAgorot, 0),
    // Payments are stored negative; subtract from 0 so an empty sum stays +0, never -0.
    totalPaidAgorot:
      0 -
      input.entries
        .filter(
          (entry) =>
            entry.type === "payment" || entry.type === "payment_reversal",
        )
        .reduce((sum, entry) => sum + entry.amountAgorot, 0),
    oldestUnpaid: oldest
      ? {
          amountAgorot: oldest.allocation.remainingAgorot,
          date: oldest.invoice.date,
          ageDays: oldest.allocation.ageDays,
        }
      : null,
  };
}

export type AgingBucket = "current" | "late" | "old";

export const agingBucketLabels: Record<AgingBucket, string> = {
  current: "حتى 30 يوماً",
  late: "31 – 60 يوماً",
  old: "أكثر من 60 يوماً",
};

/** Age of the oldest unpaid invoice, in the three bands the owner follows up by. */
export function agingBucket(ageDays: number): AgingBucket {
  if (ageDays > 60) return "old";
  if (ageDays > 30) return "late";
  return "current";
}

export const ledgerEntryLabels: Record<CustomerLedgerEntryType, string> = {
  invoice: "فاتورة بيع",
  payment: "دفعة",
  payment_reversal: "عكس دفعة",
  invoice_cancellation: "إلغاء فاتورة",
  adjustment: "تسوية",
};

export interface StatementLine {
  id: string;
  at: string;
  type: CustomerLedgerEntryType;
  invoiceId: string | null;
  amountAgorot: number;
  /** Balance right after this entry, oldest first, so the last line equals the current balance. */
  balanceAgorot: number;
}

export function buildStatement(
  entries: ReadonlyArray<{
    id: string;
    type: CustomerLedgerEntryType;
    amountAgorot: number;
    createdAt: Date;
    invoiceId: string | null;
  }>,
): StatementLine[] {
  let balance = 0;
  return [...entries]
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((entry) => {
      balance += entry.amountAgorot;
      return {
        id: entry.id,
        at: entry.createdAt.toISOString(),
        type: entry.type,
        invoiceId: entry.invoiceId,
        amountAgorot: entry.amountAgorot,
        balanceAgorot: balance,
      };
    });
}
