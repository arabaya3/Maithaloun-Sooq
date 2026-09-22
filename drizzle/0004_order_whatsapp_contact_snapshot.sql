ALTER TABLE "orders"
  ADD COLUMN "customer_full_name" varchar(100);--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN "delivery_address" varchar(500);--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN "whatsapp_phone_e164" varchar(20);--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_customer_full_name_length"
  CHECK (
    "customer_full_name" IS NULL
    OR (
      char_length(btrim("customer_full_name")) BETWEEN 2 AND 100
    )
  );--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_delivery_address_length"
  CHECK (
    "delivery_address" IS NULL
    OR (
      char_length(btrim("delivery_address")) BETWEEN 8 AND 500
    )
  );--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_whatsapp_phone_e164_format"
  CHECK (
    "whatsapp_phone_e164" IS NULL
    OR (
      "whatsapp_phone_e164" ~ '^\+(970|972)5[0-9]{8}$'
    )
  );--> statement-breakpoint
CREATE INDEX "orders_whatsapp_phone_e164_idx"
  ON "public"."orders" USING btree ("whatsapp_phone_e164");
