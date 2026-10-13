-- MAYTHA: fills products.brand from the brand already written in each product's own name.
-- Run once in the Supabase SQL editor AFTER migration 0025 (products.brand) is deployed.
-- Only empty brands are filled, so anything the owner already set is kept; safe to run again.
-- Not mapped on purpose (brand unclear from the name; set them in the product editor if wanted):
--   product-17dd1f62 مكنسة سوبر جامبو, product-2422969b عصا خشبية, product-9e772fcc طقم أدوات,
--   product-a081ca1d مسّاحة مطاطية, product-d35ed5dc فرشاة سجاد, product-753b43ea دلو مناديل,
--   product-d04a9226 منظف مسك, product-444bf736 ليف جيانبينغ, product-6b02b51b أكياس أبيلوندو,
--   product-f778de2d إسفنج ريجا.
--
-- Expected on Production (checked read-only 2026-10-13): 54 rows filled, 10 active products left empty.
-- It writes products.brand and updated_at only: no prices, stock, orders, images or names change.
--
-- Before running, save the current values (read-only; keep the result):
--   select domain_id, brand from products where archived_at is null order by domain_id;
-- Rollback right after the run, before any brand is edited in the admin (empty was the previous state):
--   update products set brand = null where brand is not null;
do $$
declare
  mapping jsonb := '{
    "product-41e3945b": "ALBORKAN",
    "product-45f90fa1": "Pampers",
    "product-f9480186": "Johnson''s",
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
    "product-58d32a34": "BON",
    "product-41389310": "SWIPE",
    "product-be821a9e": "Sofia Clean",
    "product-c7f96934": "علاء الدين",
    "product-1e69332e": "Home Secret",
    "product-2a3cc6a2": "Dolphin",
    "product-31f3386e": "ليلاك",
    "product-e821a1b7": "سمارت",
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
    "product-51f2c238": "منى",
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
  missing text;
  filled integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'products' and column_name = 'brand'
  ) then
    raise exception 'products.brand does not exist yet: deploy migration 0025 first';
  end if;

  select string_agg(key, ', ') into missing
  from jsonb_object_keys(mapping) as key
  where not exists (select 1 from products p where p.domain_id = key);
  if missing is not null then
    raise exception 'mapped products not found: %', missing;
  end if;

  update products p
  set brand = mapping ->> p.domain_id, updated_at = now()
  where p.brand is null and mapping ? p.domain_id;
  get diagnostics filled = row_count;

  raise notice 'brands filled: %, products still without a brand: %',
    filled,
    (select count(*) from products where archived_at is null and brand is null);
end $$;
