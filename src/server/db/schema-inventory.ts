import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  type AnyPgColumn,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  adjustmentReasons,
  stockMovementReasons,
  stockUnits,
} from "@/features/inventory/domain/stock-constants";
import {
  documentKinds,
  extractionJobKinds,
  extractionJobStatuses,
  extractionLineStatuses,
  extractionMatchMethods,
  paymentStatuses,
  priceReviewStatuses,
  purchaseSources,
  supplierLedgerEntryTypes,
} from "@/features/purchasing/domain/purchase-constants";

import { adminUsers, orderItems, orders, productVariants } from "./schema-core";

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .defaultNow()
  .notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true, mode: "date" })
  .defaultNow()
  .notNull();

export const stockUnitEnum = pgEnum("stock_unit", stockUnits);
export const stockMovementReasonEnum = pgEnum(
  "stock_movement_reason",
  stockMovementReasons,
);
export const stockReservationStatusEnum = pgEnum("stock_reservation_status", [
  "active",
  "released",
  "fulfilled",
]);
export const inventoryAdjustmentReasonEnum = pgEnum(
  "inventory_adjustment_reason",
  adjustmentReasons,
);
export const purchasePaymentStatusEnum = pgEnum(
  "purchase_payment_status",
  paymentStatuses,
);
export const purchaseSourceEnum = pgEnum("purchase_source", purchaseSources);
export const supplierLedgerEntryTypeEnum = pgEnum(
  "supplier_ledger_entry_type",
  supplierLedgerEntryTypes,
);
export const documentKindEnum = pgEnum("document_kind", documentKinds);
export const extractionJobKindEnum = pgEnum(
  "extraction_job_kind",
  extractionJobKinds,
);
export const extractionJobStatusEnum = pgEnum(
  "extraction_job_status",
  extractionJobStatuses,
);
export const extractionLineStatusEnum = pgEnum(
  "extraction_line_status",
  extractionLineStatuses,
);
export const extractionMatchMethodEnum = pgEnum(
  "extraction_match_method",
  extractionMatchMethods,
);
export const priceReviewStatusEnum = pgEnum(
  "price_review_status",
  priceReviewStatuses,
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nameAr: varchar("name_ar", { length: 120 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 120 })
      .notNull()
      .unique(),
    phone: varchar("phone", { length: 20 }),
    notes: varchar("notes", { length: 500 }),
    active: boolean("active").default(true).notNull(),
    mergedIntoSupplierId: uuid("merged_into_supplier_id").references(
      (): AnyPgColumn => suppliers.id,
      { onDelete: "restrict" },
    ),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("suppliers_merged_into_idx").on(table.mergedIntoSupplierId),
    check(
      "suppliers_name_not_blank",
      sql`char_length(btrim(${table.nameAr})) >= 2`,
    ),
  ],
);

export const inventoryLocations = pgTable(
  "inventory_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    nameAr: varchar("name_ar", { length: 80 }).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("inventory_locations_one_default_uidx")
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
  ],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => inventoryLocations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    unit: stockUnitEnum("unit").default("piece").notNull(),
    onHandMilli: integer("on_hand_milli").default(0).notNull(),
    reservedMilli: integer("reserved_milli").default(0).notNull(),
    stockValueAgorot: integer("stock_value_agorot").default(0).notNull(),
    avgCostAgorot: integer("avg_cost_agorot"),
    lastPurchaseCostAgorot: integer("last_purchase_cost_agorot"),
    lastSalePriceAgorot: integer("last_sale_price_agorot"),
    reorderThresholdMilli: integer("reorder_threshold_milli"),
    lastMovementAt: timestamp("last_movement_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastMovementReason: stockMovementReasonEnum("last_movement_reason"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("inventory_items_variant_location_uidx").on(
      table.variantId,
      table.locationId,
    ),
    index("inventory_items_location_id_idx").on(table.locationId),
    check(
      "inventory_items_on_hand_non_negative",
      sql`${table.onHandMilli} >= 0`,
    ),
    check(
      "inventory_items_reserved_within_on_hand",
      sql`${table.reservedMilli} >= 0 AND ${table.reservedMilli} <= ${table.onHandMilli}`,
    ),
    check(
      "inventory_items_value_non_negative",
      sql`${table.stockValueAgorot} >= 0`,
    ),
    check(
      "inventory_items_threshold_non_negative",
      sql`${table.reorderThresholdMilli} IS NULL OR ${table.reorderThresholdMilli} >= 0`,
    ),
  ],
);

