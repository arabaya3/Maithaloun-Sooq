-- Changes the store's official WhatsApp number from +972592941591 to +972599105456.
-- Preferred path: Admin → Settings → store WhatsApp (same effect, audited automatically).
-- Use this script only if the admin page is unavailable. Run once, as one transaction.
-- store_settings.value is jsonb, so the number is compared and written as a JSON string.
-- It touches one row of store_settings and adds one audit event; nothing else.

begin;

-- Stops unless the current value is exactly the old number, so it never overwrites a newer change.
do $$
begin
  if (select value #>> '{}' from store_settings where key = 'store_whatsapp_e164') is distinct from '+972592941591' then
    raise exception 'store_whatsapp_e164 is not the old number; nothing changed';
  end if;
end $$;

-- Recorded against the admin who set the current number.
insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
select updated_by, 'settings_update', 'store_settings', 'store_whatsapp_e164',
  jsonb_build_object('value', '+972592941591'),
  jsonb_build_object('value', '+972599105456')
from store_settings
where key = 'store_whatsapp_e164';

update store_settings
set value = to_jsonb('+972599105456'::text), updated_at = now()
where key = 'store_whatsapp_e164' and value #>> '{}' = '+972592941591';

-- Expect exactly one row with the new number.
select key, value #>> '{}' as value, updated_by, updated_at from store_settings where key = 'store_whatsapp_e164';

commit;
