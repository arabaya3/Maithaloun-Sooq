import { readFile, readdir } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { client } = testDatabaseConnection;
const MIGRATION = "0019_product_image_scopes.sql";

async function apply(file: string) {
  const statements = (await readFile(`drizzle/${file}`, "utf8"))
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await client.unsafe(statement);
}

afterAll(async () => {
  await resetTestDatabase();
});

describe("0019 image scopes migration", () => {
  it("classifies existing images by what they already proved and changes nothing else", async () => {
    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    const files = (await readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(files).toContain(MIGRATION);
    for (const file of files.filter((name) => name < "0019")) await apply(file);

    await client.unsafe(`
      INSERT INTO product_categories (code, name_ar, icon, sort_order) VALUES ('home', 'مستلزمات منزلية', 'home', 1)
      ON CONFLICT DO NOTHING`);
    const [product] = await client.unsafe(`
      INSERT INTO products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        image_kind, image_src, image_alt, image_width, image_height, details_status)
      VALUES ('loyal', 'loyal', 'معطر لويال', 1000, 1, 'home', 'available',
        'image', 'https://example.com/main.webp', 'معطر', 800, 800, 'placeholder')
      RETURNING id`);
    const [blue] = await client.unsafe(`
      INSERT INTO product_variants (product_id, domain_id, label_ar, attributes, price_agorot, availability,
        image_kind, image_src, image_alt, image_width, image_height, sort_order, is_default)
      VALUES ('${product!.id}', 'loyal--blue', 'أزرق', '{"اللون":"أزرق"}', 1000, 'available',
        'image', 'https://example.com/blue.webp', 'أزرق', 800, 800, 0, true)
      RETURNING id`);
    // File names that look like colours must not be read as colours.
    await client.unsafe(`
      INSERT INTO product_images (product_id, variant_id, src, alt_ar, width, height, sort_order, is_primary)
      VALUES
        ('${product!.id}', NULL, 'https://example.com/main.webp', 'معطر', 800, 800, 0, true),
        ('${product!.id}', '${blue!.id}', 'https://example.com/blue.webp', 'أزرق', 800, 800, 1, false),
        ('${product!.id}', NULL, 'https://example.com/pink.webp', 'زهري', 800, 800, 2, false)`);
    const snapshot = () =>
      client.unsafe(`
        SELECT i.id, i.product_id, i.variant_id, i.src, i.alt_ar, i.width, i.height, i.sort_order, i.is_primary,
          i.archived_at, p.image_src, v.image_src AS variant_image, v.price_agorot
        FROM product_images i JOIN products p ON p.id = i.product_id
        LEFT JOIN product_variants v ON v.id = i.variant_id ORDER BY i.sort_order`);
    const before = await snapshot();

    await apply(MIGRATION);

    expect(await snapshot()).toEqual(before);
    const scopes = await client.unsafe(`
      SELECT src, scope, option_id, option_value_id FROM product_images ORDER BY sort_order`);
    expect(scopes.map((row) => [row.src, row.scope])).toEqual([
      ["https://example.com/main.webp", "product"],
      ["https://example.com/blue.webp", "variant"],
      ["https://example.com/pink.webp", "product"],
    ]);
    expect(
      scopes.every(
        (row) => row.option_id === null && row.option_value_id === null,
      ),
    ).toBe(true);
    const [value] = await client.unsafe(
      `SELECT count(*)::int AS total FROM product_option_values WHERE uses_shared_image`,
    );
    expect(value!.total).toBe(0);

    // Code from before this change inserts without a scope and keeps working.
    await client.unsafe(`
      INSERT INTO product_images (product_id, src, alt_ar, width, height, sort_order)
      VALUES ('${product!.id}', 'https://example.com/old-code.webp', 'قديم', 800, 800, 3)`);
    const [legacy] = await client.unsafe(
      `SELECT scope FROM product_images WHERE src = 'https://example.com/old-code.webp'`,
    );
    expect(legacy!.scope).toBe("product");
  });
});
