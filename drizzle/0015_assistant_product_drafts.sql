CREATE TABLE "admin_assistant_product_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"confirmation_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_assistant_product_drafts_status" CHECK ("admin_assistant_product_drafts"."status" IN ('open', 'submitted', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "admin_assistant_product_drafts" ADD CONSTRAINT "admin_assistant_product_drafts_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_assistant_product_drafts" ADD CONSTRAINT "admin_assistant_product_drafts_conversation_id_admin_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."admin_assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_assistant_product_drafts_owner_idx" ON "admin_assistant_product_drafts" USING btree ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_assistant_product_drafts_open_uidx" ON "admin_assistant_product_drafts" USING btree ("conversation_id") WHERE "admin_assistant_product_drafts"."status" = 'open';--> statement-breakpoint
ALTER TABLE "public"."admin_assistant_product_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
