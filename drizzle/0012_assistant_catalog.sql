CREATE TYPE "public"."product_publication" AS ENUM('draft', 'published', 'hidden');--> statement-breakpoint
CREATE TABLE "product_categories" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"name_ar" varchar(80) NOT NULL,
	"description" text,
	"icon" varchar(30) NOT NULL,
	"sort_order" integer NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"merged_into_code" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_code_format" CHECK ("product_categories"."code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "product_categories"."code" <> 'all'),
	CONSTRAINT "product_categories_non_negative_sort" CHECK ("product_categories"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "admin_assistant_confirmations" DROP CONSTRAINT "admin_assistant_confirmations_risk";--> statement-breakpoint
ALTER TABLE "admin_assistant_tool_runs" DROP CONSTRAINT "admin_assistant_tool_runs_risk";--> statement-breakpoint
-- The five original categories become rows, so every existing product keeps its category.
INSERT INTO "product_categories" ("code", "name_ar", "icon", "sort_order") VALUES
	('laundry', 'منظفات الغسيل', 'washing-machine', 0),
	('kitchen', 'منظفات المطبخ', 'cooking-pot', 1),
	('bathroom', 'منظفات الحمام', 'bath', 2),
	('tools', 'أدوات التنظيف', 'brush', 3),
	('home', 'مستلزمات منزلية', 'house', 4)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "category_id" SET DATA TYPE varchar(40) USING "category_id"::text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "publication" "product_publication" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_assistant_confirmations" ADD COLUMN "token_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_merged_into_code_product_categories_code_fk" FOREIGN KEY ("merged_into_code") REFERENCES "public"."product_categories"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "product_categories_merged_into_idx" ON "product_categories" USING btree ("merged_into_code");--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_active_name_uidx" ON "product_categories" USING btree (lower("name_ar")) WHERE "product_categories"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_code_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "product_variants_sku_idx" ON "product_variants" USING btree (lower("sku")) WHERE "product_variants"."sku" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "product_variants_barcode_idx" ON "product_variants" USING btree ("barcode") WHERE "product_variants"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_storefront_idx" ON "products" USING btree ("sort_order") WHERE "products"."publication" = 'published' AND "products"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_default_not_archived" CHECK (NOT ("product_variants"."is_default" AND "product_variants"."archived_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "admin_assistant_confirmations" ADD CONSTRAINT "admin_assistant_confirmations_risk" CHECK ("admin_assistant_confirmations"."risk_level" BETWEEN 2 AND 4);--> statement-breakpoint
ALTER TABLE "admin_assistant_tool_runs" ADD CONSTRAINT "admin_assistant_tool_runs_risk" CHECK ("admin_assistant_tool_runs"."risk_level" BETWEEN 1 AND 4);--> statement-breakpoint
ALTER TABLE "public"."product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
