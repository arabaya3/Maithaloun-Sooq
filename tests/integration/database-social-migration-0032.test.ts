import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { client } = testDatabaseConnection;

const TABLES = [
  "social_campaign_visits",
  "social_order_attributions",
  "social_reel_renders",
] as const;

beforeAll(async () => {
  await resetTestDatabase();
});

/** Rolls back whatever the block did, grants included. */
async function rolledBack(block: (sql: typeof client) => Promise<void>) {
  await client
    .begin(async (sql) => {
      await block(sql as unknown as typeof client);
      throw new Error("ROLLBACK");
    })
    .catch((error: Error) => {
      if (error.message !== "ROLLBACK") throw error;
    });
}

// Migration 0032: campaign visits, order attributions and Reel renders.
describe("migration 0032 access", () => {
  it("keeps row level security on, with no policy that opens a row to anyone", async () => {
    const rows = await client<
      { name: string; rls: boolean; forced: boolean }[]
    >`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(${TABLES as unknown as string[]})
      order by 1`;
    expect(rows.map((row) => [row.name, row.rls])).toEqual(
      TABLES.map((name) => [name, true]),
    );
    const policies = await client`
      select tablename from pg_policies
      where schemaname = 'public' and tablename = any(${TABLES as unknown as string[]})`;
    expect(policies).toEqual([]);
  });

  for (const role of ["anon", "authenticated"] as const) {
    it(`gives ${role} nothing, even if a default grant lets it reach the tables`, async () => {
      await client`insert into social_reel_renders (concept, seconds, storyboard, storyboard_key)
        values ('meet-meetho', 10, '{}', ${"k".repeat(64)})
        on conflict do nothing`;
      // Without a grant, the API role cannot even name the tables.
      for (const table of TABLES) {
        await rolledBack(async (sql) => {
          await sql.unsafe(`set local role ${role}`);
          await expect(sql.unsafe(`select * from ${table}`)).rejects.toThrow(
            /permission denied|does not exist/,
          );
        });
      }
      // Supabase may grant new public tables to the API roles by default: row level security
      // with no policy still shows no row and accepts no write.
      for (const table of TABLES) {
        await rolledBack(async (sql) => {
          await sql.unsafe(`grant usage on schema public to ${role}`);
          await sql.unsafe(
            `grant select, insert, update, delete on ${table} to ${role}`,
          );
          await sql.unsafe(`set local role ${role}`);
          expect(await sql.unsafe(`select * from ${table}`)).toHaveLength(0);
          expect(
            await sql.unsafe(
              `update ${table} set ${table === "social_reel_renders" ? "attempts = 0" : table === "social_campaign_visits" ? "visits = 0" : "created_at = now()"} returning 1`,
            ),
          ).toHaveLength(0);
          expect(
            await sql.unsafe(`delete from ${table} returning 1`),
          ).toHaveLength(0);
        });
      }
      await rolledBack(async (sql) => {
        await sql.unsafe(`grant usage on schema public to ${role}`);
        await sql.unsafe(`grant insert on social_reel_renders to ${role}`);
        await sql.unsafe(`set local role ${role}`);
        await expect(
          sql.unsafe(`insert into social_reel_renders (concept, seconds, storyboard, storyboard_key)
            values ('meet-meetho', 10, '{}', '${"z".repeat(64)}')`),
        ).rejects.toThrow(/row-level security/);
      });
      expect(
        await client`select 1 from social_reel_renders where storyboard_key = ${"k".repeat(64)}`,
      ).toHaveLength(1);
      await client`delete from social_reel_renders where storyboard_key = ${"k".repeat(64)}`;
    });
  }

  it("rolls back to the exact pre-0032 schema without touching orders or posts", async () => {
    const rollback = readFileSync(
      path.join(
        process.cwd(),
        "docs/operations/rollback-0032-social-attribution-reels.sql",
      ),
      "utf8",
    )
      .replace(/^s*(BEGIN|COMMIT);s*$/gm, "")
      .replace(/^--.*$/gm, "");
    await rolledBack(async (sql) => {
      const [before] =
        await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      await sql.unsafe(rollback);
      const left = await sql`
        select tablename from pg_tables
        where schemaname = 'public' and tablename = any(${TABLES as unknown as string[]})`;
      expect(left).toEqual([]);
      const [after] =
        await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      expect(after!.n).toBe(before!.n - 1);
      // Everything 0032 pointed at is still there.
      await sql`select 1 from orders limit 1`;
      await sql`select 1 from social_posts limit 1`;
      await sql`select 1 from admin_users limit 1`;
    });
  });
});
