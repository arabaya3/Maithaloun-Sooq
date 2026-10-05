import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  customerInvoiceStatuses,
  customerLedgerEntryTypes,
  saleSources,
} from "@/features/sales/domain/customer-balance";

import {
  adminUsers,
  productSellingUnits,
  productVariants,
} from "./schema-core";
import { stockUnitEnum } from "./schema-inventory";

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .defaultNow()
  .notNull();

export const customerInvoiceStatusEnum = pgEnum(
  "customer_invoice_status",
  customerInvoiceStatuses,
);
export const saleSourceEnum = pgEnum("sale_source", saleSources);
export const customerLedgerEntryTypeEnum = pgEnum(
  "customer_ledger_entry_type",
  customerLedgerEntryTypes,
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 100 })
      .notNull()
      .unique(),
    phoneE164: varchar("phone_e164", { length: 20 }),
    address: varchar("address", { length: 300 }),
    landmark: varchar("landmark", { length: 160 }),
    notes: varchar("notes", { length: 500 }),
    active: boolean("active").default(true).notNull(),
    mergedIntoCustomerId: uuid("merged_into_customer_id").references(
      (): AnyPgColumn => customers.id,
      { onDelete: "restrict" },
    ),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("customers_merged_into_idx").on(table.mergedIntoCustomerId),
    check(
      "customers_name_not_blank",
      sql`char_length(btrim(${table.name})) >= 2`,
    ),
    check(
      "customers_phone_format",
      sql`${table.phoneE164} IS NULL OR ${table.phoneE164} ~ '^\\+(970|972)5[0-9]{8}$'`,
    ),
  ],
);

export const customerAliases = pgTable(
  "customer_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    alias: varchar("alias", { length: 100 }).notNull(),
    normalizedAlias: varchar("normalized_alias", { length: 100 })
      .notNull()
      .unique(),
    createdAt,
  },
  (table) => [index("customer_aliases_customer_idx").on(table.customerId)],
);

export const customerInvoices = pgTable(
  "customer_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: integer("invoice_number").notNull().unique(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    customerNameSnapshot: varchar("customer_name_snapshot", { length: 100 }),
    source: saleSourceEnum("source").notNull(),
    status: customerInvoiceStatusEnum("status").default("posted").notNull(),
    subtotalAgorot: integer("subtotal_agorot").notNull(),
    discountAgorot: integer("discount_agorot").default(0).notNull(),
    totalAgorot: integer("total_agorot").notNull(),
    paidAtSaleAgorot: integer("paid_at_sale_agorot").notNull(),
    cogsAgorot: integer("cogs_agorot").notNull(),
    costComplete: boolean("cost_complete").notNull(),
    note: varchar("note", { length: 300 }),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt,
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
    cancelledBy: uuid("cancelled_by").references(() => adminUsers.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    cancelReason: varchar("cancel_reason", { length: 240 }),
  },
  (table) => [
    index("customer_invoices_customer_created_idx").on(
      table.customerId,
      table.createdAt,
    ),
    index("customer_invoices_created_at_idx").on(table.createdAt),
    index("customer_invoices_created_by_idx").on(table.createdBy),
    index("customer_invoices_cancelled_by_idx").on(table.cancelledBy),
    check(
      "customer_invoices_totals",
      sql`${table.subtotalAgorot} >= 0
        AND ${table.discountAgorot} >= 0
        AND ${table.discountAgorot} <= ${table.subtotalAgorot}
        AND ${table.totalAgorot} = ${table.subtotalAgorot} - ${table.discountAgorot}
        AND ${table.cogsAgorot} >= 0`,
    ),
    check(
      "customer_invoices_payment",
      sql`${table.paidAtSaleAgorot} >= 0
        AND ${table.paidAtSaleAgorot} <= ${table.totalAgorot}
        AND (${table.customerId} IS NOT NULL OR ${table.paidAtSaleAgorot} = ${table.totalAgorot})`,
    ),
    check(
      "customer_invoices_cancellation",
      sql`(${table.status} = 'posted' AND ${table.cancelledAt} IS NULL AND ${table.cancelledBy} IS NULL)
        OR (${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL AND ${table.cancelledBy} IS NOT NULL)`,
    ),
  ],
);

