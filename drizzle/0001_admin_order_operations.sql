CREATE TYPE "public"."admin_role" AS ENUM('owner');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'preparing';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'out_for_delivery';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action_type" varchar(40) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" varchar(80) NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "admin_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"previous_status" "order_status" NOT NULL,
	"new_status" "order_status" NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"reason" varchar(180),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"scope" varchar(40) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_scope_key_hash_pk" PRIMARY KEY("scope","key_hash"),
	CONSTRAINT "rate_limit_buckets_non_negative_count" CHECK ("rate_limit_buckets"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "admin_audit_events_created_at_idx" ON "admin_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_entity_idx" ON "admin_audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_single_owner_idx" ON "admin_users" USING btree ("role") WHERE "admin_users"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "order_status_history_order_created_idx" ON "order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_normalized_phone_idx" ON "orders" USING btree ("normalized_phone");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_positive_version" CHECK ("orders"."version" > 0);--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_order_mutation_rules() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders cannot be deleted';
  END IF;

  IF NEW.public_reference IS DISTINCT FROM OLD.public_reference
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.normalized_phone IS DISTINCT FROM OLD.normalized_phone
     OR NEW.service_area_id IS DISTINCT FROM OLD.service_area_id
     OR NEW.service_area_code_snapshot IS DISTINCT FROM OLD.service_area_code_snapshot
     OR NEW.service_area_name_snapshot IS DISTINCT FROM OLD.service_area_name_snapshot
     OR NEW.address IS DISTINCT FROM OLD.address
     OR NEW.landmark IS DISTINCT FROM OLD.landmark
     OR NEW.customer_note IS DISTINCT FROM OLD.customer_note
     OR NEW.items_subtotal_agorot IS DISTINCT FROM OLD.items_subtotal_agorot
     OR NEW.delivery_fee_agorot IS DISTINCT FROM OLD.delivery_fee_agorot
     OR NEW.final_total_agorot IS DISTINCT FROM OLD.final_total_agorot
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
  THEN
    RAISE EXCEPTION 'order snapshots are immutable';
  END IF;

  IF NEW.status::text IS DISTINCT FROM OLD.status::text THEN
    IF NOT (
      (OLD.status::text = 'pending' AND NEW.status::text IN ('confirmed', 'cancelled'))
      OR (OLD.status::text = 'confirmed' AND NEW.status::text IN ('preparing', 'cancelled'))
      OR (OLD.status::text = 'preparing' AND NEW.status::text IN ('out_for_delivery', 'cancelled'))
      OR (OLD.status::text = 'out_for_delivery' AND NEW.status::text IN ('delivered', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'invalid order status transition';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'order version must increment with status changes';
    END IF;
  ELSIF NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'order version cannot change without a status change';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER orders_mutation_rules
  BEFORE UPDATE OR DELETE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_order_mutation_rules();--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER order_status_history_append_only
  BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW
  EXECUTE FUNCTION reject_append_only_mutation();--> statement-breakpoint
CREATE TRIGGER admin_audit_events_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_append_only_mutation();
