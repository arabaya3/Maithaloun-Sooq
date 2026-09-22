import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import postgres from "postgres";

function toSessionPoolerUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (url.hostname.includes("pooler.supabase.com") && url.port === "6543") {
    url.port = "5432";
  }
  return url.toString();
}

function shouldRun(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;
  if (["127.0.0.1", "localhost"].includes(hostname)) return false;
  return Boolean(process.env.VERCEL) || process.env.APPLY_DB_MIGRATIONS === "1";
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("Skipping order-contact ensure: DATABASE_URL is not set.");
  process.exit(0);
}

if (!shouldRun(databaseUrl)) {
  console.log("Skipping order-contact ensure outside Vercel/remote apply mode.");
  process.exit(0);
}

const sessionUrl = toSessionPoolerUrl(databaseUrl);
const parsed = new URL(sessionUrl);
console.log(
  `Ensuring order contact columns on ${parsed.hostname}:${parsed.port || "(default)"}${parsed.pathname}`,
);

const sql = postgres(sessionUrl, { max: 1, prepare: false });

try {
  await sql.unsafe("set statement_timeout = 0");

  const existing = await sql<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name in (
        'customer_full_name',
        'delivery_address',
        'whatsapp_phone_e164'
      )
  `;

  if (existing.length === 3) {
    console.log("Order contact columns already present.");
    process.exit(0);
  }

  // Forward-only, idempotent application of 0004 for production recovery.
  await sql.unsafe(`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "customer_full_name" varchar(100);
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "delivery_address" varchar(500);
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "whatsapp_phone_e164" varchar(20);
  `);

  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_customer_full_name_length'
      ) THEN
        ALTER TABLE "orders"
          ADD CONSTRAINT "orders_customer_full_name_length"
          CHECK (
            "customer_full_name" IS NULL
            OR (
              char_length(btrim("customer_full_name")) BETWEEN 2 AND 100
            )
          );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_address_length'
      ) THEN
        ALTER TABLE "orders"
          ADD CONSTRAINT "orders_delivery_address_length"
          CHECK (
            "delivery_address" IS NULL
            OR (
              char_length(btrim("delivery_address")) BETWEEN 8 AND 500
            )
          );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_whatsapp_phone_e164_format'
      ) THEN
        ALTER TABLE "orders"
          ADD CONSTRAINT "orders_whatsapp_phone_e164_format"
          CHECK (
            "whatsapp_phone_e164" IS NULL
            OR (
              "whatsapp_phone_e164" ~ '^\\+(970|972)5[0-9]{8}$'
            )
          );
      END IF;
    END
    $$;
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS "orders_whatsapp_phone_e164_idx"
      ON "public"."orders" USING btree ("whatsapp_phone_e164");
  `);

  const migrationSql = readFileSync(
    "drizzle/0004_order_whatsapp_contact_snapshot.sql",
    "utf8",
  );
  const hash = createHash("sha256").update(migrationSql).digest("hex");

  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS drizzle;
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);

  const recorded = await sql<{ hash: string }[]>`
    select hash from drizzle.__drizzle_migrations where hash = ${hash}
  `;
  if (recorded.length === 0) {
    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${hash}, ${Date.now()})
    `;
  }

  const columns = await sql<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name in (
        'customer_full_name',
        'delivery_address',
        'whatsapp_phone_e164'
      )
    order by column_name
  `;
  console.log(
    "Order contact columns ready:",
    columns.map((row) => row.column_name),
  );
} finally {
  await sql.end();
}
