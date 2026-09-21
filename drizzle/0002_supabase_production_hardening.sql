ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."service_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."admin_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."order_status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."admin_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC, anon, authenticated;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public"
  REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public"
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public"
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;--> statement-breakpoint

ALTER FUNCTION "public"."enforce_order_mutation_rules"() SET search_path = '';--> statement-breakpoint
ALTER FUNCTION "public"."reject_append_only_mutation"() SET search_path = '';
