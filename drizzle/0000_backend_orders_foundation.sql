CREATE TYPE "public"."order_status" AS ENUM('pending');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash_on_delivery');--> statement-breakpoint
CREATE TYPE "public"."placeholder_variant" AS ENUM('general-cleaner', 'bleach', 'brush', 'dish-liquid', 'floor-cleaner', 'degreaser');--> statement-breakpoint
CREATE TYPE "public"."product_availability" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('laundry', 'kitchen', 'bathroom', 'tools', 'home');--> statement-breakpoint
CREATE TYPE "public"."product_details_status" AS ENUM('placeholder', 'verified');--> statement-breakpoint
CREATE TYPE "public"."product_image_kind" AS ENUM('placeholder', 'image');--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_domain_id" varchar(80) NOT NULL,
	"product_name_snapshot" varchar(280) NOT NULL,
	"unit_price_agorot" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_subtotal_agorot" integer NOT NULL,
	CONSTRAINT "order_items_order_product_unique" UNIQUE("order_id","product_domain_id"),
	CONSTRAINT "order_items_quantity_bounds" CHECK ("order_items"."quantity" BETWEEN 1 AND 9),
	CONSTRAINT "order_items_non_negative_price" CHECK ("order_items"."unit_price_agorot" >= 0),
	CONSTRAINT "order_items_valid_subtotal" CHECK ("order_items"."line_subtotal_agorot" = "order_items"."unit_price_agorot" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_reference" varchar(40) NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"customer_name" varchar(100) NOT NULL,
	"normalized_phone" varchar(20) NOT NULL,
	"service_area_id" uuid NOT NULL,
	"service_area_code_snapshot" varchar(80) NOT NULL,
	"service_area_name_snapshot" varchar(120) NOT NULL,
	"address" varchar(500) NOT NULL,
	"landmark" varchar(150),
	"customer_note" varchar(500),
	"items_subtotal_agorot" integer NOT NULL,
	"delivery_fee_agorot" integer,
	"final_total_agorot" integer,
	"payment_method" "payment_method" DEFAULT 'cash_on_delivery' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_public_reference_unique" UNIQUE("public_reference"),
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "orders_non_negative_items_subtotal" CHECK ("orders"."items_subtotal_agorot" >= 0),
	CONSTRAINT "orders_non_negative_delivery_fee" CHECK ("orders"."delivery_fee_agorot" IS NULL OR "orders"."delivery_fee_agorot" >= 0),
	CONSTRAINT "orders_valid_final_total" CHECK ((
        ("orders"."delivery_fee_agorot" IS NULL AND "orders"."final_total_agorot" IS NULL)
        OR
        ("orders"."delivery_fee_agorot" IS NOT NULL
          AND "orders"."final_total_agorot" = "orders"."items_subtotal_agorot" + "orders"."delivery_fee_agorot")
      ))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(80) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name_ar" varchar(160) NOT NULL,
	"latin_name" varchar(120),
	"price_agorot" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"category_id" "product_category" NOT NULL,
	"availability" "product_availability" NOT NULL,
	"image_kind" "product_image_kind" NOT NULL,
	"image_src" varchar(500),
	"image_alt" varchar(250),
	"image_width" integer,
	"image_height" integer,
	"placeholder_variant" "placeholder_variant",
	"description" text,
	"usage_notes" text,
	"unit" varchar(80),
	"details_status" "product_details_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_domain_id_unique" UNIQUE("domain_id"),
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_positive_price" CHECK ("products"."price_agorot" > 0),
	CONSTRAINT "products_non_negative_sort" CHECK ("products"."sort_order" >= 0),
	CONSTRAINT "products_valid_image" CHECK ((
        ("products"."image_kind" = 'placeholder'
          AND "products"."placeholder_variant" IS NOT NULL
          AND "products"."image_src" IS NULL
          AND "products"."image_alt" IS NULL
          AND "products"."image_width" IS NULL
          AND "products"."image_height" IS NULL)
        OR
        ("products"."image_kind" = 'image'
          AND "products"."placeholder_variant" IS NULL
          AND "products"."image_src" IS NOT NULL
          AND "products"."image_alt" IS NOT NULL
          AND "products"."image_width" > 0
          AND "products"."image_height" > 0)
      ))
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"name_ar" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"delivery_fee_agorot" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_areas_code_unique" UNIQUE("code"),
	CONSTRAINT "service_areas_non_negative_sort" CHECK ("service_areas"."sort_order" >= 0),
	CONSTRAINT "service_areas_non_negative_fee" CHECK ("service_areas"."delivery_fee_agorot" IS NULL OR "service_areas"."delivery_fee_agorot" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_domain_id_products_domain_id_fk" FOREIGN KEY ("product_domain_id") REFERENCES "public"."products"("domain_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE restrict ON UPDATE cascade;