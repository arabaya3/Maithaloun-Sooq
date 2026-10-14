CREATE TABLE "shop_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_e164" varchar(20) NOT NULL,
	"customer_name" varchar(120),
	"delivery_note" varchar(300),
	"cart" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cart_version" integer DEFAULT 0 NOT NULL,
	"awaiting_confirmation_version" integer,
	"bot_paused" boolean DEFAULT false NOT NULL,
	"human_requested_at" timestamp with time zone,
	"last_order_id" uuid,
	"last_inbound_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_conversations_e164_format" CHECK ("shop_conversations"."customer_e164" ~ '^\+[1-9][0-9]{7,14}$' OR "shop_conversations"."is_test")
);
--> statement-breakpoint
CREATE TABLE "shop_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" varchar(8) NOT NULL,
	"author" varchar(12) NOT NULL,
	"body" text NOT NULL,
	"provider" varchar(24) NOT NULL,
	"provider_message_id" varchar(128),
	"delivery_status" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_messages_direction" CHECK ("shop_messages"."direction" IN ('in', 'out')),
	CONSTRAINT "shop_messages_author" CHECK ("shop_messages"."author" IN ('customer', 'assistant', 'owner', 'system'))
);
--> statement-breakpoint
ALTER TABLE "shop_conversations" ADD CONSTRAINT "shop_conversations_last_order_id_orders_id_fk" FOREIGN KEY ("last_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_messages" ADD CONSTRAINT "shop_messages_conversation_id_shop_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."shop_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_conversations_customer_e164_idx" ON "shop_conversations" USING btree ("customer_e164");--> statement-breakpoint
CREATE INDEX "shop_conversations_last_order_idx" ON "shop_conversations" USING btree ("last_order_id");--> statement-breakpoint
CREATE INDEX "shop_messages_conversation_idx" ON "shop_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_messages_provider_message_idx" ON "shop_messages" USING btree ("provider","provider_message_id") WHERE "shop_messages"."provider_message_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "shop_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shop_messages" ENABLE ROW LEVEL SECURITY;
