CREATE TYPE "public"."business_report_kind" AS ENUM('fortnightly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."push_delivery_status" AS ENUM('sent', 'failed', 'no_subscribers', 'not_configured');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."voice_command_status" AS ENUM('needs_clarification', 'review', 'answered', 'confirmed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."voice_transcript_source" AS ENUM('browser', 'server', 'typed');--> statement-breakpoint
CREATE TABLE "business_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "business_report_kind" NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"metrics" jsonb NOT NULL,
	"headline" varchar(240) NOT NULL,
	"insight" jsonb,
	"ai_model" varchar(80),
	"prompt_version" varchar(40),
	"notification_id" uuid,
	"push_status" "push_delivery_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_reports_period_order" CHECK ("business_reports"."period_from" <= "business_reports"."period_to")
);
--> statement-breakpoint
CREATE TABLE "customer_reminder_state" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"snoozed_until" date,
	"disputed" boolean DEFAULT false NOT NULL,
	"dispute_note" varchar(240),
	"last_reminded_on" date,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"reminder_date" date NOT NULL,
	"balance_agorot" integer NOT NULL,
	"days_outstanding" integer NOT NULL,
	"notification_id" uuid,
	"push_status" "push_delivery_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_reminders_positive_balance" CHECK ("customer_reminders"."balance_agorot" > 0)
);
--> statement-breakpoint
CREATE TABLE "scheduled_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" varchar(60) NOT NULL,
	"run_date" date NOT NULL,
	"status" "scheduled_job_status" NOT NULL,
	"details" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "store_settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transcript" varchar(1000) NOT NULL,
	"transcript_source" "voice_transcript_source" NOT NULL,
	"intent" varchar(40),
	"interpretation" jsonb,
	"ai_model" varchar(80),
	"prompt_version" varchar(40),
	"status" "voice_command_status" NOT NULL,
	"corrections" jsonb,
	"result_entity_type" varchar(40),
	"result_entity_id" varchar(80),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD COLUMN "dedupe_key" varchar(120);--> statement-breakpoint
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_notification_id_admin_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."admin_notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reminder_state" ADD CONSTRAINT "customer_reminder_state_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reminder_state" ADD CONSTRAINT "customer_reminder_state_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_reminders" ADD CONSTRAINT "customer_reminders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reminders" ADD CONSTRAINT "customer_reminders_notification_id_admin_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."admin_notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "voice_commands" ADD CONSTRAINT "voice_commands_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "business_reports_kind_period_uidx" ON "business_reports" USING btree ("kind","period_from","period_to");--> statement-breakpoint
CREATE INDEX "business_reports_created_at_idx" ON "business_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "business_reports_notification_idx" ON "business_reports" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "customer_reminder_state_updated_by_idx" ON "customer_reminder_state" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_reminders_customer_date_uidx" ON "customer_reminders" USING btree ("customer_id","reminder_date");--> statement-breakpoint
CREATE INDEX "customer_reminders_notification_idx" ON "customer_reminders" USING btree ("notification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_job_runs_job_date_uidx" ON "scheduled_job_runs" USING btree ("job","run_date");--> statement-breakpoint
CREATE INDEX "store_settings_updated_by_idx" ON "store_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "voice_commands_created_by_created_idx" ON "voice_commands" USING btree ("created_by","created_at");--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_dedupe_key_unique" UNIQUE("dedupe_key");--> statement-breakpoint
CREATE TRIGGER "business_reports_append_only"
  BEFORE UPDATE OR DELETE ON "public"."business_reports"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."reject_append_only_mutation"();
--> statement-breakpoint
ALTER TABLE "public"."voice_commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_reminder_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."customer_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."business_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."store_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."scheduled_job_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC, anon, authenticated;
