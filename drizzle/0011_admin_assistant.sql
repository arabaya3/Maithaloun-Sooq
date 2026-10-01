ALTER TYPE "public"."sale_source" ADD VALUE 'assistant';--> statement-breakpoint
CREATE TABLE "admin_assistant_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"mime_type" varchar(60) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"width" integer,
	"height" integer,
	"storage_provider" varchar(20) NOT NULL,
	"storage_bucket" varchar(80) NOT NULL,
	"storage_path" varchar(220) NOT NULL,
	"status" varchar(16) DEFAULT 'temporary' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_assistant_attachments_status" CHECK ("admin_assistant_attachments"."status" IN ('temporary', 'used', 'deleted')),
	CONSTRAINT "admin_assistant_attachments_positive_size" CHECK ("admin_assistant_attachments"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "admin_assistant_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"admin_user_id" uuid NOT NULL,
	"operation" varchar(60) NOT NULL,
	"risk_level" smallint NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"record_version" varchar(120) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"result" jsonb,
	"error_code" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_assistant_confirmations_status" CHECK ("admin_assistant_confirmations"."status" IN ('pending', 'executing', 'completed', 'failed', 'expired', 'cancelled')),
	CONSTRAINT "admin_assistant_confirmations_risk" CHECK ("admin_assistant_confirmations"."risk_level" BETWEEN 2 AND 3)
);
--> statement-breakpoint
CREATE TABLE "admin_assistant_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"title" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" varchar(80) NOT NULL,
	"role" varchar(16) NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_assistant_messages_role" CHECK ("admin_assistant_messages"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "admin_assistant_tool_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"admin_user_id" uuid NOT NULL,
	"tool_name" varchar(60) NOT NULL,
	"risk_level" smallint NOT NULL,
	"status" varchar(16) NOT NULL,
	"input_summary" jsonb,
	"result_ref" varchar(160),
	"error_code" varchar(60),
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_assistant_tool_runs_status" CHECK ("admin_assistant_tool_runs"."status" IN ('succeeded', 'failed', 'rejected')),
	CONSTRAINT "admin_assistant_tool_runs_risk" CHECK ("admin_assistant_tool_runs"."risk_level" BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "merged_into_product_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_assistant_attachments" ADD CONSTRAINT "admin_assistant_attachments_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_assistant_confirmations" ADD CONSTRAINT "admin_assistant_confirmations_conversation_id_admin_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."admin_assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_assistant_confirmations" ADD CONSTRAINT "admin_assistant_confirmations_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_assistant_conversations" ADD CONSTRAINT "admin_assistant_conversations_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_assistant_messages" ADD CONSTRAINT "admin_assistant_messages_conversation_id_admin_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."admin_assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_assistant_tool_runs" ADD CONSTRAINT "admin_assistant_tool_runs_conversation_id_admin_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."admin_assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_assistant_tool_runs" ADD CONSTRAINT "admin_assistant_tool_runs_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "admin_assistant_attachments_owner_idx" ON "admin_assistant_attachments" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_assistant_attachments_expiry_idx" ON "admin_assistant_attachments" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "admin_assistant_confirmations_owner_status_idx" ON "admin_assistant_confirmations" USING btree ("admin_user_id","status");--> statement-breakpoint
CREATE INDEX "admin_assistant_confirmations_conversation_idx" ON "admin_assistant_confirmations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "admin_assistant_conversations_owner_idx" ON "admin_assistant_conversations" USING btree ("admin_user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_assistant_messages_conversation_message_uidx" ON "admin_assistant_messages" USING btree ("conversation_id","message_id");--> statement-breakpoint
CREATE INDEX "admin_assistant_messages_conversation_created_idx" ON "admin_assistant_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_assistant_tool_runs_conversation_idx" ON "admin_assistant_tool_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "admin_assistant_tool_runs_owner_created_idx" ON "admin_assistant_tool_runs" USING btree ("admin_user_id","created_at");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merged_into_product_id_products_id_fk" FOREIGN KEY ("merged_into_product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "products_merged_into_idx" ON "products" USING btree ("merged_into_product_id");--> statement-breakpoint
ALTER TABLE "public"."admin_assistant_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."admin_assistant_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."admin_assistant_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."admin_assistant_tool_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."admin_assistant_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
