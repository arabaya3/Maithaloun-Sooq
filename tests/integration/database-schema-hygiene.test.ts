import { beforeAll, describe, expect, it } from "vitest";

import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { client } = testDatabaseConnection;

beforeAll(async () => {
  await resetTestDatabase();
});

// Local stand-in for the Supabase security and performance advisors.
describe("schema hygiene", () => {
  it("enables row level security on every public table", async () => {
    const rows = await client<{ name: string }[]>`
      select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1
    `;
    expect(rows.map((row) => row.name)).toEqual([]);
  });

  it("grants nothing on public tables to the public API roles", async () => {
    const rows = await client<{ grantee: string; table_name: string }[]>`
      select grantee, table_name
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
    `;
    expect(rows).toEqual([]);
  });

  it("covers every foreign key with an index", async () => {
    const rows = await client<{ name: string }[]>`
      select c.conrelid::regclass::text || '.' || c.conname as name
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'f'
        and n.nspname = 'public'
        and not exists (
          select 1
          from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
        )
      order by 1
    `;
    expect(rows.map((row) => row.name)).toEqual([]);
  });

  it("keeps the financial ledgers append-only", async () => {
    const rows = await client<{ name: string }[]>`
      select t.name
      from unnest(array[
        'stock_movements',
        'customer_ledger_entries',
        'supplier_ledger_entries',
        'customer_payments',
        'admin_audit_events'
      ]) as t(name)
      where not exists (
        select 1
        from pg_trigger g
        join pg_proc p on p.oid = g.tgfoid
        where g.tgrelid = ('public.' || t.name)::regclass
          and p.proname = 'reject_append_only_mutation'
      )
    `;
    expect(rows.map((row) => row.name)).toEqual([]);
  });
});
