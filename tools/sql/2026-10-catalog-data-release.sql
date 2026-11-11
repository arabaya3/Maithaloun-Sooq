-- MAYTHA catalog data release (owner-approved 2026-10-13). Replaces the earlier brand and
-- category-English scripts. Run once in the Supabase SQL editor; the whole block is one transaction.
--
-- It changes only:
--   1. products.brand for the 51 approved product ids below (only where brand is still empty);
--   2. product_categories.name_en for the 10 active categories (only where still empty);
--   3. products.category_id of product-c7f96934 (علاء الدين tissues): cleaning-tools -> paper-tissues.
-- Prices, stock, orders, images, Arabic names, slugs and everything else stay untouched.
-- Every changed row gets an admin_audit_events entry holding its previous and new value.
--
-- Safety:
--   - Before writing, it checks that every row is still exactly as in the dry run; if anything
--     differs it stops and changes nothing.
--   - Running it again after success changes nothing (it reports "already applied").
--   - Targeted rollback: tools/sql/2026-10-catalog-data-release-rollback.sql.
--
-- Left empty on purpose (owner decision): منى / سليمة (product-51f2c238), سمارت (product-e821a1b7),
-- ليلاك (product-31f3386e), مسك, ريجا, جيانبينغ, أبيلوندو and the unbranded tools.
do $$
declare
  brands constant jsonb := '{
    "product-41e3945b": "ALBORKAN",
    "product-490b7203": "ALBORKAN",
    "product-d22b54e7": "ALBORKAN",
    "product-d48ded64": "ALBORKAN",
    "product-41da5f9f": "ALBORKAN",
    "product-46ef798d": "ALBORKAN",
    "product-4cfec15c": "ALBORKAN",
    "product-a718315e": "ALBORKAN",
    "product-d21fa319": "ALBORKAN",
    "product-e15f14e4": "ALBORKAN",
    "product-2c66bfac": "ALBORKAN",
    "product-bb6c0cac": "ALBORKAN",
    "product-6dad7413": "ALBORKAN",
    "product-c10cdc76": "ALBORKAN",
    "product-45f90fa1": "Pampers",
    "product-f9480186": "Johnson''s",
    "product-58d32a34": "BON",
    "product-41389310": "SWIPE",
    "product-be821a9e": "Sofia Clean",
    "product-c7f96934": "علاء الدين",
    "product-1e69332e": "Home Secret",
    "product-2a3cc6a2": "Dolphin",
    "product-fe740ccb": "LOYAL",
    "product-a7e3e478": "LOYAL",
    "product-5200e597": "LOYAL",
    "product-d7445596": "لميس",
    "product-0b7d25ea": "Finish",
    "product-99b35653": "Finish",
    "product-d5e66a93": "Finish",
    "product-e1892fc4": "Finish",
    "product-13b6f6f9": "Infinio",
    "product-939384b6": "Infinio",
    "product-3267f5b3": "Arar",
    "product-988d5ee6": "Arar",
    "product-1ecdabec": "Arar",
    "product-80992d05": "OXY PLUS",
    "product-41eec16d": "OXY PLUS",
    "product-eca2b842": "Venecia",
    "product-bd3c4054": "Ariel",
    "product-581a068b": "Soft Clean",
    "product-5c0ffd8a": "Al Sultan",
    "product-105b4810": "SUN SHINE",
    "product-1e4f90e3": "Clear",
    "product-407fce22": "Clear",
    "product-213e6fa9": "Hawaii",
    "product-2e2f96c6": "Signal",
    "product-3e7d6c59": "AXE",
    "product-430934a3": "Sunsilk",
    "product-4ecda90f": "Head & Shoulders",
    "product-6815ef38": "بينوك",
    "product-da96902b": "Dove"
  }'::jsonb;
  english constant jsonb := '{
    "home-cleaners": "Household Cleaners",
    "kitchen-dishwashing": "Kitchen & Dishwashing",
    "laundry": "Laundry",
    "bathroom": "Bathroom",
    "carpet-upholstery": "Carpets & Upholstery",
    "home-fragrances": "Home Fragrances",
    "cleaning-tools": "Cleaning Tools",
    "paper-tissues": "Paper & Tissues",
    "personal-care": "Personal Care",
    "baby-care": "Baby Care"
  }'::jsonb;
  aladdin constant text := 'product-c7f96934';
  brand_total integer := (select count(*) from jsonb_object_keys(brands));
  english_total integer := (select count(*) from jsonb_object_keys(english));
  owner_id uuid;
  brand_pending integer;
  brand_done integer;
  english_pending integer;
  english_done integer;
  move_pending boolean;
  move_done boolean;
  changed integer;
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'products' and column_name = 'brand')
          or (table_name = 'product_categories' and column_name = 'name_en'))) <> 2 then
    raise exception 'migrations 0025 and 0026 must be deployed first';
  end if;

  select id into owner_id from admin_users where role = 'owner' order by created_at limit 1;
  if owner_id is null then raise exception 'no owner account to record the change'; end if;

  select count(*) filter (where p.brand is null),
         count(*) filter (where p.brand = brands ->> p.domain_id)
    into brand_pending, brand_done
    from products p
    where p.domain_id in (select jsonb_object_keys(brands)) and p.archived_at is null;
  select count(*) filter (where c.name_en is null),
         count(*) filter (where c.name_en = english ->> c.code)
    into english_pending, english_done
    from product_categories c
    where c.code in (select jsonb_object_keys(english)) and c.archived_at is null;
  select exists (select 1 from products where domain_id = aladdin and archived_at is null
                   and category_id = 'cleaning-tools' and name_ar like '%علاء الدين%'),
         exists (select 1 from products where domain_id = aladdin and archived_at is null
                   and category_id = 'paper-tissues')
    into move_pending, move_done;

  if brand_done = brand_total and english_done = english_total and move_done then
    raise notice 'already applied: nothing changed';
    return;
  end if;
  if brand_pending <> brand_total or english_pending <> english_total or not move_pending
     or not exists (select 1 from product_categories where code = 'paper-tissues' and archived_at is null) then
    raise exception
      'state differs from the approved dry run (brands pending %/%, english pending %/%, move pending %); nothing changed',
      brand_pending, brand_total, english_pending, english_total, move_pending;
  end if;

  -- 1. Brands, recorded with their previous value.
  insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
    select owner_id, 'product_update', 'product', p.domain_id,
           jsonb_build_object('brand', p.brand),
           jsonb_build_object('brand', brands ->> p.domain_id, 'release', 'catalog-data-2026-10-13')
    from products p
    where p.domain_id in (select jsonb_object_keys(brands)) and p.archived_at is null and p.brand is null;
  update products p set brand = brands ->> p.domain_id, updated_at = now()
    where p.domain_id in (select jsonb_object_keys(brands)) and p.archived_at is null and p.brand is null;
  get diagnostics changed = row_count;
  if changed <> brand_total then raise exception 'brands: expected %, changed %', brand_total, changed; end if;

  -- 2. English category names.
  insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
    select owner_id, 'category_update', 'product_category', c.code,
           jsonb_build_object('nameEn', c.name_en),
           jsonb_build_object('nameEn', english ->> c.code, 'release', 'catalog-data-2026-10-13')
    from product_categories c
    where c.code in (select jsonb_object_keys(english)) and c.archived_at is null and c.name_en is null;
  update product_categories c set name_en = english ->> c.code, updated_at = now()
    where c.code in (select jsonb_object_keys(english)) and c.archived_at is null and c.name_en is null;
  get diagnostics changed = row_count;
  if changed <> english_total then raise exception 'english names: expected %, changed %', english_total, changed; end if;

  -- 3. علاء الدين tissues to Paper & Tissues.
  insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
    values (owner_id, 'product_update', 'product', aladdin,
            jsonb_build_object('categoryId', 'cleaning-tools'),
            jsonb_build_object('categoryId', 'paper-tissues', 'release', 'catalog-data-2026-10-13'));
  update products set category_id = 'paper-tissues', updated_at = now()
    where domain_id = aladdin and category_id = 'cleaning-tools' and archived_at is null;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'category move: expected 1, changed %', changed; end if;

  raise notice 'applied: % brands, % English category names, 1 product moved to paper-tissues',
    brand_total, english_total;
end $$;
