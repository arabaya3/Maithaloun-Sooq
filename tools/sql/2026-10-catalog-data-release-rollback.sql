-- Targeted rollback for 2026-10-catalog-data-release.sql. Restores only the rows that release
-- changed, and only while they still hold the value it wrote; anything edited since is left alone
-- and reported. One transaction; every restored row gets an admin_audit_events entry.
do $$
declare
  owner_id uuid;
  brands_restored integer;
  english_restored integer;
  moved_back integer;
begin
  select id into owner_id from admin_users where role = 'owner' order by created_at limit 1;
  if owner_id is null then raise exception 'no owner account to record the change'; end if;

  -- The release's own audit rows say exactly which rows changed and what they held before.
  create temporary table release_changes on commit drop as
    select entity_type, entity_id, before_state, after_state
    from admin_audit_events
    where after_state ->> 'release' = 'catalog-data-2026-10-13';
  if not exists (select 1 from release_changes) then
    raise notice 'nothing to roll back: the release was not applied';
    return;
  end if;

  insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
    select owner_id, 'product_update', 'product', p.domain_id,
           jsonb_build_object('brand', p.brand),
           jsonb_build_object('brand', r.before_state ->> 'brand', 'rollback', 'catalog-data-2026-10-13')
    from products p join release_changes r on r.entity_type = 'product' and r.entity_id = p.domain_id
    where r.after_state ? 'brand' and p.brand = r.after_state ->> 'brand';
  update products p set brand = r.before_state ->> 'brand', updated_at = now()
    from release_changes r
    where r.entity_type = 'product' and r.entity_id = p.domain_id
      and r.after_state ? 'brand' and p.brand = r.after_state ->> 'brand';
  get diagnostics brands_restored = row_count;

  insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
    select owner_id, 'category_update', 'product_category', c.code,
           jsonb_build_object('nameEn', c.name_en),
           jsonb_build_object('nameEn', r.before_state ->> 'nameEn', 'rollback', 'catalog-data-2026-10-13')
    from product_categories c join release_changes r on r.entity_type = 'product_category' and r.entity_id = c.code
    where c.name_en = r.after_state ->> 'nameEn';
  update product_categories c set name_en = r.before_state ->> 'nameEn', updated_at = now()
    from release_changes r
    where r.entity_type = 'product_category' and r.entity_id = c.code
      and c.name_en = r.after_state ->> 'nameEn';
  get diagnostics english_restored = row_count;

  insert into admin_audit_events (admin_user_id, action_type, entity_type, entity_id, before_state, after_state)
    select owner_id, 'product_update', 'product', p.domain_id,
           jsonb_build_object('categoryId', p.category_id),
           jsonb_build_object('categoryId', r.before_state ->> 'categoryId', 'rollback', 'catalog-data-2026-10-13')
    from products p join release_changes r on r.entity_type = 'product' and r.entity_id = p.domain_id
    where r.after_state ? 'categoryId' and p.category_id = r.after_state ->> 'categoryId';
  update products p set category_id = r.before_state ->> 'categoryId', updated_at = now()
    from release_changes r
    where r.entity_type = 'product' and r.entity_id = p.domain_id
      and r.after_state ? 'categoryId' and p.category_id = r.after_state ->> 'categoryId';
  get diagnostics moved_back = row_count;

  raise notice 'rolled back: % brands, % English category names, % product category; rows edited since were kept',
    brands_restored, english_restored, moved_back;
end $$;
