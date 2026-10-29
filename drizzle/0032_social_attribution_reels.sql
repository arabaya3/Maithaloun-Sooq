CREATE TABLE "social_campaign_visits" (
	"post_id" uuid NOT NULL,
	"day" varchar(10) NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "social_campaign_visits_post_id_day_pk" PRIMARY KEY("post_id","day"),
	CONSTRAINT "social_campaign_visits_positive" CHECK ("social_campaign_visits"."visits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "social_order_attributions" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_reel_renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept" varchar(40) NOT NULL,
	"seconds" integer NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storyboard" jsonb NOT NULL,
	"storyboard_key" varchar(64) NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"error_code" varchar(60),
	"video_url" varchar(600),
	"frame_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rendered_seconds" integer,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_reel_renders_storyboard_key_unique" UNIQUE("storyboard_key"),
	CONSTRAINT "social_reel_renders_status" CHECK ("social_reel_renders"."status" IN ('queued','rendering','ready','failed')),
	CONSTRAINT "social_reel_renders_attempts" CHECK ("social_reel_renders"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "social_campaign_visits" ADD CONSTRAINT "social_campaign_visits_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_order_attributions" ADD CONSTRAINT "social_order_attributions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_order_attributions" ADD CONSTRAINT "social_order_attributions_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reel_renders" ADD CONSTRAINT "social_reel_renders_requested_by_admin_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_order_attributions_post_idx" ON "social_order_attributions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_reel_renders_queue_idx" ON "social_reel_renders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "social_reel_renders_requested_by_idx" ON "social_reel_renders" USING btree ("requested_by");