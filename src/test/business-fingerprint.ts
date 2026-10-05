import type postgres from "postgres";

export const BUSINESS_TABLES = [
  "products",
  "product_variants",
  "product_categories",
  "product_specifications",
  "inventory_items",
  "stock_movements",
  "offers",
  "offer_targets",
  "customers",
  "customer_aliases",
  "customer_ledger_entries",
  "customer_payments",
  "customer_invoices",
  "suppliers",
  "supplier_aliases",
  "supplier_ledger_entries",
  "purchase_invoices",
  "orders",
  "order_items",
  "order_status_history",
  "product_images",
  "product_options",
  "product_option_values",
  "product_variant_option_values",
] as const;

// One hash per business table; preparing a card must leave every hash unchanged.
export async function businessFingerprint(
  client: postgres.Sql,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of BUSINESS_TABLES) {
    const exists = await client.unsafe(
      `select to_regclass('public.${table}') is not null as ok`,
    );
    if (!exists[0]?.ok) continue;
    const [row] = await client.unsafe(
      `select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as hash from "${table}" t`,
    );
    result[table] = String(row?.hash);
  }
  return result;
}

export function changedTables(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  return Object.keys({ ...before, ...after }).filter(
    (table) => before[table] !== after[table],
  );
}
