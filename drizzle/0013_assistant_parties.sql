CREATE TYPE "public"."offer_kind" AS ENUM('percentage', 'amount_off', 'fixed_price');--> statement-breakpoint
CREATE TABLE "offer_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"category_code" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_targets_exactly_one" CHECK (num_nonnulls("offer_targets"."product_id", "offer_targets"."variant_id", "offer_targets"."category_code") = 1)
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" varchar(80) NOT NULL,
	"display_text" varchar(120),
	"kind" "offer_kind" NOT NULL,
	"value" integer NOT NULL,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"enabled" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_value_range" CHECK (("offers"."kind" = 'percentage' AND "offers"."value" BETWEEN 1 AND 90)
        OR ("offers"."kind" <> 'percentage' AND "offers"."value" BETWEEN 1 AND 10000000)),
	CONSTRAINT "offers_min_quantity" CHECK ("offers"."min_quantity" BETWEEN 1 AND 100),
	CONSTRAINT "offers_window" CHECK ("offers"."starts_at" IS NULL OR "offers"."ends_at" IS NULL OR "offers"."ends_at" > "offers"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "list_unit_price_agorot" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "offer_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "merged_into_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address" varchar(300);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "landmark" varchar(160);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "merged_into_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "offer_targets" ADD CONSTRAINT "offer_targets_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_targets" ADD CONSTRAINT "offer_targets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_targets" ADD CONSTRAINT "offer_targets_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_targets" ADD CONSTRAINT "offer_targets_category_code_product_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."product_categories"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "offer_targets_offer_idx" ON "offer_targets" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offer_targets_product_idx" ON "offer_targets" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "offer_targets_variant_idx" ON "offer_targets" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "offer_targets_category_idx" ON "offer_targets" USING btree ("category_code");--> statement-breakpoint
CREATE INDEX "offers_live_idx" ON "offers" USING btree ("starts_at","ends_at") WHERE "offers"."enabled" AND "offers"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_merged_into_supplier_id_suppliers_id_fk" FOREIGN KEY ("merged_into_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_customer_id_customers_id_fk" FOREIGN KEY ("merged_into_customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_offer_idx" ON "order_items" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "suppliers_merged_into_idx" ON "suppliers" USING btree ("merged_into_supplier_id");--> statement-breakpoint
CREATE INDEX "customers_merged_into_idx" ON "customers" USING btree ("merged_into_customer_id");--> statement-breakpoint
ALTER TABLE "public"."offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."offer_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
