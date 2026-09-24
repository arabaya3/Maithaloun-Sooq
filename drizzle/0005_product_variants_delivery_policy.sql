-- Product variants, specifications, order-item snapshots, ميثلون-only delivery.

CREATE TABLE IF NOT EXISTS "product_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "domain_id" varchar(100) NOT NULL,
  "label_ar" varchar(120) NOT NULL,
  "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "price_agorot" integer NOT NULL,
  "availability" "product_availability" NOT NULL,
  "image_kind" "product_image_kind" NOT NULL,
  "image_src" varchar(500),
  "image_alt" varchar(250),
  "image_width" integer,
  "image_height" integer,
  "placeholder_variant" "placeholder_variant",
  "sku" varchar(64),
  "barcode" varchar(64),
  "sort_order" integer NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_variants_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_variants_non_negative_price"
    CHECK ("price_agorot" >= 0),
  CONSTRAINT "product_variants_non_negative_sort"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "product_variants_valid_image" CHECK (
    (
      "image_kind" = 'placeholder'
      AND "placeholder_variant" IS NOT NULL
      AND "image_src" IS NULL
      AND "image_alt" IS NULL
      AND "image_width" IS NULL
      AND "image_height" IS NULL
    )
    OR
    (
      "image_kind" = 'image'
      AND "placeholder_variant" IS NULL
      AND "image_src" IS NOT NULL
      AND "image_alt" IS NOT NULL
      AND "image_width" > 0
      AND "image_height" > 0
    )
  ),
  CONSTRAINT "product_variants_attributes_object"
    CHECK (jsonb_typeof("attributes") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_domain_id_uidx"
  ON "product_variants" ("domain_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_product_sort_uidx"
  ON "product_variants" ("product_id", "sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_one_default_uidx"
  ON "product_variants" ("product_id")
  WHERE "is_default" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_variants_product_id_idx"
  ON "product_variants" ("product_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "product_specifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "label_ar" varchar(80) NOT NULL,
  "value_ar" varchar(200) NOT NULL,
  "sort_order" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_specifications_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_specifications_non_negative_sort"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "product_specifications_label_not_blank"
    CHECK (char_length(btrim("label_ar")) BETWEEN 1 AND 80),
  CONSTRAINT "product_specifications_value_not_blank"
    CHECK (char_length(btrim("value_ar")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_specifications_product_sort_uidx"
  ON "product_specifications" ("product_id", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_specifications_product_id_idx"
  ON "product_specifications" ("product_id");
--> statement-breakpoint

ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_order_product_unique";
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "variant_domain_id" varchar(100),
  ADD COLUMN IF NOT EXISTS "variant_label_snapshot" varchar(120),
  ADD COLUMN IF NOT EXISTS "variant_attributes_snapshot" jsonb,
  ADD COLUMN IF NOT EXISTS "variant_sku_snapshot" varchar(64),
  ADD COLUMN IF NOT EXISTS "variant_barcode_snapshot" varchar(64);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_items_order_variant_uidx"
  ON "order_items" ("order_id", "variant_domain_id")
  WHERE "variant_domain_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_variant_domain_id_idx"
  ON "order_items" ("variant_domain_id");
--> statement-breakpoint

-- Backfill one default variant from each existing product (authoritative data only).
INSERT INTO "product_variants" (
  "product_id",
  "domain_id",
  "label_ar",
  "attributes",
  "price_agorot",
  "availability",
  "image_kind",
  "image_src",
  "image_alt",
  "image_width",
  "image_height",
  "placeholder_variant",
  "sku",
  "barcode",
  "sort_order",
  "is_default",
  "created_at",
  "updated_at"
)
SELECT
  p."id",
  p."domain_id" || '--default',
  COALESCE(NULLIF(btrim(p."unit"), ''), 'الافتراضي'),
  CASE
    WHEN p."unit" IS NOT NULL AND btrim(p."unit") <> ''
      THEN jsonb_build_object('الوحدة', btrim(p."unit"))
    ELSE '{}'::jsonb
  END,
  p."price_agorot",
  p."availability",
  p."image_kind",
  p."image_src",
  p."image_alt",
  p."image_width",
  p."image_height",
  p."placeholder_variant",
  NULL,
  NULL,
  0,
  true,
  now(),
  now()
FROM "products" p
WHERE NOT EXISTS (
  SELECT 1
  FROM "product_variants" v
  WHERE v."product_id" = p."id"
);
--> statement-breakpoint

-- Keep historical service areas; only ميثلون remains active for new orders.
UPDATE "service_areas"
SET
  "enabled" = ("code" = 'maythalun'),
  "updated_at" = now()
WHERE "code" IN ('ramallah', 'al-bireh', 'maythalun', 'other')
   OR "enabled" = true;
--> statement-breakpoint
UPDATE "service_areas"
SET
  "enabled" = true,
  "name_ar" = 'ميثلون',
  "updated_at" = now()
WHERE "code" = 'maythalun';
