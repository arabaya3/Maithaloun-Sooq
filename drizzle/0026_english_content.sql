ALTER TABLE "product_categories" ADD COLUMN "name_en" varchar(80);--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN "description_en" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "name_en" varchar(160);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description_en" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "usage_notes_en" text;