export const documentUploads = pgTable(
  "document_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: documentKindEnum("kind").notNull(),
    storageProvider: varchar("storage_provider", { length: 20 }).notNull(),
    bucket: varchar("bucket", { length: 80 }).notNull(),
    path: varchar("path", { length: 300 }).notNull(),
    originalName: varchar("original_name", { length: 160 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt,
  },
  (table) => [
    uniqueIndex("document_uploads_bucket_path_uidx").on(
      table.bucket,
      table.path,
    ),
    index("document_uploads_sha256_idx").on(table.sha256),
    index("document_uploads_uploaded_by_idx").on(table.uploadedBy),
    check("document_uploads_positive_size", sql`${table.byteSize} > 0`),
  ],
);

export const extractionJobs = pgTable(
  "extraction_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: extractionJobKindEnum("kind").notNull(),
    status: extractionJobStatusEnum("status").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    aiModel: varchar("ai_model", { length: 80 }),
    promptVersion: varchar("prompt_version", { length: 40 }),
    extractionVersion: varchar("extraction_version", { length: 40 }).notNull(),
    header: jsonb("header").$type<Record<string, unknown>>(),
    reviewedHeader: jsonb("reviewed_header").$type<Record<string, unknown>>(),
    mapping: jsonb("mapping").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 60 }),
    purchaseInvoiceId: uuid("purchase_invoice_id").references(
      (): AnyPgColumn => purchaseInvoices.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    confirmedBy: uuid("confirmed_by").references(() => adminUsers.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("extraction_jobs_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("extraction_jobs_created_by_idx").on(table.createdBy),
    index("extraction_jobs_confirmed_by_idx").on(table.confirmedBy),
    index("extraction_jobs_purchase_invoice_idx").on(table.purchaseInvoiceId),
  ],
);

export const extractionJobDocuments = pgTable(
  "extraction_job_documents",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => extractionJobs.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentUploads.id, { onDelete: "restrict" }),
    pageNo: integer("page_no").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.documentId] }),
    index("extraction_job_documents_document_idx").on(table.documentId),
  ],
);

export const extractionJobLines = pgTable(
  "extraction_job_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => extractionJobs.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    normalized: jsonb("normalized").$type<Record<string, unknown>>().notNull(),
    status: extractionLineStatusEnum("status").notNull(),
    matchMethod: extractionMatchMethodEnum("match_method"),
    matchedVariantId: uuid("matched_variant_id").references(
      () => productVariants.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    confidence: integer("confidence"),
    candidates: jsonb("candidates").$type<unknown[]>().default([]).notNull(),
    errors: jsonb("errors").$type<string[]>().default([]).notNull(),
    corrections: jsonb("corrections").$type<Record<string, unknown>>(),
    updatedAt,
  },
  (table) => [
    uniqueIndex("extraction_job_lines_job_line_uidx").on(
      table.jobId,
      table.lineNo,
    ),
    index("extraction_job_lines_variant_idx").on(table.matchedVariantId),
    check(
      "extraction_job_lines_confidence_range",
      sql`${table.confidence} IS NULL OR ${table.confidence} BETWEEN 0 AND 100`,
    ),
  ],
);

