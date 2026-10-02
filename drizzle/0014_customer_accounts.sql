CREATE TYPE "public"."customer_account_event_type" AS ENUM('account_created', 'login', 'logout_all', 'orders_claimed', 'favorites_merged', 'profile_updated', 'account_deleted');--> statement-breakpoint
CREATE TYPE "public"."customer_order_link_source" AS ENUM('checkout', 'claim');--> statement-breakpoint
CREATE TABLE "customer_account_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "customer_account_event_type" NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" varchar(20),
	"display_name" varchar(100),
	"whatsapp_e164" varchar(20),
	"personalization_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_accounts_phone_format" CHECK ("customer_accounts"."phone_e164" IS NULL OR "customer_accounts"."phone_e164" ~ '^\+(970|972)5[0-9]{8}$'),
	CONSTRAINT "customer_accounts_whatsapp_format" CHECK ("customer_accounts"."whatsapp_e164" IS NULL OR "customer_accounts"."whatsapp_e164" ~ '^\+(970|972)5[0-9]{8}$'),
	CONSTRAINT "customer_accounts_active_has_phone" CHECK ("customer_accounts"."deleted_at" IS NOT NULL OR "customer_accounts"."phone_e164" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"label" varchar(40) NOT NULL,
	"address" varchar(500) NOT NULL,
	"landmark" varchar(150),
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_address_not_blank" CHECK (char_length(btrim("customer_addresses"."address")) >= 5)
);
--> statement-breakpoint
CREATE TABLE "customer_favorites" (
	"account_id" uuid NOT NULL,
	"product_domain_id" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_favorites_account_id_product_domain_id_pk" PRIMARY KEY("account_id","product_domain_id")
);
--> statement-breakpoint
CREATE TABLE "customer_order_links" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "customer_order_link_source" NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "customer_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "customer_account_events" ADD CONSTRAINT "customer_account_events_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_product_domain_id_products_domain_id_fk" FOREIGN KEY ("product_domain_id") REFERENCES "public"."products"("domain_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_order_links" ADD CONSTRAINT "customer_order_links_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order_links" ADD CONSTRAINT "customer_order_links_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_account_events_account_idx" ON "customer_account_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_phone_uidx" ON "customer_accounts" USING btree ("phone_e164") WHERE "customer_accounts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "customer_addresses_account_idx" ON "customer_addresses" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_default_uidx" ON "customer_addresses" USING btree ("account_id") WHERE "customer_addresses"."is_default";--> statement-breakpoint
CREATE INDEX "customer_favorites_product_idx" ON "customer_favorites" USING btree ("product_domain_id");--> statement-breakpoint
CREATE INDEX "customer_order_links_account_idx" ON "customer_order_links" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_account_idx" ON "customer_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE TRIGGER customer_account_events_append_only
  BEFORE UPDATE OR DELETE ON "public"."customer_account_events"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();--> statement-breakpoint
ALTER TABLE "public"."customer_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_favorites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_order_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_account_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
