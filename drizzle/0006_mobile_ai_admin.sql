ALTER TYPE "public"."admin_role" ADD VALUE IF NOT EXISTS 'operator';--> statement-breakpoint

CREATE TABLE "admin_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" varchar(40) NOT NULL,
  "order_id" uuid,
  "title" varchar(120) NOT NULL,
  "body" varchar(240) NOT NULL,
  "href" varchar(300) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "admin_notification_reads" (
  "notification_id" uuid NOT NULL,
  "admin_user_id" uuid NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_notification_reads_notification_id_admin_user_id_pk"
    PRIMARY KEY("notification_id", "admin_user_id")
);--> statement-breakpoint

CREATE TABLE "admin_push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid NOT NULL,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" varchar(180) NOT NULL,
  "auth" varchar(80) NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "admin_notifications"
  ADD CONSTRAINT "admin_notifications_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_notification_reads"
  ADD CONSTRAINT "admin_notification_reads_notification_id_admin_notifications_id_fk"
  FOREIGN KEY ("notification_id") REFERENCES "public"."admin_notifications"("id")
  ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "admin_notification_reads"
  ADD CONSTRAINT "admin_notification_reads_admin_user_id_admin_users_id_fk"
  FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id")
  ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "admin_push_subscriptions"
  ADD CONSTRAINT "admin_push_subscriptions_admin_user_id_admin_users_id_fk"
  FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id")
  ON DELETE cascade;--> statement-breakpoint

CREATE INDEX "admin_notifications_created_at_idx"
  ON "admin_notifications" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_notifications_order_type_uidx"
  ON "admin_notifications" ("order_id", "type")
  WHERE "order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "admin_notification_reads_user_idx"
  ON "admin_notification_reads" ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_push_subscriptions_user_idx"
  ON "admin_push_subscriptions" ("admin_user_id");--> statement-breakpoint

ALTER TABLE "admin_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_notification_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_push_subscriptions" ENABLE ROW LEVEL SECURITY;
