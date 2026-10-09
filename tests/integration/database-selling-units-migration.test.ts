import { readFile, readdir } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

const { client } = testDatabaseConnection;
const IMAGE_SCOPES = "0019_product_image_scopes.sql";
const SELLING_UNITS = "0020_selling_units.sql";

async function apply(file: string) {
  const statements = (await readFile(`drizzle/${file}`, "utf8"))
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await client.unsafe(statement);
}

// Every pre-existing column of the business rows, in a stable order; later migrations may only add.
const snapshot = async () => ({
  products: await client.unsafe(
    `SELECT domain_id, slug, name_ar, price_agorot, publication, archived_at, updated_at FROM products ORDER BY domain_id`,
  ),
  variants: await client.unsafe(
    `SELECT domain_id, label_ar, attributes, price_agorot, sku, is_default, archived_at, pack_count, updated_at
     FROM product_variants ORDER BY domain_id`,
  ),
  images: await client.unsafe(
    `SELECT src, variant_id, is_primary, sort_order, archived_at FROM product_images ORDER BY sort_order`,
  ),
  stock: await client.unsafe(
    `SELECT on_hand_milli, reserved_milli, stock_value_agorot, avg_cost_agorot FROM inventory_items`,
  ),
  movements: await client.unsafe(
    `SELECT reason, qty_delta_milli, value_delta_agorot, on_hand_after_milli FROM stock_movements`,
  ),
  orders: await client.unsafe(
    `SELECT public_reference, items_subtotal_agorot, delivery_fee_agorot, final_total_agorot, status, version FROM orders`,
  ),
  orderItems: await client.unsafe(
    `SELECT product_name_snapshot, variant_domain_id, unit_price_agorot, list_unit_price_agorot, quantity, line_subtotal_agorot
     FROM order_items`,
  ),
});

afterAll(async () => {
  await resetTestDatabase();
});

