ALTER TABLE "public"."product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."product_specifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
