-- One-time Production maintenance: the ten-category structure, every active product's category and
-- an alert threshold of 2 pieces on every active tracked variant. Idempotent and all-or-nothing:
-- any unexpected count raises and the whole block rolls back. Run once in the Supabase SQL editor.
do $$
declare
  owner_id uuid;
  mapping jsonb := '{
    "product-2a3cc6a2": "home-cleaners", "product-d04a9226": "home-cleaners",
    "product-e821a1b7": "home-cleaners", "product-31f3386e": "home-cleaners",
    "product-46ef798d": "home-cleaners", "product-a718315e": "home-cleaners",
    "product-41da5f9f": "home-cleaners", "product-fe740ccb": "home-cleaners",
    "product-d21fa319": "home-cleaners", "product-41e3945b": "home-cleaners",
    "product-4cfec15c": "home-cleaners", "product-e15f14e4": "home-cleaners",
    "product-1e69332e": "home-cleaners",
    "product-d5e66a93": "kitchen-dishwashing", "product-e1892fc4": "kitchen-dishwashing",
    "product-99b35653": "kitchen-dishwashing", "product-6b02b51b": "kitchen-dishwashing",
    "product-f778de2d": "kitchen-dishwashing", "product-3267f5b3": "kitchen-dishwashing",
    "product-988d5ee6": "kitchen-dishwashing", "product-eca2b842": "kitchen-dishwashing",
    "product-444bf736": "kitchen-dishwashing", "product-13b6f6f9": "kitchen-dishwashing",
    "product-80992d05": "kitchen-dishwashing",
    "product-bd3c4054": "laundry", "product-6dad7413": "laundry",
    "product-c10cdc76": "laundry", "product-5200e597": "laundry",
    "product-58d32a34": "bathroom",
    "product-d22b54e7": "carpet-upholstery", "product-d35ed5dc": "carpet-upholstery",
    "product-d48ded64": "carpet-upholstery",
    "product-a7e3e478": "home-fragrances", "product-d7445596": "home-fragrances",
    "product-bb6c0cac": "home-fragrances", "product-2c66bfac": "home-fragrances",
    "product-9e772fcc": "cleaning-tools", "product-be821a9e": "cleaning-tools",
    "product-2422969b": "cleaning-tools", "product-41389310": "cleaning-tools",
    "product-a081ca1d": "cleaning-tools",
    "product-753b43ea": "paper-tissues", "product-51f2c238": "paper-tissues",
    "product-5c0ffd8a": "paper-tissues", "product-581a068b": "paper-tissues",
    "product-939384b6": "paper-tissues",
    "product-3e7d6c59": "personal-care", "product-105b4810": "personal-care",
    "product-430934a3": "personal-care", "product-1e4f90e3": "personal-care",
    "product-407fce22": "personal-care", "product-6815ef38": "personal-care",
    "product-1ecdabec": "personal-care", "product-213e6fa9": "personal-care",
    "product-da96902b": "personal-care", "product-2e2f96c6": "personal-care",
    "product-41eec16d": "personal-care",
    "product-f9480186": "baby-care", "product-45f90fa1": "baby-care",
    "product-490b7203": "baby-care"
  }'::jsonb;
  categories jsonb := '[
    {"code": "home-cleaners", "name": "منظفات المنزل", "icon": "sparkles"},
    {"code": "kitchen-dishwashing", "name": "المطبخ والجلي", "icon": "cooking-pot"},
    {"code": "laundry", "name": "الغسيل", "icon": "shirt"},
    {"code": "bathroom", "name": "الحمام", "icon": "bath"},
    {"code": "carpet-upholstery", "name": "السجاد والمفروشات", "icon": "sofa"},
    {"code": "home-fragrances", "name": "معطرات المنزل", "icon": "wind"},
    {"code": "cleaning-tools", "name": "أدوات التنظيف", "icon": "brush-cleaning"},
    {"code": "paper-tissues", "name": "الورقيات والمناديل", "icon": "scroll-text"},
    {"code": "personal-care", "name": "العناية الشخصية", "icon": "heart"},
    {"code": "baby-care", "name": "الأطفال", "icon": "baby"}
  ]'::jsonb;
  missing text;
  unknown text;
  moved int;
  archived int;
  eligible int;
  already int;
  changed int;
