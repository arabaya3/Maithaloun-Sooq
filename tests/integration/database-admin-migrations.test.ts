import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { insertVerifiedReferenceData } from "@/server/db/development-seed";
import { orders } from "@/server/db/schema";
import { testDatabaseConnection } from "@/test/test-database";

const { db, client } = testDatabaseConnection;

function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("admin migrations", () => {
  it("applies 0001 on top of the phase 3 schema without rewriting snapshots", async () => {
    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");

    const phase3 = await readFile(
      "drizzle/0000_backend_orders_foundation.sql",
      "utf8",
    );
    for (const statement of statements(phase3)) {
      await client.unsafe(statement);
    }
    await insertVerifiedReferenceData(db);
    await client.unsafe(`
      INSERT INTO orders (
        public_reference,
        status,
        customer_name,
        normalized_phone,
        service_area_id,
        service_area_code_snapshot,
        service_area_name_snapshot,
        address,
        items_subtotal_agorot,
        delivery_fee_agorot,
        final_total_agorot,
        payment_method,
        idempotency_key,
        request_fingerprint
      )
      SELECT
        'MS-phase3snapshot00000000001',
        'pending',
        'عميل مرحلة سابقة',
        '+970591234567',
        id,
        code,
        name_ar,
        'عنوان محفوظ قبل الترقية',
        1400,
        NULL,
        NULL,
        'cash_on_delivery',
        gen_random_uuid(),
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      FROM service_areas
      WHERE code = 'maythalun'
      LIMIT 1
    `);

    const phase4 = await readFile(
      "drizzle/0001_admin_order_operations.sql",
      "utf8",
    );
    for (const statement of statements(phase4)) {
      await client.unsafe(statement);
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.publicReference, "MS-phase3snapshot00000000001"));
    expect(order).toMatchObject({
      status: "pending",
      customerName: "عميل مرحلة سابقة",
      address: "عنوان محفوظ قبل الترقية",
      deliveryFeeAgorot: null,
      finalTotalAgorot: null,
      version: 1,
    });

    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    await migrate(db, { migrationsFolder: "drizzle" });
    await insertVerifiedReferenceData(db);
  });
});
