CREATE TYPE "public"."document_kind" AS ENUM('invoice_image', 'invoice_pdf', 'spreadsheet');--> statement-breakpoint
CREATE TYPE "public"."extraction_job_kind" AS ENUM('purchase_invoice_ai', 'purchase_excel');--> statement-breakpoint
CREATE TYPE "public"."extraction_job_status" AS ENUM('processing', 'needs_review', 'confirmed', 'discarded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."extraction_line_status" AS ENUM('matched', 'suggested', 'unmatched', 'new_product', 'ignored', 'error');--> statement-breakpoint
CREATE TYPE "public"."extraction_match_method" AS ENUM('barcode', 'sku', 'exact_name', 'supplier_alias', 'fuzzy', 'manual');--> statement-breakpoint
CREATE TYPE "public"."inventory_adjustment_reason" AS ENUM('opening_balance', 'correction', 'damaged', 'expired', 'customer_return', 'supplier_return');--> statement-breakpoint
CREATE TYPE "public"."price_review_status" AS ENUM('pending', 'kept', 'price_changed', 'later');--> statement-breakpoint
CREATE TYPE "public"."purchase_payment_status" AS ENUM('paid', 'unpaid', 'partially_paid');--> statement-breakpoint
CREATE TYPE "public"."purchase_source" AS ENUM('manual', 'excel', 'ai_capture', 'voice');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_reason" AS ENUM('purchase_receipt', 'order_reservation', 'reservation_release', 'order_fulfillment', 'manual_sale', 'customer_return', 'supplier_return', 'damaged', 'expired', 'correction', 'opening_balance');--> statement-breakpoint
CREATE TYPE "public"."stock_reservation_status" AS ENUM('active', 'released', 'fulfilled');--> statement-breakpoint
CREATE TYPE "public"."stock_unit" AS ENUM('piece', 'carton', 'pack', 'dozen', 'kg', 'gram', 'liter', 'ml');--> statement-breakpoint
CREATE TYPE "public"."supplier_ledger_entry_type" AS ENUM('purchase', 'payment', 'correction');--> statement-breakpoint
CREATE TABLE "document_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "document_kind" NOT NULL,
	"storage_provider" varchar(20) NOT NULL,
	"bucket" varchar(80) NOT NULL,
	"path" varchar(300) NOT NULL,
	"original_name" varchar(160) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_uploads_positive_size" CHECK ("document_uploads"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "extraction_job_documents" (
	"job_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	CONSTRAINT "extraction_job_documents_job_id_document_id_pk" PRIMARY KEY("job_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "extraction_job_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb NOT NULL,
	"status" "extraction_line_status" NOT NULL,
	"match_method" "extraction_match_method",
	"matched_variant_id" uuid,
	"confidence" integer,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrections" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_job_lines_confidence_range" CHECK ("extraction_job_lines"."confidence" IS NULL OR "extraction_job_lines"."confidence" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "extraction_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "extraction_job_kind" NOT NULL,
	"status" "extraction_job_status" NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"ai_model" varchar(80),
	"prompt_version" varchar(40),
	"extraction_version" varchar(40) NOT NULL,
	"header" jsonb,
	"reviewed_header" jsonb,
	"mapping" jsonb,
	"error_code" varchar(60),
	"purchase_invoice_id" uuid,
	"created_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "inventory_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"reason" "inventory_adjustment_reason" NOT NULL,
	"quantity_delta_milli" integer NOT NULL,
	"unit_cost_agorot" integer,
	"note" varchar(240),
	"idempotency_key" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_adjustments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "inventory_adjustments_non_zero" CHECK ("inventory_adjustments"."quantity_delta_milli" <> 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"unit" "stock_unit" DEFAULT 'piece' NOT NULL,
	"on_hand_milli" integer DEFAULT 0 NOT NULL,
	"reserved_milli" integer DEFAULT 0 NOT NULL,
	"stock_value_agorot" integer DEFAULT 0 NOT NULL,
	"avg_cost_agorot" integer,
	"last_purchase_cost_agorot" integer,
	"last_sale_price_agorot" integer,
	"reorder_threshold_milli" integer,
	"last_movement_at" timestamp with time zone,
	"last_movement_reason" "stock_movement_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_on_hand_non_negative" CHECK ("inventory_items"."on_hand_milli" >= 0),
	CONSTRAINT "inventory_items_reserved_within_on_hand" CHECK ("inventory_items"."reserved_milli" >= 0 AND "inventory_items"."reserved_milli" <= "inventory_items"."on_hand_milli"),
	CONSTRAINT "inventory_items_value_non_negative" CHECK ("inventory_items"."stock_value_agorot" >= 0),
	CONSTRAINT "inventory_items_threshold_non_negative" CHECK ("inventory_items"."reorder_threshold_milli" IS NULL OR "inventory_items"."reorder_threshold_milli" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name_ar" varchar(80) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "price_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"purchase_invoice_item_id" uuid NOT NULL,
	"previous_cost_agorot" integer,
	"new_cost_agorot" integer NOT NULL,
	"sale_price_agorot" integer NOT NULL,
	"status" "price_review_status" DEFAULT 'pending' NOT NULL,
	"new_sale_price_agorot" integer,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_reviews_purchase_invoice_item_id_unique" UNIQUE("purchase_invoice_item_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name_snapshot" varchar(280) NOT NULL,
	"variant_label_snapshot" varchar(120),
	"sku_snapshot" varchar(64),
	"barcode_snapshot" varchar(64),
	"source_text" varchar(280),
	"unit" "stock_unit" NOT NULL,
	"quantity_milli" integer NOT NULL,
	"pack_quantity" integer DEFAULT 1 NOT NULL,
	"stock_quantity_milli" integer NOT NULL,
	"unit_cost_agorot" integer NOT NULL,
	"line_discount_agorot" integer DEFAULT 0 NOT NULL,
	"line_total_agorot" integer NOT NULL,
	"stock_unit_cost_agorot" integer NOT NULL,
	CONSTRAINT "purchase_invoice_items_quantities" CHECK ("purchase_invoice_items"."quantity_milli" > 0 AND "purchase_invoice_items"."pack_quantity" >= 1 AND "purchase_invoice_items"."stock_quantity_milli" = "purchase_invoice_items"."quantity_milli" * "purchase_invoice_items"."pack_quantity"),
	CONSTRAINT "purchase_invoice_items_amounts" CHECK ("purchase_invoice_items"."unit_cost_agorot" >= 0 AND "purchase_invoice_items"."line_discount_agorot" >= 0 AND "purchase_invoice_items"."line_total_agorot" >= 0 AND "purchase_invoice_items"."stock_unit_cost_agorot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"reference" varchar(60),
	"normalized_reference" varchar(60),
	"invoice_date" date NOT NULL,
	"source" "purchase_source" NOT NULL,
	"subtotal_agorot" integer NOT NULL,
	"discount_agorot" integer DEFAULT 0 NOT NULL,
	"tax_agorot" integer,
	"total_agorot" integer NOT NULL,
	"printed_total_agorot" integer,
	"payment_status" "purchase_payment_status" NOT NULL,
	"paid_agorot" integer DEFAULT 0 NOT NULL,
	"notes" varchar(500),
	"document_id" uuid,
	"extraction_job_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_invoices_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "purchase_invoices_totals" CHECK ("purchase_invoices"."subtotal_agorot" >= 0
        AND "purchase_invoices"."discount_agorot" >= 0
        AND "purchase_invoices"."discount_agorot" <= "purchase_invoices"."subtotal_agorot"
        AND ("purchase_invoices"."tax_agorot" IS NULL OR "purchase_invoices"."tax_agorot" >= 0)
        AND "purchase_invoices"."total_agorot" = "purchase_invoices"."subtotal_agorot" - "purchase_invoices"."discount_agorot" + COALESCE("purchase_invoices"."tax_agorot", 0)),
	CONSTRAINT "purchase_invoices_payment" CHECK ("purchase_invoices"."paid_agorot" >= 0 AND "purchase_invoices"."paid_agorot" <= "purchase_invoices"."total_agorot" AND (
        ("purchase_invoices"."payment_status" = 'paid' AND "purchase_invoices"."paid_agorot" = "purchase_invoices"."total_agorot")
        OR ("purchase_invoices"."payment_status" = 'unpaid' AND "purchase_invoices"."paid_agorot" = 0)
        OR ("purchase_invoices"."payment_status" = 'partially_paid' AND "purchase_invoices"."paid_agorot" > 0 AND "purchase_invoices"."paid_agorot" < "purchase_invoices"."total_agorot")
      ))
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"reason" "stock_movement_reason" NOT NULL,
	"qty_delta_milli" integer NOT NULL,
	"reserved_delta_milli" integer DEFAULT 0 NOT NULL,
	"value_delta_agorot" integer DEFAULT 0 NOT NULL,
	"unit_cost_agorot" integer,
	"on_hand_after_milli" integer NOT NULL,
	"reserved_after_milli" integer NOT NULL,
	"value_after_agorot" integer NOT NULL,
	"avg_cost_after_agorot" integer,
	"purchase_invoice_item_id" uuid,
	"order_id" uuid,
	"order_item_id" uuid,
	"customer_invoice_line_id" uuid,
	"adjustment_id" uuid,
	"idempotency_key" varchar(120) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity_milli" integer NOT NULL,
	"status" "stock_reservation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "stock_reservations_order_item_id_unique" UNIQUE("order_item_id"),
	CONSTRAINT "stock_reservations_positive" CHECK ("stock_reservations"."quantity_milli" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"type" "supplier_ledger_entry_type" NOT NULL,
	"amount_agorot" integer NOT NULL,
	"purchase_invoice_id" uuid,
	"note" varchar(240),
	"idempotency_key" varchar(80) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "supplier_ledger_entries_sign" CHECK (("supplier_ledger_entries"."type" = 'purchase' AND "supplier_ledger_entries"."amount_agorot" > 0)
        OR ("supplier_ledger_entries"."type" = 'payment' AND "supplier_ledger_entries"."amount_agorot" < 0)
        OR ("supplier_ledger_entries"."type" = 'correction' AND "supplier_ledger_entries"."amount_agorot" <> 0))
);
--> statement-breakpoint
CREATE TABLE "supplier_product_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"alias_text" varchar(280) NOT NULL,
	"normalized_alias" varchar(280) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" varchar(120) NOT NULL,
	"normalized_name" varchar(120) NOT NULL,
	"phone" varchar(20),
	"notes" varchar(500),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_normalized_name_unique" UNIQUE("normalized_name"),
	CONSTRAINT "suppliers_name_not_blank" CHECK (char_length(btrim("suppliers"."name_ar")) >= 2)
);
--> statement-breakpoint
ALTER TABLE "document_uploads" ADD CONSTRAINT "document_uploads_uploaded_by_admin_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "extraction_job_documents" ADD CONSTRAINT "extraction_job_documents_job_id_extraction_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."extraction_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_job_documents" ADD CONSTRAINT "extraction_job_documents_document_id_document_uploads_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document_uploads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_job_lines" ADD CONSTRAINT "extraction_job_lines_job_id_extraction_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."extraction_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_job_lines" ADD CONSTRAINT "extraction_job_lines_matched_variant_id_product_variants_id_fk" FOREIGN KEY ("matched_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_confirmed_by_admin_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "price_reviews" ADD CONSTRAINT "price_reviews_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "price_reviews" ADD CONSTRAINT "price_reviews_purchase_invoice_item_id_purchase_invoice_items_id_fk" FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "public"."purchase_invoice_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_reviews" ADD CONSTRAINT "price_reviews_resolved_by_admin_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_document_id_document_uploads_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document_uploads"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_extraction_job_id_extraction_jobs_id_fk" FOREIGN KEY ("extraction_job_id") REFERENCES "public"."extraction_jobs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_invoice_item_id_purchase_invoice_items_id_fk" FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "public"."purchase_invoice_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "supplier_product_aliases" ADD CONSTRAINT "supplier_product_aliases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_aliases" ADD CONSTRAINT "supplier_product_aliases_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_uploads_bucket_path_uidx" ON "document_uploads" USING btree ("bucket","path");--> statement-breakpoint
CREATE INDEX "document_uploads_sha256_idx" ON "document_uploads" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "document_uploads_uploaded_by_idx" ON "document_uploads" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "extraction_job_documents_document_idx" ON "extraction_job_documents" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_job_lines_job_line_uidx" ON "extraction_job_lines" USING btree ("job_id","line_no");--> statement-breakpoint
CREATE INDEX "extraction_job_lines_variant_idx" ON "extraction_job_lines" USING btree ("matched_variant_id");--> statement-breakpoint
CREATE INDEX "extraction_jobs_status_created_idx" ON "extraction_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "extraction_jobs_created_by_idx" ON "extraction_jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "extraction_jobs_confirmed_by_idx" ON "extraction_jobs" USING btree ("confirmed_by");--> statement-breakpoint
CREATE INDEX "extraction_jobs_purchase_invoice_idx" ON "extraction_jobs" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_item_created_idx" ON "inventory_adjustments" USING btree ("inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_created_by_idx" ON "inventory_adjustments" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_variant_location_uidx" ON "inventory_items" USING btree ("variant_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_items_location_id_idx" ON "inventory_items" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_one_default_uidx" ON "inventory_locations" USING btree ("is_default") WHERE "inventory_locations"."is_default" = true;--> statement-breakpoint
CREATE INDEX "price_reviews_status_created_idx" ON "price_reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "price_reviews_variant_idx" ON "price_reviews" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "price_reviews_resolved_by_idx" ON "price_reviews" USING btree ("resolved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_items_invoice_line_uidx" ON "purchase_invoice_items" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE INDEX "purchase_invoice_items_variant_idx" ON "purchase_invoice_items" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_supplier_reference_uidx" ON "purchase_invoices" USING btree ("supplier_id","normalized_reference") WHERE "purchase_invoices"."normalized_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "purchase_invoices_created_at_idx" ON "purchase_invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "purchase_invoices_invoice_date_idx" ON "purchase_invoices" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "purchase_invoices_document_idx" ON "purchase_invoices" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_extraction_job_idx" ON "purchase_invoices" USING btree ("extraction_job_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_created_by_idx" ON "purchase_invoices" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "stock_movements_item_created_idx" ON "stock_movements" USING btree ("inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_reason_created_idx" ON "stock_movements" USING btree ("reason","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_purchase_item_idx" ON "stock_movements" USING btree ("purchase_invoice_item_id");--> statement-breakpoint
CREATE INDEX "stock_movements_order_idx" ON "stock_movements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "stock_movements_order_item_idx" ON "stock_movements" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "stock_movements_invoice_line_idx" ON "stock_movements" USING btree ("customer_invoice_line_id");--> statement-breakpoint
CREATE INDEX "stock_movements_adjustment_idx" ON "stock_movements" USING btree ("adjustment_id");--> statement-breakpoint
CREATE INDEX "stock_movements_created_by_idx" ON "stock_movements" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "stock_reservations_order_idx" ON "stock_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_item_status_idx" ON "stock_reservations" USING btree ("inventory_item_id","status");--> statement-breakpoint
CREATE INDEX "supplier_ledger_entries_supplier_created_idx" ON "supplier_ledger_entries" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_ledger_entries_invoice_idx" ON "supplier_ledger_entries" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "supplier_ledger_entries_created_by_idx" ON "supplier_ledger_entries" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_product_aliases_supplier_alias_uidx" ON "supplier_product_aliases" USING btree ("supplier_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "supplier_product_aliases_variant_idx" ON "supplier_product_aliases" USING btree ("variant_id");--> statement-breakpoint
CREATE FUNCTION "public"."apply_stock_movement"() RETURNS trigger AS $$
DECLARE
  item "public"."inventory_items"%ROWTYPE;
BEGIN
  SELECT * INTO item
  FROM "public"."inventory_items"
  WHERE "id" = NEW."inventory_item_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory item does not exist';
  END IF;

  NEW."on_hand_after_milli" := item."on_hand_milli" + NEW."qty_delta_milli";
  NEW."reserved_after_milli" := item."reserved_milli" + NEW."reserved_delta_milli";
  NEW."value_after_agorot" := item."stock_value_agorot" + NEW."value_delta_agorot";

  IF NEW."on_hand_after_milli" < 0
     OR NEW."reserved_after_milli" < 0
     OR NEW."reserved_after_milli" > NEW."on_hand_after_milli"
     OR NEW."value_after_agorot" < 0
  THEN
    RAISE EXCEPTION 'insufficient stock' USING ERRCODE = '23514';
  END IF;

  NEW."avg_cost_after_agorot" := CASE
    WHEN NEW."on_hand_after_milli" > 0 THEN
      round((NEW."value_after_agorot"::numeric * 1000) / NEW."on_hand_after_milli")::integer
    ELSE item."avg_cost_agorot"
  END;

  UPDATE "public"."inventory_items"
  SET
    "on_hand_milli" = NEW."on_hand_after_milli",
    "reserved_milli" = NEW."reserved_after_milli",
    "stock_value_agorot" = NEW."value_after_agorot",
    "avg_cost_agorot" = NEW."avg_cost_after_agorot",
    "last_purchase_cost_agorot" = CASE
      WHEN NEW."reason" = 'purchase_receipt' THEN NEW."unit_cost_agorot"
      ELSE "last_purchase_cost_agorot"
    END,
    "last_movement_at" = NEW."created_at",
    "last_movement_reason" = NEW."reason",
    "updated_at" = NEW."created_at"
  WHERE "id" = item."id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';
--> statement-breakpoint
CREATE TRIGGER "stock_movements_apply"
  BEFORE INSERT ON "public"."stock_movements"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."apply_stock_movement"();
--> statement-breakpoint
CREATE FUNCTION "public"."guard_inventory_item_balances"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."on_hand_milli" <> 0 OR NEW."reserved_milli" <> 0 OR NEW."stock_value_agorot" <> 0 THEN
      RAISE EXCEPTION 'inventory items start empty; post a stock movement instead';
    END IF;
    RETURN NEW;
  END IF;

  -- Depth 1 is a direct UPDATE; the movement trigger updates at depth 2.
  IF pg_trigger_depth() < 2 AND (
    NEW."on_hand_milli" IS DISTINCT FROM OLD."on_hand_milli"
    OR NEW."reserved_milli" IS DISTINCT FROM OLD."reserved_milli"
    OR NEW."stock_value_agorot" IS DISTINCT FROM OLD."stock_value_agorot"
    OR NEW."avg_cost_agorot" IS DISTINCT FROM OLD."avg_cost_agorot"
    OR NEW."variant_id" IS DISTINCT FROM OLD."variant_id"
    OR NEW."location_id" IS DISTINCT FROM OLD."location_id"
  ) THEN
    RAISE EXCEPTION 'stock balances change only through stock movements';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';
--> statement-breakpoint
CREATE TRIGGER "inventory_items_balance_guard"
  BEFORE INSERT OR UPDATE ON "public"."inventory_items"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."guard_inventory_item_balances"();
--> statement-breakpoint
CREATE TRIGGER "stock_movements_append_only"
  BEFORE UPDATE OR DELETE ON "public"."stock_movements"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "inventory_adjustments_append_only"
  BEFORE UPDATE OR DELETE ON "public"."inventory_adjustments"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "purchase_invoices_append_only"
  BEFORE UPDATE OR DELETE ON "public"."purchase_invoices"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "purchase_invoice_items_append_only"
  BEFORE UPDATE OR DELETE ON "public"."purchase_invoice_items"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "supplier_ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "public"."supplier_ledger_entries"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "document_uploads_append_only"
  BEFORE UPDATE OR DELETE ON "public"."document_uploads"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."supplier_product_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."supplier_ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."inventory_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."stock_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."inventory_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."purchase_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."purchase_invoice_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."document_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."extraction_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."extraction_job_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."extraction_job_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."price_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
INSERT INTO "public"."inventory_locations" ("code", "name_ar", "is_default")
VALUES ('main', 'المحل', true)
ON CONFLICT ("code") DO NOTHING;