export const customerInvoiceLines = pgTable(
  "customer_invoice_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => customerInvoices.id, { onDelete: "restrict" }),
    lineNo: integer("line_no").notNull(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    productNameSnapshot: varchar("product_name_snapshot", {
      length: 280,
    }).notNull(),
    variantLabelSnapshot: varchar("variant_label_snapshot", { length: 120 }),
    skuSnapshot: varchar("sku_snapshot", { length: 64 }),
    unit: stockUnitEnum("unit").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unitPriceAgorot: integer("unit_price_agorot").notNull(),
    lineTotalAgorot: integer("line_total_agorot").notNull(),
    unitCostAgorot: integer("unit_cost_agorot"),
    cogsAgorot: integer("cogs_agorot"),
    // Set when the line was sold by a selling unit: unit_price is then per pack and
    // quantity_milli is the base stock taken (packs × units_per_sale).
    sellingUnitId: uuid("selling_unit_id").references(
      () => productSellingUnits.id,
      { onDelete: "restrict" },
    ),
    sellingUnitLabelSnapshot: varchar("selling_unit_label_snapshot", {
      length: 60,
    }),
    unitsPerSale: integer("units_per_sale").default(1).notNull(),
    packQuantity: integer("pack_quantity"),
  },
  (table) => [
    uniqueIndex("customer_invoice_lines_invoice_line_uidx").on(
      table.invoiceId,
      table.lineNo,
    ),
    index("customer_invoice_lines_variant_idx").on(table.variantId),
    index("customer_invoice_lines_selling_unit_idx").on(table.sellingUnitId),
    check(
      "customer_invoice_lines_selling_unit",
      sql`(${table.sellingUnitId} IS NULL AND ${table.packQuantity} IS NULL AND ${table.unitsPerSale} = 1)
        OR (${table.sellingUnitId} IS NOT NULL
          AND ${table.sellingUnitLabelSnapshot} IS NOT NULL
          AND ${table.unitsPerSale} BETWEEN 1 AND 1000
          AND ${table.packQuantity} >= 1
          AND ${table.quantityMilli} = ${table.packQuantity} * ${table.unitsPerSale} * 1000
          AND ${table.lineTotalAgorot} = ${table.packQuantity} * ${table.unitPriceAgorot})`,
    ),
    check(
      "customer_invoice_lines_amounts",
      sql`${table.quantityMilli} > 0
        AND ${table.unitPriceAgorot} >= 0
        AND ${table.lineTotalAgorot} >= 0
        AND (${table.cogsAgorot} IS NULL OR ${table.cogsAgorot} >= 0)`,
    ),
  ],
);

export const customerPayments = pgTable(
  "customer_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    invoiceId: uuid("invoice_id").references(() => customerInvoices.id, {
      onDelete: "restrict",
    }),
    amountAgorot: integer("amount_agorot").notNull(),
    reversesPaymentId: uuid("reverses_payment_id")
      .unique()
      .references((): AnyPgColumn => customerPayments.id, {
        onDelete: "restrict",
      }),
    note: varchar("note", { length: 240 }),
    idempotencyKey: varchar("idempotency_key", { length: 80 })
      .notNull()
      .unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt,
  },
  (table) => [
    index("customer_payments_customer_created_idx").on(
      table.customerId,
      table.createdAt,
    ),
    index("customer_payments_invoice_idx").on(table.invoiceId),
    index("customer_payments_created_at_idx").on(table.createdAt),
    index("customer_payments_created_by_idx").on(table.createdBy),
    check(
      "customer_payments_sign",
      sql`(${table.amountAgorot} > 0 AND ${table.reversesPaymentId} IS NULL)
        OR (${table.amountAgorot} < 0 AND (${table.reversesPaymentId} IS NOT NULL OR ${table.invoiceId} IS NOT NULL))`,
    ),
  ],
);

export const customerLedgerEntries = pgTable(
  "customer_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: customerLedgerEntryTypeEnum("type").notNull(),
    amountAgorot: integer("amount_agorot").notNull(),
    invoiceId: uuid("invoice_id").references(() => customerInvoices.id, {
      onDelete: "restrict",
    }),
    paymentId: uuid("payment_id").references(() => customerPayments.id, {
      onDelete: "restrict",
    }),
    note: varchar("note", { length: 240 }),
    idempotencyKey: varchar("idempotency_key", { length: 80 })
      .notNull()
      .unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt,
  },
  (table) => [
    index("customer_ledger_entries_customer_created_idx").on(
      table.customerId,
      table.createdAt,
    ),
    index("customer_ledger_entries_invoice_idx").on(table.invoiceId),
    index("customer_ledger_entries_payment_idx").on(table.paymentId),
    index("customer_ledger_entries_created_by_idx").on(table.createdBy),
    check(
      "customer_ledger_entries_sign",
      sql`(${table.type} IN ('invoice', 'payment_reversal') AND ${table.amountAgorot} > 0)
        OR (${table.type} IN ('payment', 'invoice_cancellation') AND ${table.amountAgorot} < 0)
        OR (${table.type} = 'adjustment' AND ${table.amountAgorot} <> 0)`,
    ),
  ],
);
