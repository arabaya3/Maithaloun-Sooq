CREATE INDEX "admin_audit_events_admin_user_id_idx"
  ON "public"."admin_audit_events" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "order_items_product_domain_id_idx"
  ON "public"."order_items" USING btree ("product_domain_id");--> statement-breakpoint
CREATE INDEX "order_status_history_admin_user_id_idx"
  ON "public"."order_status_history" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "orders_service_area_id_idx"
  ON "public"."orders" USING btree ("service_area_id");
