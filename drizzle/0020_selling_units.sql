CREATE TABLE "product_selling_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"label_ar" varchar(60) NOT NULL,
	"units_per_sale" integer NOT NULL,
	"price_agorot" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"mirrors_variant" boolean DEFAULT false NOT NULL,
	"sku" varchar(64),
	"barcode" varchar(64),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_selling_units_units_per_sale" CHECK ("product_selling_units"."units_per_sale" BETWEEN 1 AND 1000),
	CONSTRAINT "product_selling_units_positive_price" CHECK ("product_selling_units"."price_agorot" BETWEEN 1 AND 10000000),
	CONSTRAINT "product_selling_units_label" CHECK (char_length(btrim("product_selling_units"."label_ar")) BETWEEN 1 AND 60),
	CONSTRAINT "product_selling_units_default_active" CHECK (NOT ("product_selling_units"."is_default" AND "product_selling_units"."archived_at" IS NOT NULL)),
	CONSTRAINT "product_selling_units_mirror_single" CHECK (NOT "product_selling_units"."mirrors_variant" OR "product_selling_units"."units_per_sale" = 1),
	CONSTRAINT "product_selling_units_non_negative_sort" CHECK ("product_selling_units"."sort_order" >= 0),
	CONSTRAINT "product_selling_units_positive_version" CHECK ("product_selling_units"."version" > 0)
);
--> statement-breakpoint
DROP INDEX "order_items_order_variant_uidx";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "selling_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "selling_unit_label_snapshot" varchar(60);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "selling_unit_sku_snapshot" varchar(64);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "selling_unit_barcode_snapshot" varchar(64);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "units_per_sale" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "base_units" integer GENERATED ALWAYS AS (quantity * units_per_sale) STORED;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD COLUMN "selling_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD COLUMN "selling_unit_label_snapshot" varchar(60);--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD COLUMN "units_per_sale" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD COLUMN "pack_quantity" integer;--> statement-breakpoint
ALTER TABLE "product_selling_units" ADD CONSTRAINT "product_selling_units_variant_fk" FOREIGN KEY ("variant_id","product_id") REFERENCES "public"."product_variants"("id","product_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "product_selling_units_variant_idx" ON "product_selling_units" USING btree ("variant_id","product_id");--> statement-breakpoint
CREATE INDEX "product_selling_units_product_idx" ON "product_selling_units" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_selling_units_one_default_uidx" ON "product_selling_units" USING btree ("variant_id") WHERE "product_selling_units"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "product_selling_units_one_mirror_uidx" ON "product_selling_units" USING btree ("variant_id") WHERE "product_selling_units"."mirrors_variant";--> statement-breakpoint
CREATE UNIQUE INDEX "product_selling_units_active_units_uidx" ON "product_selling_units" USING btree ("variant_id","units_per_sale") WHERE "product_selling_units"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_selling_units_active_label_uidx" ON "product_selling_units" USING btree ("variant_id",lower(btrim("label_ar"))) WHERE "product_selling_units"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_selling_units_active_sku_uidx" ON "product_selling_units" USING btree (lower("sku")) WHERE "product_selling_units"."sku" IS NOT NULL AND "product_selling_units"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_selling_units_active_barcode_uidx" ON "product_selling_units" USING btree ("barcode") WHERE "product_selling_units"."barcode" IS NOT NULL AND "product_selling_units"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_selling_unit_id_product_selling_units_id_fk" FOREIGN KEY ("selling_unit_id") REFERENCES "public"."product_selling_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_selling_unit_id_product_selling_units_id_fk" FOREIGN KEY ("selling_unit_id") REFERENCES "public"."product_selling_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_selling_unit_uidx" ON "order_items" USING btree ("order_id","selling_unit_id") WHERE "order_items"."selling_unit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_items_selling_unit_idx" ON "order_items" USING btree ("selling_unit_id");--> statement-breakpoint
CREATE INDEX "customer_invoice_lines_selling_unit_idx" ON "customer_invoice_lines" USING btree ("selling_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_variant_uidx" ON "order_items" USING btree ("order_id","variant_domain_id") WHERE "order_items"."variant_domain_id" IS NOT NULL AND "order_items"."selling_unit_id" IS NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_units_per_sale" CHECK ("order_items"."units_per_sale" BETWEEN 1 AND 1000);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_selling_unit_snapshot" CHECK ("order_items"."selling_unit_id" IS NULL OR "order_items"."selling_unit_label_snapshot" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_selling_unit" CHECK (("customer_invoice_lines"."selling_unit_id" IS NULL AND "customer_invoice_lines"."pack_quantity" IS NULL AND "customer_invoice_lines"."units_per_sale" = 1)
        OR ("customer_invoice_lines"."selling_unit_id" IS NOT NULL
          AND "customer_invoice_lines"."selling_unit_label_snapshot" IS NOT NULL
          AND "customer_invoice_lines"."units_per_sale" BETWEEN 1 AND 1000
          AND "customer_invoice_lines"."pack_quantity" >= 1
          AND "customer_invoice_lines"."quantity_milli" = "customer_invoice_lines"."pack_quantity" * "customer_invoice_lines"."units_per_sale" * 1000
          AND "customer_invoice_lines"."line_total_agorot" = "customer_invoice_lines"."pack_quantity" * "customer_invoice_lines"."unit_price_agorot"));--> statement-breakpoint
ALTER TABLE "product_selling_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "product_selling_units" FROM anon, authenticated;--> statement-breakpoint
-- Every live variant keeps one base selling unit (1 piece) whose price follows the variant price,
-- so the existing price editors, assistant tools and purchase price reviews stay consistent.
CREATE FUNCTION "public"."sync_variant_selling_unit"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL OR NEW.price_agorot <= 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.price_agorot IS DISTINCT FROM OLD.price_agorot THEN
    UPDATE "public"."product_selling_units"
       SET price_agorot = NEW.price_agorot, version = version + 1, updated_at = now()
     WHERE variant_id = NEW.id AND mirrors_variant AND price_agorot <> NEW.price_agorot;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."product_selling_units" WHERE variant_id = NEW.id) THEN
    INSERT INTO "public"."product_selling_units"
      (product_id, variant_id, label_ar, units_per_sale, price_agorot, is_default, mirrors_variant)
    VALUES (NEW.product_id, NEW.id, 'حبة واحدة', 1, NEW.price_agorot, true, true);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."sync_variant_selling_unit"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER "product_variants_selling_unit"
  AFTER INSERT OR UPDATE OF price_agorot, archived_at ON "public"."product_variants"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."sync_variant_selling_unit"();--> statement-breakpoint
-- One-time backfill: existing live variants are sold as one piece at their current price. Order history is untouched.
INSERT INTO "product_selling_units"
  (product_id, variant_id, label_ar, units_per_sale, price_agorot, is_default, mirrors_variant)
SELECT v.product_id, v.id, 'حبة واحدة', 1, v.price_agorot, true, true
  FROM "product_variants" v
 WHERE v.archived_at IS NULL
   AND v.price_agorot > 0
   AND NOT EXISTS (SELECT 1 FROM "product_selling_units" s WHERE s.variant_id = v.id);--> statement-breakpoint
-- Line snapshots never change after the sale; only key cascades from renamed products or variants pass.
CREATE FUNCTION "public"."reject_line_snapshot_change"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - TG_ARGV[0] - 'base_units') IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV[0] - 'base_units') THEN
    RAISE EXCEPTION 'order and invoice line snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."reject_line_snapshot_change"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER "order_items_snapshot_immutable"
  BEFORE UPDATE ON "public"."order_items"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_line_snapshot_change"('product_domain_id');--> statement-breakpoint
CREATE TRIGGER "customer_invoice_lines_snapshot_immutable"
  BEFORE UPDATE ON "public"."customer_invoice_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_line_snapshot_change"('variant_id');