export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    reference: varchar("reference", { length: 60 }),
    normalizedReference: varchar("normalized_reference", { length: 60 }),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    source: purchaseSourceEnum("source").notNull(),
    subtotalAgorot: integer("subtotal_agorot").notNull(),
    discountAgorot: integer("discount_agorot").default(0).notNull(),
    taxAgorot: integer("tax_agorot"),
    totalAgorot: integer("total_agorot").notNull(),
    printedTotalAgorot: integer("printed_total_agorot"),
    paymentStatus: purchasePaymentStatusEnum("payment_status").notNull(),
    paidAgorot: integer("paid_agorot").default(0).notNull(),
    notes: varchar("notes", { length: 500 }),
    documentId: uuid("document_id").references(() => documentUploads.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    extractionJobId: uuid("extraction_job_id").references(
      () => extractionJobs.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt,
  },
  (table) => [
    uniqueIndex("purchase_invoices_supplier_reference_uidx")
      .on(table.supplierId, table.normalizedReference)
      .where(sql`${table.normalizedReference} IS NOT NULL`),
    index("purchase_invoices_created_at_idx").on(table.createdAt),
    index("purchase_invoices_invoice_date_idx").on(table.invoiceDate),
    index("purchase_invoices_document_idx").on(table.documentId),
    index("purchase_invoices_extraction_job_idx").on(table.extractionJobId),
    index("purchase_invoices_created_by_idx").on(table.createdBy),
    check(
      "purchase_invoices_totals",
      sql`${table.subtotalAgorot} >= 0
        AND ${table.discountAgorot} >= 0
        AND ${table.discountAgorot} <= ${table.subtotalAgorot}
        AND (${table.taxAgorot} IS NULL OR ${table.taxAgorot} >= 0)
        AND ${table.totalAgorot} = ${table.subtotalAgorot} - ${table.discountAgorot} + COALESCE(${table.taxAgorot}, 0)`,
    ),
    check(
      "purchase_invoices_payment",
      sql`${table.paidAgorot} >= 0 AND ${table.paidAgorot} <= ${table.totalAgorot} AND (
        (${table.paymentStatus} = 'paid' AND ${table.paidAgorot} = ${table.totalAgorot})
        OR (${table.paymentStatus} = 'unpaid' AND ${table.paidAgorot} = 0)
        OR (${table.paymentStatus} = 'partially_paid' AND ${table.paidAgorot} > 0 AND ${table.paidAgorot} < ${table.totalAgorot})
      )`,
    ),
  ],
);

export const purchaseInvoiceItems = pgTable(
  "purchase_invoice_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "restrict" }),
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
    barcodeSnapshot: varchar("barcode_snapshot", { length: 64 }),
    sourceText: varchar("source_text", { length: 280 }),
    unit: stockUnitEnum("unit").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    packQuantity: integer("pack_quantity").default(1).notNull(),
    stockQuantityMilli: integer("stock_quantity_milli").notNull(),
    unitCostAgorot: integer("unit_cost_agorot").notNull(),
    lineDiscountAgorot: integer("line_discount_agorot").default(0).notNull(),
    lineTotalAgorot: integer("line_total_agorot").notNull(),
    stockUnitCostAgorot: integer("stock_unit_cost_agorot").notNull(),
  },
  (table) => [
    uniqueIndex("purchase_invoice_items_invoice_line_uidx").on(
      table.invoiceId,
      table.lineNo,
    ),
    index("purchase_invoice_items_variant_idx").on(table.variantId),
    check(
      "purchase_invoice_items_quantities",
      sql`${table.quantityMilli} > 0 AND ${table.packQuantity} >= 1 AND ${table.stockQuantityMilli} = ${table.quantityMilli} * ${table.packQuantity}`,
    ),
    check(
      "purchase_invoice_items_amounts",
      sql`${table.unitCostAgorot} >= 0 AND ${table.lineDiscountAgorot} >= 0 AND ${table.lineTotalAgorot} >= 0 AND ${table.stockUnitCostAgorot} >= 0`,
    ),
  ],
);

export const supplierProductAliases = pgTable(
  "supplier_product_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    aliasText: varchar("alias_text", { length: 280 }).notNull(),
    normalizedAlias: varchar("normalized_alias", { length: 280 }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("supplier_product_aliases_supplier_alias_uidx").on(
      table.supplierId,
      table.normalizedAlias,
    ),
    index("supplier_product_aliases_variant_idx").on(table.variantId),
  ],
);

export const supplierLedgerEntries = pgTable(
  "supplier_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: supplierLedgerEntryTypeEnum("type").notNull(),
    amountAgorot: integer("amount_agorot").notNull(),
    purchaseInvoiceId: uuid("purchase_invoice_id").references(
      () => purchaseInvoices.id,
      { onDelete: "restrict" },
    ),
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
    index("supplier_ledger_entries_supplier_created_idx").on(
      table.supplierId,
      table.createdAt,
    ),
    index("supplier_ledger_entries_invoice_idx").on(table.purchaseInvoiceId),
    index("supplier_ledger_entries_created_by_idx").on(table.createdBy),
    check(
      "supplier_ledger_entries_sign",
      sql`(${table.type} = 'purchase' AND ${table.amountAgorot} > 0)
        OR (${table.type} = 'payment' AND ${table.amountAgorot} < 0)
        OR (${table.type} = 'correction' AND ${table.amountAgorot} <> 0)`,
    ),
  ],
);

