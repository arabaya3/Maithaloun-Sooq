-- One product, several categories. products.category_id stays the primary category (routes,
-- breadcrumbs, offers); this table lists every category the product is shown in, primary included.
-- Every statement is safe to run again; nothing on products is changed.
CREATE TABLE IF NOT EXISTS "product_category_links" (
	"product_id" uuid NOT NULL,
	"category_code" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_category_links_product_id_category_code_pk" PRIMARY KEY("product_id","category_code")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "product_category_links" ADD CONSTRAINT "product_category_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "product_category_links" ADD CONSTRAINT "product_category_links_category_code_product_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."product_categories"("code") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_category_links_category_idx" ON "product_category_links" USING btree ("category_code");
--> statement-breakpoint
ALTER TABLE "product_category_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Backfill: each product keeps the category it has today.
INSERT INTO "product_category_links" ("product_id", "category_code")
SELECT "id", "category_id" FROM "products"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Whatever writes products.category_id (admin, assistant, capture, imports, merges), the primary
-- is always one of the product's links, and a replaced primary leaves the product's categories.
CREATE OR REPLACE FUNCTION "product_category_links_sync_primary"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND NEW."category_id" IS DISTINCT FROM OLD."category_id" THEN
		DELETE FROM "product_category_links"
		WHERE "product_id" = NEW."id" AND "category_code" = OLD."category_id";
	END IF;
	INSERT INTO "product_category_links" ("product_id", "category_code")
	VALUES (NEW."id", NEW."category_id")
	ON CONFLICT DO NOTHING;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "products_category_links_sync" ON "products";
--> statement-breakpoint
CREATE TRIGGER "products_category_links_sync"
AFTER INSERT OR UPDATE OF "category_id" ON "products"
FOR EACH ROW EXECUTE FUNCTION "product_category_links_sync_primary"();
