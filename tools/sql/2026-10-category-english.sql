-- MAYTHA: English names for the ten storefront categories (shown on /en only).
-- Run once in the Supabase SQL editor AFTER migration 0026 (product_categories.name_en) is deployed.
-- Only empty English names are filled, so later edits in the admin are kept; safe to run again.
do $$
declare
  names jsonb := '{
    "home-cleaners": "Home Cleaners",
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
  filled integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'product_categories' and column_name = 'name_en'
  ) then
    raise exception 'product_categories.name_en does not exist yet: deploy migration 0026 first';
  end if;

  update product_categories c
  set name_en = names ->> c.code, updated_at = now()
  where c.name_en is null and names ? c.code and c.archived_at is null;
  get diagnostics filled = row_count;

  raise notice 'English category names filled: %, active categories still without one: %',
    filled,
    (select count(*) from product_categories where archived_at is null and name_en is null);
end $$;
