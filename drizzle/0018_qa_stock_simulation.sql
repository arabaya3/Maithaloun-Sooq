CREATE TABLE "qa_simulation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'issued' NOT NULL,
	"support_reference" varchar(16) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qa_simulation_runs_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "qa_simulation_runs_status" CHECK ("qa_simulation_runs"."status" IN ('issued', 'running', 'passed', 'failed', 'expired')),
	CONSTRAINT "qa_simulation_runs_duration" CHECK ("qa_simulation_runs"."duration_ms" IS NULL OR "qa_simulation_runs"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_test_never_fulfilled";--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "qa_owned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qa_simulation_runs" ADD CONSTRAINT "qa_simulation_runs_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "qa_simulation_runs" ADD CONSTRAINT "qa_simulation_runs_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "qa_simulation_runs_admin_created_idx" ON "qa_simulation_runs" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX "qa_simulation_runs_variant_idx" ON "qa_simulation_runs" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qa_simulation_runs_one_running_per_variant" ON "qa_simulation_runs" USING btree ("variant_id") WHERE "qa_simulation_runs"."status" = 'running';--> statement-breakpoint
-- A QA order may move past pending/cancelled only inside the stock-path simulation,
-- whose transaction sets this flag locally and is always rolled back.
CREATE FUNCTION "public"."orders_test_never_fulfilled"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF NEW.is_test
     AND NEW.status NOT IN ('pending', 'cancelled')
     AND coalesce(current_setting('app.qa_stock_simulation', true), '') <> 'on' THEN
    RAISE EXCEPTION 'QA orders are never fulfilled outside a rolled-back stock simulation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."orders_test_never_fulfilled"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER "orders_test_never_fulfilled"
  BEFORE INSERT OR UPDATE OF "status", "is_test" ON "public"."orders"
  FOR EACH ROW EXECUTE FUNCTION "public"."orders_test_never_fulfilled"();--> statement-breakpoint
ALTER TABLE "public"."qa_simulation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
