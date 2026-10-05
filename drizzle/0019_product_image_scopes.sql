CREATE TYPE "public"."product_image_scope" AS ENUM('unassigned', 'product', 'option_value', 'variant');--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "scope" "product_image_scope" DEFAULT 'product' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "option_id" uuid;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "option_value_id" uuid;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD COLUMN "uses_shared_image" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing images keep what they already proved: an image already linked to a variant is that variant's image;
-- every other image stays a shared product image. Nothing is guessed from file names, colours or order.
UPDATE "product_images" SET "scope" = 'variant' WHERE "variant_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_option_same_product_fk" FOREIGN KEY ("option_id","product_id") REFERENCES "public"."product_options"("id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_value_same_option_fk" FOREIGN KEY ("option_value_id","option_id") REFERENCES "public"."product_option_values"("id","option_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_option_idx" ON "product_images" USING btree ("option_id","product_id");--> statement-breakpoint
CREATE INDEX "product_images_option_value_idx" ON "product_images" USING btree ("option_value_id","option_id");--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_scope_target" CHECK (("product_images"."scope" = 'variant' AND "product_images"."variant_id" IS NOT NULL AND "product_images"."option_id" IS NULL AND "product_images"."option_value_id" IS NULL) OR ("product_images"."scope" = 'option_value' AND "product_images"."variant_id" IS NULL AND "product_images"."option_id" IS NOT NULL AND "product_images"."option_value_id" IS NOT NULL) OR ("product_images"."scope" IN ('product', 'unassigned') AND "product_images"."variant_id" IS NULL AND "product_images"."option_id" IS NULL AND "product_images"."option_value_id" IS NULL));--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_unassigned_not_primary" CHECK (NOT ("product_images"."is_primary" AND "product_images"."scope" = 'unassigned'));--> statement-breakpoint
ALTER TABLE "public"."product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."product_option_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "public"."product_images", "public"."product_option_values" FROM anon, authenticated;
