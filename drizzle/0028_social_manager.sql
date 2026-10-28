CREATE TABLE "social_catalog_seen" (
	"product_id" varchar(80) PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"baseline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_comments" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"author_name" varchar(120),
	"message" text NOT NULL,
	"commented_at" timestamp with time zone NOT NULL,
	"decision" varchar(12) NOT NULL,
	"reason" varchar(30),
	"reply_text" text,
	"reply_status" varchar(12) NOT NULL,
	"reply_meta_id" varchar(100),
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_comments_decision" CHECK ("social_comments"."decision" IN ('reply','escalate','none')),
	CONSTRAINT "social_comments_reply_status" CHECK ("social_comments"."reply_status" IN ('pending','sending','sent','failed','skipped','held'))
);
--> statement-breakpoint
CREATE TABLE "social_connections" (
	"provider" varchar(20) PRIMARY KEY NOT NULL,
	"page_id" varchar(40) NOT NULL,
	"page_name" varchar(160),
	"token_sealed" text NOT NULL,
	"token_hint" varchar(12) NOT NULL,
	"token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(16) NOT NULL,
	"last_checked_at" timestamp with time zone,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_connections_provider" CHECK ("social_connections"."provider" = 'facebook'),
	CONSTRAINT "social_connections_status" CHECK ("social_connections"."status" IN ('connected','expired','revoked'))
);
--> statement-breakpoint
CREATE TABLE "social_engagement" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"reactions" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"reach" integer,
	"views" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" varchar(30) NOT NULL,
	"status" varchar(10) NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" varchar(60),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "social_job_runs_status" CHECK ("social_job_runs"."status" IN ('running','ok','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "social_post_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"actor_id" uuid,
	"event" varchar(24) NOT NULL,
	"from_status" varchar(16),
	"to_status" varchar(16),
	"detail" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"format" varchar(8) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"reel_template" varchar(16),
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tip_id" varchar(40),
	"category_code" varchar(40),
	"caption" text NOT NULL,
	"caption_source" varchar(12) NOT NULL,
	"media_status" varchar(12) DEFAULT 'pending' NOT NULL,
	"media_url" varchar(600),
	"poster_url" varchar(600),
	"media_seconds" integer,
	"media_error" varchar(60),
	"scheduled_for" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" varchar(60),
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"publish_key" varchar(64),
	"meta_post_id" varchar(100),
	"meta_object_id" varchar(100),
	"meta_upload_id" varchar(100),
	"published_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_publish_key_unique" UNIQUE("publish_key"),
	CONSTRAINT "social_posts_meta_post_id_unique" UNIQUE("meta_post_id"),
	CONSTRAINT "social_posts_status" CHECK ("social_posts"."status" IN ('draft','approved','publishing','retry_wait','published','failed','rejected')),
	CONSTRAINT "social_posts_format" CHECK ("social_posts"."format" IN ('image','reel')),
	CONSTRAINT "social_posts_media_status" CHECK ("social_posts"."media_status" IN ('pending','ready','failed')),
	CONSTRAINT "social_posts_caption_source" CHECK ("social_posts"."caption_source" IN ('template','ai','owner')),
	CONSTRAINT "social_posts_approved_before_publish" CHECK ("social_posts"."status" IN ('draft','rejected') OR ("social_posts"."approved_by" IS NOT NULL AND "social_posts"."approved_at" IS NOT NULL AND "social_posts"."publish_key" IS NOT NULL)),
	CONSTRAINT "social_posts_published_has_id" CHECK ("social_posts"."status" <> 'published' OR "social_posts"."meta_object_id" IS NOT NULL),
	CONSTRAINT "social_posts_attempts" CHECK ("social_posts"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "social_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"auto_publish_approved" boolean DEFAULT true NOT NULL,
	"auto_reply_faq" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_settings_singleton" CHECK ("social_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_resolved_by_admin_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_connected_by_admin_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement" ADD CONSTRAINT "social_engagement_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_events" ADD CONSTRAINT "social_post_events_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_events" ADD CONSTRAINT "social_post_events_actor_id_admin_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_approved_by_admin_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_settings" ADD CONSTRAINT "social_settings_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_comments_open_idx" ON "social_comments" USING btree ("decision","resolved_at");--> statement-breakpoint
CREATE INDEX "social_comments_post_idx" ON "social_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_comments_resolved_by_idx" ON "social_comments" USING btree ("resolved_by");--> statement-breakpoint
CREATE INDEX "social_connections_connected_by_idx" ON "social_connections" USING btree ("connected_by");--> statement-breakpoint
CREATE INDEX "social_job_runs_job_idx" ON "social_job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "social_post_events_post_idx" ON "social_post_events" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "social_post_events_actor_idx" ON "social_post_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "social_posts_queue_idx" ON "social_posts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "social_posts_published_idx" ON "social_posts" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "social_posts_approved_by_idx" ON "social_posts" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "social_settings_updated_by_idx" ON "social_settings" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "social_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_post_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_catalog_seen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_job_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_engagement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_settings" ENABLE ROW LEVEL SECURITY;