begin
  select id into owner_id from admin_users where role = 'owner' order by created_at limit 1;
  if owner_id is null then raise exception 'no owner account'; end if;

  -- Every active product must be in the mapping exactly once, and every mapped id must exist.
  select string_agg(domain_id, ', ') into missing from products
    where archived_at is null and not mapping ? domain_id;
  if missing is not null then raise exception 'active products missing from mapping: %', missing; end if;
  select string_agg(key, ', ') into unknown from jsonb_object_keys(mapping) as key
    where not exists (select 1 from products p where p.domain_id = key and p.archived_at is null);
  if unknown is not null then raise exception 'mapped ids not active: %', unknown; end if;

  -- Old categories whose names would clash are archived first; products still point at them until moved.
  update product_categories c set archived_at = now(), updated_at = now()
    where c.archived_at is null
      and not exists (select 1 from jsonb_array_elements(categories) n where n->>'code' = c.code);
  get diagnostics archived = row_count;

  insert into product_categories (code, name_ar, icon, sort_order, visible)
    select item->>'code', item->>'name', item->>'icon', (position * 10)::int, true
    from jsonb_array_elements(categories) with ordinality as n(item, position)
  on conflict (code) do update set
    name_ar = excluded.name_ar, icon = excluded.icon, sort_order = excluded.sort_order,
    visible = true, archived_at = null, merged_into_code = null, updated_at = now();

  update products p set category_id = mapping->>p.domain_id, updated_at = now()
    where p.archived_at is null and p.category_id is distinct from mapping->>p.domain_id;
  get diagnostics moved = row_count;

  if exists (select 1 from products p join product_categories c on c.code = p.category_id
             where p.archived_at is null and c.archived_at is not null)
    then raise exception 'an active product still points at an archived category'; end if;
  if (select count(*) from product_categories where archived_at is null) <> 10
    then raise exception 'expected exactly 10 active categories'; end if;

  -- Thresholds: every tracked variant of an active product warns at 2 pieces.
  select count(*), count(*) filter (where i.reorder_threshold_milli = 2000)
    into eligible, already
    from inventory_items i
    join product_variants v on v.id = i.variant_id
    join products p on p.id = v.product_id
    where v.archived_at is null and p.archived_at is null;
  update inventory_items i set reorder_threshold_milli = 2000, updated_at = now()
    from product_variants v join products p on p.id = v.product_id
    where v.id = i.variant_id and v.archived_at is null and p.archived_at is null
      and i.reorder_threshold_milli is distinct from 2000;
  get diagnostics changed = row_count;
  if exists (select 1 from inventory_items i join product_variants v on v.id = i.variant_id
             join products p on p.id = v.product_id
             where v.archived_at is null and p.archived_at is null
               and i.reorder_threshold_milli is distinct from 2000)
    then raise exception 'a threshold was not set'; end if;

  insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
  values
    (owner_id, 'catalog_restructure', 'product_category', 'all',
     jsonb_build_object('archivedCategories', archived),
     jsonb_build_object('activeCategories', 10, 'productsMoved', moved)),
    (owner_id, 'reorder_threshold_bulk_update', 'inventory_item', 'active',
     jsonb_build_object('eligible', eligible, 'alreadyTwo', already),
     jsonb_build_object('reorderThresholdMilli', 2000, 'changed', changed));

  raise notice 'categories archived: %, products moved: %, tracked variants: %, already 2: %, changed: %',
    archived, moved, eligible, already, changed;
end $$;
