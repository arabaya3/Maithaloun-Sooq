import { readFile, readdir } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { client } = testDatabaseConnection;

async function statements(file: string) {
  return (await readFile(`drizzle/${file}`, "utf8"))
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function apply(file: string) {
  for (const statement of await statements(file))
    await client.unsafe(statement);
}

afterAll(async () => {
  await resetTestDatabase();
});

describe("0016 product galleries and options migration", () => {
  it("copies existing images into galleries without touching products, variants, stock or orders", async () => {
    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    const files = (await readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(files).toContain("0016_product_galleries_and_options.sql");
    for (const file of files.filter((name) => name < "0016")) await apply(file);

    await client.unsafe(`
      INSERT INTO product_categories (code, name_ar, icon, sort_order) VALUES ('home', 'مستلزمات منزلية', 'home', 1)
      ON CONFLICT DO NOTHING`);
    const [photo] = await client.unsafe(`
      INSERT INTO products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        image_kind, image_src, image_alt, image_width, image_height, details_status)
      VALUES ('p-photo', 'p-photo', 'معطر مع صورة', 1000, 1, 'home', 'available',
        'image', 'https://example.com/a.webp', 'معطر', 800, 800, 'placeholder')
      RETURNING id`);
    const [plain] = await client.unsafe(`
      INSERT INTO products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        image_kind, placeholder_variant, details_status)
      VALUES ('p-plain', 'p-plain', 'منظف بدون صورة', 700, 2, 'home', 'available',
        'placeholder', 'general-cleaner', 'placeholder')
      RETURNING id`);
    await client.unsafe(`
      INSERT INTO product_variants (product_id, domain_id, label_ar, attributes, price_agorot, availability,
        image_kind, image_src, image_alt, image_width, image_height, sort_order, is_default)
      VALUES
        ('${photo!.id}', 'p-photo--default', 'الأساسي', '{"الرائحة":"مسك"}', 1000, 'available',
          'image', 'https://example.com/a.webp', 'معطر', 800, 800, 0, true),
        ('${photo!.id}', 'p-photo--rose', 'ورد', '{}', 1100, 'available',
          'image', 'https://example.com/rose.webp', 'ورد', 600, 600, 1, false)`);
    await client.unsafe(`
      INSERT INTO product_variants (product_id, domain_id, label_ar, attributes, price_agorot, availability,
        image_kind, placeholder_variant, sort_order, is_default)
      VALUES ('${plain!.id}', 'p-plain--default', 'الأساسي', '{}', 700, 'available', 'placeholder', 'general-cleaner', 0, true)`);
    const snapshot = () =>
      client.unsafe(`
        SELECT p.domain_id, p.image_src, p.price_agorot, v.domain_id AS variant, v.label_ar, v.attributes, v.image_src AS variant_image, v.price_agorot AS variant_price
        FROM products p JOIN product_variants v ON v.product_id = p.id ORDER BY v.domain_id`);
    const before = await snapshot();

    await apply("0016_product_galleries_and_options.sql");
    const backfill = (
      await statements("0016_product_galleries_and_options.sql")
    ).filter((statement) => statement.includes('INSERT INTO "product_images"'));
    for (const statement of backfill) await client.unsafe(statement);

    expect(await snapshot()).toEqual(before);
    const gallery = await client.unsafe(`
      SELECT p.domain_id, i.src, i.is_primary, v.domain_id AS variant
      FROM product_images i JOIN products p ON p.id = i.product_id
      LEFT JOIN product_variants v ON v.id = i.variant_id ORDER BY i.sort_order`);
    expect(gallery).toEqual([
      {
        domain_id: "p-photo",
        src: "https://example.com/a.webp",
        is_primary: true,
        variant: null,
      },
      {
        domain_id: "p-photo",
        src: "https://example.com/rose.webp",
        is_primary: false,
        variant: "p-photo--rose",
      },
    ]);
    const [counts] = await client.unsafe(
      "SELECT (SELECT count(*) FROM product_options)::int AS options, (SELECT count(*) FROM product_variant_option_values)::int AS links",
    );
    expect(counts).toEqual({ options: 0, links: 0 });

    await expect(
      client.unsafe(`INSERT INTO product_images (product_id, src, alt_ar, width, height, sort_order, is_primary)
        VALUES ('${photo!.id}', 'https://example.com/b.webp', 'ب', 10, 10, 5, true)`),
    ).rejects.toThrow(/product_images_one_primary_uidx/);
    const [other] = await client.unsafe(
      `SELECT id FROM product_variants WHERE domain_id = 'p-plain--default'`,
    );
    await expect(
      client.unsafe(`INSERT INTO product_images (product_id, variant_id, src, alt_ar, width, height, sort_order)
        VALUES ('${photo!.id}', '${other!.id}', 'https://example.com/c.webp', 'ج', 10, 10, 6)`),
    ).rejects.toThrow(/product_images_variant_same_product_fk/);

    const [option] =
      await client.unsafe(`INSERT INTO product_options (product_id, name_ar, normalized_name, kind, sort_order)
      VALUES ('${photo!.id}', 'الرائحة', 'الرائحه', 'fragrance', 0) RETURNING id`);
    await expect(
      client.unsafe(`INSERT INTO product_options (product_id, name_ar, normalized_name, sort_order)
        VALUES ('${photo!.id}', 'الرائحه', 'الرائحه', 1)`),
    ).rejects.toThrow(/product_options_name_uidx/);
    const [musk] =
      await client.unsafe(`INSERT INTO product_option_values (option_id, product_id, value_ar, normalized_value, sort_order)
      VALUES ('${option!.id}', '${photo!.id}', 'مسك', 'مسك', 0) RETURNING id`);
    const [rose] =
      await client.unsafe(`INSERT INTO product_option_values (option_id, product_id, value_ar, normalized_value, sort_order)
      VALUES ('${option!.id}', '${photo!.id}', 'ورد', 'ورد', 1) RETURNING id`);
    await expect(
      client.unsafe(`INSERT INTO product_option_values (option_id, product_id, value_ar, normalized_value, sort_order)
        VALUES ('${option!.id}', '${plain!.id}', 'عنبر', 'عنبر', 2)`),
    ).rejects.toThrow(/product_option_values_option_same_product_fk/);
    const [variant] = await client.unsafe(
      `SELECT id FROM product_variants WHERE domain_id = 'p-photo--default'`,
    );
    await client.unsafe(`INSERT INTO product_variant_option_values (variant_id, product_id, option_id, value_id)
      VALUES ('${variant!.id}', '${photo!.id}', '${option!.id}', '${musk!.id}')`);
    await expect(
      client.unsafe(`INSERT INTO product_variant_option_values (variant_id, product_id, option_id, value_id)
        VALUES ('${variant!.id}', '${photo!.id}', '${option!.id}', '${rose!.id}')`),
    ).rejects.toThrow(/product_variant_option_values_variant_id_option_id_pk/);
    await client.unsafe(
      `UPDATE product_variants SET combination_key = 'k1' WHERE domain_id IN ('p-photo--default')`,
    );
    await expect(
      client.unsafe(
        `UPDATE product_variants SET combination_key = 'k1' WHERE domain_id = 'p-photo--rose'`,
      ),
    ).rejects.toThrow(/product_variants_active_combination_uidx/);
    await expect(
      client.unsafe(
        `UPDATE product_variants SET pack_count = 0 WHERE domain_id = 'p-photo--rose'`,
      ),
    ).rejects.toThrow(/product_variants_pack_count/);

    const security = await client.unsafe(`
      SELECT c.relname AS table, c.relrowsecurity AS rls, has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
      FROM pg_class c WHERE c.relname IN ('product_images','product_options','product_option_values','product_variant_option_values') ORDER BY 1`);
    expect(security).toEqual(
      [
        "product_images",
        "product_option_values",
        "product_options",
        "product_variant_option_values",
      ].map((table) => ({
        table,
        rls: true,
        anon_select: false,
      })),
    );
  });
});
