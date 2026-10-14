-- Restores the previous store WhatsApp number (+972592941591). Only acts if the new number is current.

begin;

do $$
begin
  if (select value #>> '{}' from store_settings where key = 'store_whatsapp_e164') is distinct from '+972599105456' then
    raise exception 'store_whatsapp_e164 is not the new number; nothing changed';
  end if;
end $$;

insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
select updated_by, 'settings_update', 'store_settings', 'store_whatsapp_e164',
  jsonb_build_object('value', '+972599105456'),
  jsonb_build_object('value', '+972592941591')
from store_settings
where key = 'store_whatsapp_e164';

update store_settings
set value = to_jsonb('+972592941591'::text), updated_at = now()
where key = 'store_whatsapp_e164' and value #>> '{}' = '+972599105456';

select key, value #>> '{}' as value, updated_by, updated_at from store_settings where key = 'store_whatsapp_e164';

commit;
