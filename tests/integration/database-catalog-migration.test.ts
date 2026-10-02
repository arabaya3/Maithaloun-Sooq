import { readFile, readdir } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { client } = testDatabaseConnection;

function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function apply(file: string) {
  for (const statement of statements(
    await readFile(`drizzle/${file}`, "utf8"),
  )) {
    await client.unsafe(statement);
  }
}

afterAll(async () => {
  await resetTestDatabase();
});

describe("0012 assistant catalog migration", () => {
  it("turns categories into rows on a populated database without touching business data", async () => {
    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    const files = (await readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const before = files.filter((name) => name < "0012");
    expect(files).toContain("0012_assistant_catalog.sql");
    for (const file of before) await apply(file);

    const categories = ["laundry", "kitchen", "bathroom", "tools", "home"];
    for (const [index, category] of categories.entries()) {
      await client.unsafe(`
        INSERT INTO products (domain_id, slug, name_ar, price_agorot, sort_order, category_id,
          availability, image_kind, placeholder_variant, details_status)
        VALUES ('legacy-${category}', 'legacy-${category}', 'منتج ${category}', ${500 + index}, ${index},
          '${category}', 'available', 'placeholder', 'general-cleaner', 'placeholder')
      `);
      await client.unsafe(`
        INSERT INTO product_variants (product_id, domain_id, label_ar, price_agorot, availability,
          image_kind, placeholder_variant, sort_order, is_default, sku)
        SELECT id, 'legacy-${category}--default', 'الافتراضي', price_agorot, 'available',
          'placeholder', 'general-cleaner', 0, true, 'DUP-SKU'
        FROM products WHERE domain_id = 'legacy-${category}'
      `);
    }
    const snapshot = await client.unsafe(
      "SELECT domain_id, category_id::text AS category, price_agorot FROM products ORDER BY domain_id",
    );

    await apply("0012_assistant_catalog.sql");

    expect(
      await client.unsafe(
        "SELECT domain_id, category_id AS category, price_agorot FROM products ORDER BY domain_id",
      ),
    ).toEqual(snapshot);
    const rows = await client.unsafe(
      "SELECT code, name_ar, icon, visible, archived_at FROM product_categories ORDER BY sort_order",
    );
    expect(rows.map((row) => row.code)).toEqual(categories);
    expect(rows.every((row) => row.visible && row.archived_at === null)).toBe(
      true,
    );
    expect(
      await client.unsafe(
        "SELECT DISTINCT publication::text AS publication FROM products",
      ),
    ).toEqual([{ publication: "published" }]);
    expect(
      await client.unsafe(
        "SELECT count(*)::int AS archived FROM product_variants WHERE archived_at IS NOT NULL",
      ),
    ).toEqual([{ archived: 0 }]);

    await expect(
      client.unsafe(
        "UPDATE products SET category_id = 'missing' WHERE domain_id = 'legacy-home'",
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      client.unsafe("DELETE FROM product_categories WHERE code = 'home'"),
    ).rejects.toThrow(/foreign key/);
    await expect(
      client.unsafe(
        "INSERT INTO product_categories (code, name_ar, icon, sort_order) VALUES ('all', 'الكل', 'grid', 9)",
      ),
    ).rejects.toThrow(/product_categories_code_format/);
    await expect(
      client.unsafe(
        "UPDATE product_variants SET archived_at = now() WHERE domain_id = 'legacy-home--default'",
      ),
    ).rejects.toThrow(/product_variants_default_not_archived/);

    const [security] = await client.unsafe(`
      SELECT c.relrowsecurity AS rls,
        has_table_privilege('anon', 'public.product_categories', 'SELECT') AS anon_select,
        has_table_privilege('authenticated', 'public.product_categories', 'SELECT') AS user_select
      FROM pg_class c WHERE c.relname = 'product_categories'
    `);
    expect(security).toEqual({
      rls: true,
      anon_select: false,
      user_select: false,
    });

    const [legacyType] = await client.unsafe(
      "SELECT count(*)::int AS kept FROM pg_type WHERE typname = 'product_category'",
    );
    expect(legacyType).toEqual({ kept: 1 });
    const indexes = await client.unsafe(
      "SELECT indexname FROM pg_indexes WHERE tablename IN ('products', 'product_variants', 'product_categories') ORDER BY 1",
    );
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "products_category_idx",
        "products_storefront_idx",
        "product_variants_sku_idx",
        "product_variants_barcode_idx",
        "product_categories_merged_into_idx",
        "product_categories_active_name_uidx",
      ]),
    );
  });
});
