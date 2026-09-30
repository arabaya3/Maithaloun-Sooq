CREATE TYPE "public"."customer_invoice_status" AS ENUM('posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."customer_ledger_entry_type" AS ENUM('invoice', 'payment', 'payment_reversal', 'invoice_cancellation', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."sale_source" AS ENUM('manual', 'voice');--> statement-breakpoint
CREATE TABLE "customer_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"alias" varchar(100) NOT NULL,
	"normalized_alias" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_aliases_normalized_alias_unique" UNIQUE("normalized_alias")
);
--> statement-breakpoint
CREATE TABLE "customer_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name_snapshot" varchar(280) NOT NULL,
	"variant_label_snapshot" varchar(120),
	"sku_snapshot" varchar(64),
	"unit" "stock_unit" NOT NULL,
	"quantity_milli" integer NOT NULL,
	"unit_price_agorot" integer NOT NULL,
	"line_total_agorot" integer NOT NULL,
	"unit_cost_agorot" integer,
	"cogs_agorot" integer,
	CONSTRAINT "customer_invoice_lines_amounts" CHECK ("customer_invoice_lines"."quantity_milli" > 0
        AND "customer_invoice_lines"."unit_price_agorot" >= 0
        AND "customer_invoice_lines"."line_total_agorot" >= 0
        AND ("customer_invoice_lines"."cogs_agorot" IS NULL OR "customer_invoice_lines"."cogs_agorot" >= 0))
);
--> statement-breakpoint
CREATE TABLE "customer_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" integer NOT NULL,
	"customer_id" uuid,
	"customer_name_snapshot" varchar(100),
	"source" "sale_source" NOT NULL,
	"status" "customer_invoice_status" DEFAULT 'posted' NOT NULL,
	"subtotal_agorot" integer NOT NULL,
	"discount_agorot" integer DEFAULT 0 NOT NULL,
	"total_agorot" integer NOT NULL,
	"paid_at_sale_agorot" integer NOT NULL,
	"cogs_agorot" integer NOT NULL,
	"cost_complete" boolean NOT NULL,
	"note" varchar(300),
	"idempotency_key" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" varchar(240),
	CONSTRAINT "customer_invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "customer_invoices_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "customer_invoices_totals" CHECK ("customer_invoices"."subtotal_agorot" >= 0
        AND "customer_invoices"."discount_agorot" >= 0
        AND "customer_invoices"."discount_agorot" <= "customer_invoices"."subtotal_agorot"
        AND "customer_invoices"."total_agorot" = "customer_invoices"."subtotal_agorot" - "customer_invoices"."discount_agorot"
        AND "customer_invoices"."cogs_agorot" >= 0),
	CONSTRAINT "customer_invoices_payment" CHECK ("customer_invoices"."paid_at_sale_agorot" >= 0
        AND "customer_invoices"."paid_at_sale_agorot" <= "customer_invoices"."total_agorot"
        AND ("customer_invoices"."customer_id" IS NOT NULL OR "customer_invoices"."paid_at_sale_agorot" = "customer_invoices"."total_agorot")),
	CONSTRAINT "customer_invoices_cancellation" CHECK (("customer_invoices"."status" = 'posted' AND "customer_invoices"."cancelled_at" IS NULL AND "customer_invoices"."cancelled_by" IS NULL)
        OR ("customer_invoices"."status" = 'cancelled' AND "customer_invoices"."cancelled_at" IS NOT NULL AND "customer_invoices"."cancelled_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "customer_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "customer_ledger_entry_type" NOT NULL,
	"amount_agorot" integer NOT NULL,
	"invoice_id" uuid,
	"payment_id" uuid,
	"note" varchar(240),
	"idempotency_key" varchar(80) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "customer_ledger_entries_sign" CHECK (("customer_ledger_entries"."type" IN ('invoice', 'payment_reversal') AND "customer_ledger_entries"."amount_agorot" > 0)
        OR ("customer_ledger_entries"."type" IN ('payment', 'invoice_cancellation') AND "customer_ledger_entries"."amount_agorot" < 0)
        OR ("customer_ledger_entries"."type" = 'adjustment' AND "customer_ledger_entries"."amount_agorot" <> 0))
);
--> statement-breakpoint
CREATE TABLE "customer_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"invoice_id" uuid,
	"amount_agorot" integer NOT NULL,
	"reverses_payment_id" uuid,
	"note" varchar(240),
	"idempotency_key" varchar(80) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_payments_reverses_payment_id_unique" UNIQUE("reverses_payment_id"),
	CONSTRAINT "customer_payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "customer_payments_sign" CHECK (("customer_payments"."amount_agorot" > 0 AND "customer_payments"."reverses_payment_id" IS NULL)
        OR ("customer_payments"."amount_agorot" < 0 AND ("customer_payments"."reverses_payment_id" IS NOT NULL OR "customer_payments"."invoice_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"normalized_name" varchar(100) NOT NULL,
	"phone_e164" varchar(20),
	"notes" varchar(500),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_normalized_name_unique" UNIQUE("normalized_name"),
	CONSTRAINT "customers_name_not_blank" CHECK (char_length(btrim("customers"."name")) >= 2),
	CONSTRAINT "customers_phone_format" CHECK ("customers"."phone_e164" IS NULL OR "customers"."phone_e164" ~ '^\+(970|972)5[0-9]{8}$')
);
--> statement-breakpoint
ALTER TABLE "customer_aliases" ADD CONSTRAINT "customer_aliases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_cancelled_by_admin_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_payment_id_customer_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_reverses_payment_id_customer_payments_id_fk" FOREIGN KEY ("reverses_payment_id") REFERENCES "public"."customer_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "customer_aliases_customer_idx" ON "customer_aliases" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_invoice_lines_invoice_line_uidx" ON "customer_invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE INDEX "customer_invoice_lines_variant_idx" ON "customer_invoice_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "customer_invoices_customer_created_idx" ON "customer_invoices" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_invoices_created_at_idx" ON "customer_invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customer_invoices_created_by_idx" ON "customer_invoices" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "customer_invoices_cancelled_by_idx" ON "customer_invoices" USING btree ("cancelled_by");--> statement-breakpoint
CREATE INDEX "customer_ledger_entries_customer_created_idx" ON "customer_ledger_entries" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_ledger_entries_invoice_idx" ON "customer_ledger_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "customer_ledger_entries_payment_idx" ON "customer_ledger_entries" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "customer_ledger_entries_created_by_idx" ON "customer_ledger_entries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "customer_payments_customer_created_idx" ON "customer_payments" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_payments_invoice_idx" ON "customer_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "customer_payments_created_at_idx" ON "customer_payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customer_payments_created_by_idx" ON "customer_payments" USING btree ("created_by");--> statement-breakpoint
CREATE SEQUENCE "public"."customer_invoice_number_seq" AS integer START WITH 1001;
--> statement-breakpoint
ALTER TABLE "public"."stock_movements"
  ADD CONSTRAINT "stock_movements_customer_invoice_line_id_fk"
  FOREIGN KEY ("customer_invoice_line_id")
  REFERENCES "public"."customer_invoice_lines"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE FUNCTION "public"."enforce_customer_invoice_rules"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'customer invoices cannot be deleted';
  END IF;

  -- The only permitted change is posted -> cancelled; every amount stays as recorded.
  IF NEW."invoice_number" IS DISTINCT FROM OLD."invoice_number"
     OR NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
     OR NEW."customer_name_snapshot" IS DISTINCT FROM OLD."customer_name_snapshot"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."subtotal_agorot" IS DISTINCT FROM OLD."subtotal_agorot"
     OR NEW."discount_agorot" IS DISTINCT FROM OLD."discount_agorot"
     OR NEW."total_agorot" IS DISTINCT FROM OLD."total_agorot"
     OR NEW."paid_at_sale_agorot" IS DISTINCT FROM OLD."paid_at_sale_agorot"
     OR NEW."cogs_agorot" IS DISTINCT FROM OLD."cogs_agorot"
     OR NEW."cost_complete" IS DISTINCT FROM OLD."cost_complete"
     OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'customer invoice snapshots are immutable';
  END IF;

  IF NOT (OLD."status"::text = 'posted' AND NEW."status"::text = 'cancelled') THEN
    RAISE EXCEPTION 'invalid customer invoice status change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';
--> statement-breakpoint
CREATE TRIGGER "customer_invoices_rules"
  BEFORE UPDATE OR DELETE ON "public"."customer_invoices"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."enforce_customer_invoice_rules"();
--> statement-breakpoint
CREATE TRIGGER "customer_invoice_lines_append_only"
  BEFORE UPDATE OR DELETE ON "public"."customer_invoice_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "customer_payments_append_only"
  BEFORE UPDATE OR DELETE ON "public"."customer_payments"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "customer_ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "public"."customer_ledger_entries"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC, anon, authenticated;
