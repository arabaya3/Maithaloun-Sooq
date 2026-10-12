import { beforeEach, describe, expect, it } from "vitest";

import { CatalogAuthoringService } from "@/features/admin/application/catalog-authoring-service";
import { ProductOptionsService } from "@/features/admin/application/product-options-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import {
  MAX_OPTION_VALUES,
  MAX_PRODUCT_OPTIONS,
} from "@/features/catalog/domain/product-options";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const options = new ProductOptionsService(db, new CatalogAuthoringService(db));
const PRODUCT = "dolphin-bleach";
let owner: AdminActor;

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
});

describe("catalog limits", () => {
  it("lets one fragrance option hold many more values than before, up to the stated limit", async () => {
    const fragrances = Array.from(
      { length: 30 },
      (_, index) => `رائحة ${index + 1}`,
    );
    const { optionId } = await options.createOption(owner, PRODUCT, {
      nameAr: "الرائحة",
      kind: "fragrance",
      values: fragrances,
    });
    for (let index = 30; index < MAX_OPTION_VALUES; index += 1) {
      await options.addValue(owner, optionId, `رائحة ${index + 1}`);
    }
    const matrix = (await options.matrix(PRODUCT))!;
    expect(matrix.options[0]!.values).toHaveLength(MAX_OPTION_VALUES);
    await expect(
      options.addValue(owner, optionId, "رائحة زائدة"),
    ).rejects.toMatchObject({ code: "too_many_values", detail: "الرائحة" });
  });

  it("refuses a second fragrance option and names the one to add values to", async () => {
    await options.createOption(owner, PRODUCT, {
      nameAr: "الرائحة",
      kind: "fragrance",
      values: ["لافندر"],
    });
    await expect(
      options.createOption(owner, PRODUCT, {
        nameAr: "البركان – الخوخ",
        kind: "fragrance",
        values: ["Rich Peach"],
      }),
    ).rejects.toMatchObject({ code: "same_kind_option", detail: "الرائحة" });
  });

  it("allows more option types than before and says which limit was reached", async () => {
    for (let index = 0; index < MAX_PRODUCT_OPTIONS; index += 1) {
      await options.createOption(owner, PRODUCT, {
        nameAr: `خيار ${index + 1}`,
        kind: "other",
        values: ["أ"],
      });
    }
    await expect(
      options.createOption(owner, PRODUCT, {
        nameAr: "خيار زائد",
        kind: "other",
        values: ["أ"],
      }),
    ).rejects.toMatchObject({ code: "too_many_options" });
  });
});
