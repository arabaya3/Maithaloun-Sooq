CREATE TYPE "public"."product_option_kind" AS ENUM('color', 'fragrance', 'size', 'pack', 'other');--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"src" varchar(500) NOT NULL,
	"alt_ar" varchar(250) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_dimensions" CHECK ("product_images"."width" > 0 AND "product_images"."height" > 0),
	CONSTRAINT "product_images_sort" CHECK ("product_images"."sort_order" >= 0),
	CONSTRAINT "product_images_primary_active" CHECK (NOT ("product_images"."is_primary" AND "product_images"."archived_at" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "product_option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"value_ar" varchar(60) NOT NULL,
	"normalized_value" varchar(60) NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_values_sort" CHECK ("product_option_values"."sort_order" >= 0),
	CONSTRAINT "product_option_values_not_blank" CHECK (char_length(btrim("product_option_values"."value_ar")) >= 1)
);--> statement-breakpoint
CREATE TABLE "product_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name_ar" varchar(40) NOT NULL,
	"normalized_name" varchar(40) NOT NULL,
	"kind" "product_option_kind" DEFAULT 'other' NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_options_sort" CHECK ("product_options"."sort_order" >= 0),
	CONSTRAINT "product_options_name_not_blank" CHECK (char_length(btrim("product_options"."name_ar")) >= 1)
);--> statement-breakpoint
CREATE TABLE "product_variant_option_values" (
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	CONSTRAINT "product_variant_option_values_variant_id_option_id_pk" PRIMARY KEY("variant_id","option_id")
);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "pack_count" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "combination_key" varchar(400);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_pack_count" CHECK ("product_variants"."pack_count" IS NULL OR "product_variants"."pack_count" BETWEEN 1 AND 1000);--> statement-breakpoint
CREATE INDEX "product_images_product_sort_idx" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_images_variant_idx" ON "product_images" USING btree ("variant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_one_primary_uidx" ON "product_images" USING btree ("product_id") WHERE "product_images"."is_primary" AND "product_images"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_values_value_uidx" ON "product_option_values" USING btree ("option_id","normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_values_id_option_uidx" ON "product_option_values" USING btree ("id","option_id");--> statement-breakpoint
CREATE INDEX "product_option_values_option_product_idx" ON "product_option_values" USING btree ("option_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_options_name_uidx" ON "product_options" USING btree ("product_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "product_options_id_product_uidx" ON "product_options" USING btree ("id","product_id");--> statement-breakpoint
CREATE INDEX "product_variant_option_values_variant_idx" ON "product_variant_option_values" USING btree ("variant_id","product_id");--> statement-breakpoint
CREATE INDEX "product_variant_option_values_option_idx" ON "product_variant_option_values" USING btree ("option_id","product_id");--> statement-breakpoint
CREATE INDEX "product_variant_option_values_value_idx" ON "product_variant_option_values" USING btree ("value_id","option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_id_product_uidx" ON "product_variants" USING btree ("id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_active_combination_uidx" ON "product_variants" USING btree ("product_id","combination_key") WHERE "product_variants"."archived_at" IS NULL AND "product_variants"."combination_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_same_product_fk" FOREIGN KEY ("variant_id","product_id") REFERENCES "public"."product_variants"("id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_same_product_fk" FOREIGN KEY ("option_id","product_id") REFERENCES "public"."product_options"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_fk" FOREIGN KEY ("variant_id","product_id") REFERENCES "public"."product_variants"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_fk" FOREIGN KEY ("option_id","product_id") REFERENCES "public"."product_options"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_value_fk" FOREIGN KEY ("value_id","option_id") REFERENCES "public"."product_option_values"("id","option_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing single product images become each product's primary gallery image.
INSERT INTO "product_images" ("product_id", "src", "alt_ar", "width", "height", "sort_order", "is_primary")
SELECT p."id", p."image_src", p."image_alt", p."image_width", p."image_height", 0, true
FROM "products" p
WHERE p."image_kind" = 'image'
  AND NOT EXISTS (SELECT 1 FROM "product_images" i WHERE i."product_id" = p."id");--> statement-breakpoint
-- A variant image that differs from its product's image is kept as an assigned gallery image.
INSERT INTO "product_images" ("product_id", "variant_id", "src", "alt_ar", "width", "height", "sort_order", "is_primary")
SELECT v."product_id", v."id", v."image_src", v."image_alt", v."image_width", v."image_height", 1 + v."sort_order", false
FROM "product_variants" v
JOIN "products" p ON p."id" = v."product_id"
WHERE v."image_kind" = 'image'
  AND v."image_src" IS DISTINCT FROM p."image_src"
  AND NOT EXISTS (
    SELECT 1 FROM "product_images" i
    WHERE i."product_id" = v."product_id" AND i."src" = v."image_src"
  );--> statement-breakpoint
ALTER TABLE "public"."product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."product_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."product_option_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."product_variant_option_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
