import { hashPassword } from "../../src/features/admin/auth/password";

import { admin, withTestDb } from "./support";

export const E2E_OPERATOR = {
  username: "e2e-operator",
  password: "Operator-e2e-pass-2026",
};

/** Lets a spec sign in as the operator whichever specs ran before it. */
export async function ensureOperator() {
  const passwordHash = await hashPassword(E2E_OPERATOR.password);
  await withTestDb(
    (sql) => sql`
      insert into admin_users (username, display_name, password_hash, role)
      values (${E2E_OPERATOR.username}, 'موظفة الاختبار', ${passwordHash}, 'operator')
      on conflict (username) do nothing
    `,
  );
}

/** Adds only what is missing, so records from earlier specs stay the ones under test. */
export async function ensureRecordOfEachKind() {
  await withTestDb(async (sql) => {
    await sql`
      insert into customers (name, normalized_name)
      select 'زبون الفحص', 'زبون الفحص'
      where not exists (select 1 from customers)`;
    await sql`
      insert into suppliers (name_ar, normalized_name)
      select 'مورد الفحص', 'مورد الفحص'
      where not exists (select 1 from suppliers)`;
    await sql`
      insert into offers (name_ar, kind, value)
      select 'عرض الفحص', 'percentage', 10
      where not exists (select 1 from offers)`;
    await sql`
      insert into purchase_invoices (supplier_id, invoice_date, source, subtotal_agorot, total_agorot, payment_status, idempotency_key, created_by)
      select (select id from suppliers order by created_at limit 1), current_date, 'manual', 1000, 1000, 'unpaid', gen_random_uuid(),
        (select id from admin_users where username = ${admin.TEST_ADMIN_USERNAME})
      where not exists (select 1 from purchase_invoices)`;
    await sql`
      insert into customer_invoices (invoice_number, source, subtotal_agorot, total_agorot, paid_at_sale_agorot, cogs_agorot, cost_complete, idempotency_key, created_by)
      select 900001, 'manual', 1000, 1000, 1000, 0, false, gen_random_uuid(),
        (select id from admin_users where username = ${admin.TEST_ADMIN_USERNAME})
      where not exists (select 1 from customer_invoices)`;
    await sql`
      insert into orders (public_reference, customer_name, normalized_phone, service_area_id, service_area_code_snapshot, service_area_name_snapshot, items_subtotal_agorot, idempotency_key, request_fingerprint)
      select 'MS-e2eFixtureOrderRef000000', 'زبون الفحص', '+970599000000', area.id, area.code, area.name_ar, 1000, gen_random_uuid(), 'e2e-fixture'
      from service_areas area
      where not exists (select 1 from orders)
      limit 1`;
    await sql`
      insert into inventory_items (variant_id, location_id)
      select v.id, (select id from inventory_locations limit 1) from product_variants v
      where not exists (select 1 from inventory_items)
      limit 1`;
  });
}
