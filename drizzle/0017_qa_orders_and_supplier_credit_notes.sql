ALTER TABLE "orders" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_ledger_entries" ADD COLUMN "document_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "supplier_ledger_entries" ADD COLUMN "document_reference" varchar(80);--> statement-breakpoint
CREATE INDEX "orders_test_created_at_idx" ON "orders" USING btree ("created_at") WHERE "orders"."is_test";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_test_contact" CHECK (("orders"."is_test" AND "orders"."normalized_phone" = 'qa-test' AND "orders"."whatsapp_phone_e164" IS NULL)
        OR (NOT "orders"."is_test" AND "orders"."normalized_phone" <> 'qa-test'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_test_never_fulfilled" CHECK (NOT "orders"."is_test" OR "orders"."status" IN ('pending', 'cancelled'));--> statement-breakpoint
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_credit_note" CHECK ("supplier_ledger_entries"."document_kind" IS NULL
        OR ("supplier_ledger_entries"."document_kind" = 'credit_note'
          AND "supplier_ledger_entries"."type" = 'correction'
          AND "supplier_ledger_entries"."amount_agorot" < 0
          AND char_length(btrim("supplier_ledger_entries"."document_reference")) BETWEEN 1 AND 80));