export const inventoryAdjustments = pgTable(
  "inventory_adjustments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    reason: inventoryAdjustmentReasonEnum("reason").notNull(),
    quantityDeltaMilli: integer("quantity_delta_milli").notNull(),
    unitCostAgorot: integer("unit_cost_agorot"),
    note: varchar("note", { length: 240 }),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt,
  },
  (table) => [
    index("inventory_adjustments_item_created_idx").on(
      table.inventoryItemId,
      table.createdAt,
    ),
    index("inventory_adjustments_created_by_idx").on(table.createdBy),
    check(
      "inventory_adjustments_non_zero",
      sql`${table.quantityDeltaMilli} <> 0`,
    ),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    reason: stockMovementReasonEnum("reason").notNull(),
    qtyDeltaMilli: integer("qty_delta_milli").notNull(),
    reservedDeltaMilli: integer("reserved_delta_milli").default(0).notNull(),
    valueDeltaAgorot: integer("value_delta_agorot").default(0).notNull(),
    unitCostAgorot: integer("unit_cost_agorot"),
    onHandAfterMilli: integer("on_hand_after_milli").notNull(),
    reservedAfterMilli: integer("reserved_after_milli").notNull(),
    valueAfterAgorot: integer("value_after_agorot").notNull(),
    avgCostAfterAgorot: integer("avg_cost_after_agorot"),
    purchaseInvoiceItemId: uuid("purchase_invoice_item_id").references(
      () => purchaseInvoiceItems.id,
      { onDelete: "restrict" },
    ),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    orderItemId: uuid("order_item_id").references(() => orderItems.id, {
      onDelete: "restrict",
    }),
    customerInvoiceLineId: uuid("customer_invoice_line_id"),
    adjustmentId: uuid("adjustment_id").references(
      () => inventoryAdjustments.id,
      { onDelete: "restrict" },
    ),
    idempotencyKey: varchar("idempotency_key", { length: 120 })
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
    index("stock_movements_item_created_idx").on(
      table.inventoryItemId,
      table.createdAt,
    ),
    index("stock_movements_reason_created_idx").on(
      table.reason,
      table.createdAt,
    ),
    index("stock_movements_purchase_item_idx").on(table.purchaseInvoiceItemId),
    index("stock_movements_order_idx").on(table.orderId),
    index("stock_movements_order_item_idx").on(table.orderItemId),
    index("stock_movements_invoice_line_idx").on(table.customerInvoiceLineId),
    index("stock_movements_adjustment_idx").on(table.adjustmentId),
    index("stock_movements_created_by_idx").on(table.createdBy),
  ],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .unique()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantityMilli: integer("quantity_milli").notNull(),
    status: stockReservationStatusEnum("status").default("active").notNull(),
    createdAt,
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("stock_reservations_order_idx").on(table.orderId),
    index("stock_reservations_item_status_idx").on(
      table.inventoryItemId,
      table.status,
    ),
    check("stock_reservations_positive", sql`${table.quantityMilli} > 0`),
  ],
);

export const priceReviews = pgTable(
  "price_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    purchaseInvoiceItemId: uuid("purchase_invoice_item_id")
      .notNull()
      .unique()
      .references(() => purchaseInvoiceItems.id, { onDelete: "restrict" }),
    previousCostAgorot: integer("previous_cost_agorot"),
    newCostAgorot: integer("new_cost_agorot").notNull(),
    salePriceAgorot: integer("sale_price_agorot").notNull(),
    status: priceReviewStatusEnum("status").default("pending").notNull(),
    newSalePriceAgorot: integer("new_sale_price_agorot"),
    resolvedBy: uuid("resolved_by").references(() => adminUsers.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    createdAt,
  },
  (table) => [
    index("price_reviews_status_created_idx").on(table.status, table.createdAt),
    index("price_reviews_variant_idx").on(table.variantId),
    index("price_reviews_resolved_by_idx").on(table.resolvedBy),
  ],
);