describe("0020 selling units migration", () => {
  it("runs after 0019 on a populated database without changing products, images, stock or orders", async () => {
    await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    // Later migrations are additive and covered by their own tests; this one replays up to 0020.
    const files = (await readdir("drizzle"))
      .filter((name) => name.endsWith(".sql") && name <= SELLING_UNITS)
      .sort();
    // The order the migrator runs: #41's image scopes, then selling units.
    expect(files.slice(-2)).toEqual([IMAGE_SCOPES, SELLING_UNITS]);
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(
      journal.entries.filter((entry) => entry.idx <= 20).slice(-2),
    ).toEqual([
      expect.objectContaining({ idx: 19, tag: "0019_product_image_scopes" }),
      expect.objectContaining({ idx: 20, tag: "0020_selling_units" }),
    ]);
    for (const file of files.filter((name) => name < "0019")) await apply(file);

    // A populated store from before both migrations.
    await client.unsafe(`
      INSERT INTO product_categories (code, name_ar, icon, sort_order) VALUES ('tools', 'أدوات', 'brush', 1)
      ON CONFLICT DO NOTHING`);
    const [owner] = await client.unsafe(`
      INSERT INTO admin_users (username, display_name, password_hash, role)
      VALUES ('migration-owner', 'المالكة', 'x', 'owner') RETURNING id`);
    const [location] = await client.unsafe(`
      INSERT INTO inventory_locations (code, name_ar, is_default) VALUES ('main', 'المحل', true)
      ON CONFLICT (code) DO UPDATE SET is_default = true RETURNING id`);
    const [product] = await client.unsafe(`
      INSERT INTO products (domain_id, slug, name_ar, price_agorot, sort_order, category_id, availability,
        image_kind, placeholder_variant, details_status)
      VALUES ('m-cloth', 'm-cloth', 'ممسحة', 400, 1, 'tools', 'available', 'placeholder', 'brush', 'placeholder')
      RETURNING id`);
    const variants = await client.unsafe(`
      INSERT INTO product_variants (product_id, domain_id, label_ar, price_agorot, availability,
        image_kind, placeholder_variant, sort_order, is_default, sku, archived_at, pack_count)
      VALUES
        ('${product!.id}', 'm-cloth--blue', 'أزرق', 400, 'available', 'placeholder', 'brush', 0, true, 'CL-B', NULL, NULL),
        ('${product!.id}', 'm-cloth--green', 'أخضر', 450, 'available', 'placeholder', 'brush', 1, false, 'CL-B', NULL, 3),
        ('${product!.id}', 'm-cloth--draft', 'مسودة', 0, 'unavailable', 'placeholder', 'brush', 2, false, NULL, NULL, NULL),
        ('${product!.id}', 'm-cloth--old', 'قديم', 300, 'unavailable', 'placeholder', 'brush', 3, false, NULL, now(), NULL)
      RETURNING id, domain_id`);
    const blue = variants.find((row) => row.domain_id === "m-cloth--blue")!;
    await client.unsafe(`
      INSERT INTO product_images (product_id, variant_id, src, alt_ar, width, height, sort_order, is_primary)
      VALUES
        ('${product!.id}', NULL, 'https://example.com/shared.webp', 'ممسحة', 800, 800, 0, true),
        ('${product!.id}', '${blue.id}', 'https://example.com/blue.webp', 'أزرق', 800, 800, 1, false)`);
    const [item] = await client.unsafe(`
      INSERT INTO inventory_items (variant_id, location_id, unit) VALUES ('${blue.id}', '${location!.id}', 'piece')
      RETURNING id`);
    await client.unsafe(`
      INSERT INTO stock_movements (inventory_item_id, reason, qty_delta_milli, value_delta_agorot, unit_cost_agorot,
        on_hand_after_milli, reserved_after_milli, value_after_agorot, idempotency_key, created_by)
      VALUES ('${item!.id}', 'opening_balance', 10000, 2000, 200, 0, 0, 0, 'migration-stock', '${owner!.id}')`);
    const [area] = await client.unsafe(
      "INSERT INTO service_areas (code, name_ar, sort_order) VALUES ('maythalun', 'ميثلون', 1) RETURNING id, code, name_ar",
    );
    const [order] = await client.unsafe(`
      INSERT INTO orders (public_reference, customer_name, normalized_phone, service_area_id,
        service_area_code_snapshot, service_area_name_snapshot, address, items_subtotal_agorot,
        delivery_fee_agorot, final_total_agorot, idempotency_key, request_fingerprint)
      VALUES ('MS-migrationtestreference00', 'زبون', '+970591234567', '${area!.id}', '${area!.code}',
        '${area!.name_ar}', 'عنوان محلي مفصل', 760, 500, 1260, gen_random_uuid(), 'fp')
      RETURNING id`);
    // A historical price that differs from today's variant price.
    await client.unsafe(`
      INSERT INTO order_items (order_id, product_domain_id, variant_domain_id, product_name_snapshot,
        variant_label_snapshot, unit_price_agorot, list_unit_price_agorot, quantity, line_subtotal_agorot)
      VALUES ('${order!.id}', 'm-cloth', 'm-cloth--blue', 'ممسحة — أزرق', 'أزرق', 380, 400, 2, 760)`);
    const before = await snapshot();

    await apply(IMAGE_SCOPES);
    expect(await snapshot()).toEqual(before);
    expect(
      await client.unsafe(
        "SELECT src, scope FROM product_images ORDER BY sort_order",
      ),
    ).toEqual([
      { src: "https://example.com/shared.webp", scope: "product" },
      { src: "https://example.com/blue.webp", scope: "variant" },
    ]);

    await apply(SELLING_UNITS);
    expect(await snapshot()).toEqual(before);

    expect(
      await client.unsafe(`
        SELECT v.domain_id, s.label_ar, s.units_per_sale, s.price_agorot, s.is_default,
          s.mirrors_variant, s.sku, s.archived_at IS NULL AS active
        FROM product_selling_units s JOIN product_variants v ON v.id = s.variant_id
        ORDER BY v.domain_id`),
    ).toEqual([
      // Variant SKUs stay on the variant (a duplicated legacy SKU is not copied into a unique index).
      {
        domain_id: "m-cloth--blue",
        label_ar: "حبة واحدة",
        units_per_sale: 1,
        price_agorot: 400,
        is_default: true,
        mirrors_variant: true,
        sku: null,
        active: true,
      },
      {
        domain_id: "m-cloth--green",
        label_ar: "حبة واحدة",
        units_per_sale: 1,
        price_agorot: 450,
        is_default: true,
        mirrors_variant: true,
        sku: null,
        active: true,
      },
    ]);
    // Existing lines read as one piece each at their recorded price; nothing is rewritten.
    expect(
      await client.unsafe(
        "SELECT units_per_sale, base_units, selling_unit_id, unit_price_agorot FROM order_items",
      ),
    ).toEqual([
      {
        units_per_sale: 1,
        base_units: 2,
        selling_unit_id: null,
        unit_price_agorot: 380,
      },
    ]);

    // New and priced-later variants get their base unit; prices follow the variant.
    await client.unsafe(
      "UPDATE product_variants SET price_agorot = 500 WHERE domain_id = 'm-cloth--draft'",
    );
    await client.unsafe(
      "UPDATE product_variants SET price_agorot = 420 WHERE domain_id = 'm-cloth--blue'",
    );
    expect(
      await client.unsafe(`
        SELECT v.domain_id, s.price_agorot, s.version FROM product_selling_units s
        JOIN product_variants v ON v.id = s.variant_id ORDER BY v.domain_id`),
    ).toEqual([
      { domain_id: "m-cloth--blue", price_agorot: 420, version: 2 },
      { domain_id: "m-cloth--draft", price_agorot: 500, version: 1 },
      { domain_id: "m-cloth--green", price_agorot: 450, version: 1 },
    ]);
    expect(
      await client.unsafe("SELECT unit_price_agorot FROM order_items"),
    ).toEqual([{ unit_price_agorot: 380 }]);

    // Snapshots are immutable; key cascades from a renamed product still pass.
    await expect(
      client.unsafe("UPDATE order_items SET unit_price_agorot = 1"),
    ).rejects.toThrow(/snapshots are immutable/);
    await client.unsafe(
      "UPDATE products SET domain_id = 'm-cloth-renamed' WHERE domain_id = 'm-cloth'",
    );
    expect(
      await client.unsafe("SELECT product_domain_id FROM order_items"),
    ).toEqual([{ product_domain_id: "m-cloth-renamed" }]);

    const security = await client.unsafe(`
      SELECT c.relrowsecurity AS rls,
        has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
        has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
        has_function_privilege('anon', 'public.sync_variant_selling_unit()', 'EXECUTE') AS anon_exec
      FROM pg_class c WHERE c.relname = 'product_selling_units'`);
    expect(security).toEqual([
      { rls: true, anon_select: false, auth_select: false, anon_exec: false },
    ]);
  });
});
