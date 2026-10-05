import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductOptionsService } from "@/features/admin/application/product-options-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import {
  mappingMessages,
  structureMessages,
} from "@/features/catalog/domain/product-media-validation";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "./support";

const { db, client } = testDatabaseConnection;
const PRODUCT = "general-cleaner";
const authoring = new CatalogAuthoringService(db);
const options = new ProductOptionsService(db, authoring);

let owner: AdminActor;
let ids: {
  color: string;
  size: string;
  blue: string;
  pink: string;
  small: string;
  large: string;
};

const photo = (name: string) => ({
  src: `https://example.com/${name}.webp`,
  alt: name,
  width: 800,
  height: 600,
});

const setPublication = (publication: "draft" | "published") =>
  authoring.setPublication(owner, {
    domainId: PRODUCT,
    publication,
    acceptPlaceholder: true,
  });

async function problems() {
  return (await authoring.publicationCheck(PRODUCT))!.problems;
}

async function variant(domainId: string) {
  const [row] = await db
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.domainId, domainId));
  return row!;
}

// Colour × size, four variants, each colour pictured, plus one shared primary picture.
async function validProduct() {
  await setPublication("draft");
  const color = await options.createOption(owner, PRODUCT, {
    nameAr: "اللون",
    kind: "color",
    values: ["أزرق", "زهري"],
  });
  const size = await options.createOption(owner, PRODUCT, {
    nameAr: "الحجم",
    kind: "size",
    values: ["صغير", "كبير"],
  });
  const [blue, pink] = color.valueIds as [string, string];
  const [small, large] = size.valueIds as [string, string];
  ids = {
    color: color.optionId,
    size: size.optionId,
    blue,
    pink,
    small,
    large,
  };
  await options.setVariantSelection(owner, `${PRODUCT}--default`, {
    selection: { [ids.color]: blue, [ids.size]: small },
  });
  await options.generateVariants(
    owner,
    PRODUCT,
    [
      [blue, large],
      [pink, small],
      [pink, large],
    ].map(([colour, measure]) => ({
      selection: { [ids.color]: colour!, [ids.size]: measure! },
      priceAgorot: 1_000,
    })),
    crypto.randomUUID(),
  );
  await options.addImages(owner, PRODUCT, [
    { ...photo("shared"), target: { scope: "product" }, primary: true },
    { ...photo("blue"), target: { scope: "option_value", valueId: blue } },
    { ...photo("pink"), target: { scope: "option_value", valueId: pink } },
  ]);
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

beforeEach(async () => {
  await client.unsafe("DELETE FROM product_images");
  await client.unsafe("DELETE FROM product_variant_option_values");
  await client.unsafe("DELETE FROM product_option_values");
  await client.unsafe("DELETE FROM product_options");
  await client.unsafe(
    "DELETE FROM product_variants WHERE domain_id LIKE 'general-cleaner--v%'",
  );
  await client.unsafe(
    "UPDATE product_variants SET combination_key = NULL, is_default = (domain_id LIKE '%--default'), availability = 'available'",
  );
  await client.unsafe("UPDATE products SET publication = 'published'");
});

afterAll(async () => {
  await client.end();
});

describe("publishing a product with variants", () => {
  it("publishes a complete multi-variant product with mapped and shared images", async () => {
    await validProduct();
    expect(await problems()).toEqual([]);
    await setPublication("published");
  });

  it("still publishes a simple product without options", async () => {
    await authoring.setPublication(owner, {
      domainId: "dolphin-bleach",
      publication: "draft",
      acceptPlaceholder: true,
    });
    await authoring.setPublication(owner, {
      domainId: "dolphin-bleach",
      publication: "published",
      acceptPlaceholder: true,
    });
  });

  it("blocks an orphan image until it is mapped or marked shared", async () => {
    await validProduct();
    await options.addImages(owner, PRODUCT, [
      { ...photo("loose"), target: { scope: "unassigned" } },
    ]);
    expect(await problems()).toEqual(
      expect.arrayContaining([
        mappingMessages.blocked,
        mappingMessages.unassigned,
      ]),
    );
    await expect(setPublication("published")).rejects.toMatchObject({
      code: "not_publishable",
    });
  });

  it("blocks a variant with a missing or archived option value", async () => {
    await validProduct();
    const pinkLarge = (await options.matrix(PRODUCT))!.variants.find(
      (row) =>
        row.optionValues[ids.color] === ids.pink &&
        row.optionValues[ids.size] === ids.large,
    )!;
    const row = await variant(pinkLarge.id);
    await db
      .delete(schema.productVariantOptionValues)
      .where(
        and(
          eq(schema.productVariantOptionValues.variantId, row.id),
          eq(schema.productVariantOptionValues.optionId, ids.size),
        ),
      );
    expect(await problems()).toContain(
      structureMessages.incomplete(row.labelAr, "الحجم"),
    );
    await db
      .update(schema.productOptionValues)
      .set({ archivedAt: new Date() })
      .where(eq(schema.productOptionValues.id, ids.large));
    expect(await problems()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/مربوط بقيمة مؤرشفة في «الحجم»/),
      ]),
    );
  });

  it("blocks two variants with the same choices, so the cart can never get the other one", async () => {
    await validProduct();
    const rows = (await options.matrix(PRODUCT))!.variants;
    const blueLarge = rows.find(
      (row) =>
        row.optionValues[ids.color] === ids.blue &&
        row.optionValues[ids.size] === ids.large,
    )!;
    const target = await variant(blueLarge.id);
    await db
      .update(schema.productVariants)
      .set({ combinationKey: null })
      .where(eq(schema.productVariants.id, target.id));
    await db
      .update(schema.productVariantOptionValues)
      .set({ valueId: ids.small })
      .where(
        and(
          eq(schema.productVariantOptionValues.variantId, target.id),
          eq(schema.productVariantOptionValues.optionId, ids.size),
        ),
      );
    expect((await problems()).join(" ")).toMatch(/لهما نفس الاختيارات/);
    await expect(setPublication("published")).rejects.toMatchObject({
      code: "not_publishable",
    });
  });

  it("blocks a product with no default variant, and the owner can choose one", async () => {
    await validProduct();
    await db
      .update(schema.productVariants)
      .set({ isDefault: false })
      .where(eq(schema.productVariants.domainId, `${PRODUCT}--default`));
    expect(await problems()).toContain(structureMessages.noDefault);
    const other = (await options.matrix(PRODUCT))!.variants.find(
      (row) => !row.isDefault,
    )!;
    await authoring.setDefaultVariant(owner, other.id);
    expect(await problems()).toEqual([]);
    expect((await variant(other.id)).isDefault).toBe(true);
  });

  it("blocks an unavailable default while other variants can be bought", async () => {
    await validProduct();
    await db
      .update(schema.productVariants)
      .set({ availability: "unavailable" })
      .where(eq(schema.productVariants.domainId, `${PRODUCT}--default`));
    expect((await problems()).join(" ")).toMatch(
      /الصنف الافتراضي .* غير متوفر/,
    );
  });

  it("judges the default as it will be when publishing as available", async () => {
    await validProduct();
    await db
      .update(schema.products)
      .set({ availability: "unavailable" })
      .where(eq(schema.products.domainId, PRODUCT));
    await db
      .update(schema.productVariants)
      .set({ availability: "unavailable" })
      .where(eq(schema.productVariants.domainId, `${PRODUCT}--default`));
    expect((await problems()).join(" ")).toMatch(/غير متوفر/);
    expect(
      (await authoring.publicationCheck(PRODUCT, "available"))!.problems,
    ).toEqual([]);
    await authoring.setPublication(owner, {
      domainId: PRODUCT,
      publication: "published",
      availability: "available",
      acceptPlaceholder: true,
    });
    expect((await variant(`${PRODUCT}--default`)).availability).toBe(
      "available",
    );
  });

  it("blocks a primary picture that belongs to one colour", async () => {
    await validProduct();
    const [blue] = await db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.altAr, "blue"));
    await db
      .update(schema.productImages)
      .set({ isPrimary: false })
      .where(eq(schema.productImages.productId, blue!.productId));
    await db
      .update(schema.productImages)
      .set({ isPrimary: true })
      .where(eq(schema.productImages.id, blue!.id));
    expect(await problems()).toContain(structureMessages.primaryNotShared);
  });

  it("cannot create a product already published when its colours have no pictures", async () => {
    const before = await db.select().from(schema.products);
    await expect(
      options.createProductSet(
        owner,
        {
          product: {
            nameAr: "معطر بدون صور",
            latinName: null,
            categoryCode: "home",
            description: null,
            unit: null,
            publication: "published",
            availability: "available",
          },
          options: [
            { nameAr: "اللون", kind: "color", values: ["أزرق", "أحمر"] },
          ],
          variants: [
            { values: { اللون: "أزرق" }, priceAgorot: 1_000 },
            { values: { اللون: "أحمر" }, priceAgorot: 1_000 },
          ],
          images: [],
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "not_publishable" });
    expect(await db.select().from(schema.products)).toHaveLength(before.length);
  });
});

describe("editing a published product", () => {
  it("allows the in-between steps of adding an option, but not republishing until complete", async () => {
    await validProduct();
    await setPublication("published");
    await options.createOption(owner, PRODUCT, {
      nameAr: "العبوة",
      kind: "pack",
      values: ["مفرد"],
    });
    expect((await problems()).join(" ")).toMatch(/ينقصه اختيار «العبوة»/);
    await setPublication("draft");
    await expect(setPublication("published")).rejects.toMatchObject({
      code: "not_publishable",
    });
  });

  it("refuses any change that leaves a live product showing or selling the wrong variant", async () => {
    await validProduct();
    await setPublication("published");
    await db
      .update(schema.productVariants)
      .set({ isDefault: false })
      .where(eq(schema.productVariants.domainId, `${PRODUCT}--default`));
    const [shared] = await db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.altAr, "shared"));
    await expect(
      options.updateImageAlt(owner, shared!.id, "وصف جديد"),
    ).rejects.toMatchObject({
      code: "breaks_published",
      detail: structureMessages.noDefault,
    });
    const [after] = await db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.id, shared!.id));
    expect(after!.altAr).toBe("shared");
  });
});
