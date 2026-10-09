ALTER TYPE "public"."order_status" ADD VALUE 'awaiting_whatsapp' BEFORE 'confirmed';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_channel" varchar(16) DEFAULT 'web' NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_order_mutation_rules"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders cannot be deleted';
  END IF;

  IF NEW.public_reference IS DISTINCT FROM OLD.public_reference
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.normalized_phone IS DISTINCT FROM OLD.normalized_phone
     OR NEW.service_area_id IS DISTINCT FROM OLD.service_area_id
     OR NEW.service_area_code_snapshot IS DISTINCT FROM OLD.service_area_code_snapshot
     OR NEW.service_area_name_snapshot IS DISTINCT FROM OLD.service_area_name_snapshot
     OR NEW.address IS DISTINCT FROM OLD.address
     OR NEW.landmark IS DISTINCT FROM OLD.landmark
     OR NEW.customer_note IS DISTINCT FROM OLD.customer_note
     OR NEW.items_subtotal_agorot IS DISTINCT FROM OLD.items_subtotal_agorot
     OR NEW.delivery_fee_agorot IS DISTINCT FROM OLD.delivery_fee_agorot
     OR NEW.final_total_agorot IS DISTINCT FROM OLD.final_total_agorot
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.checkout_channel IS DISTINCT FROM OLD.checkout_channel
  THEN
    RAISE EXCEPTION 'order snapshots are immutable';
  END IF;

  IF NEW.status::text IS DISTINCT FROM OLD.status::text THEN
    IF NOT (
      (OLD.status::text = 'pending' AND NEW.status::text IN ('confirmed', 'cancelled'))
      OR (OLD.status::text = 'awaiting_whatsapp' AND NEW.status::text IN ('confirmed', 'cancelled'))
      OR (OLD.status::text = 'confirmed' AND NEW.status::text IN ('preparing', 'cancelled'))
      OR (OLD.status::text = 'preparing' AND NEW.status::text IN ('out_for_delivery', 'cancelled'))
      OR (OLD.status::text = 'out_for_delivery' AND NEW.status::text IN ('delivered', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'invalid order status transition';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'order version must increment with status changes';
    END IF;
  ELSIF NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'order version cannot change without a status change';
  END IF;

  RETURN NEW;
END;
$$;
