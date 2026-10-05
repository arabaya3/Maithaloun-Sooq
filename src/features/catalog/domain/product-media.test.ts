import { describe, expect, it } from "vitest";

import type { GalleryImage } from "./product-gallery";
import {
  customerGallery,
  imageScopeLabel,
  resolveImage,
  selectionForImage,
} from "./product-media";
import type { ProductOption } from "./product-options";

// معطر لويال: colour × size, with blue/large archived (so absent from the live list).
const options: ProductOption[] = [
  {
    id: "color",
    nameAr: "اللون",
    kind: "color",
    sortOrder: 0,
    values: [
      { id: "blue", valueAr: "أزرق", sortOrder: 0 },
      { id: "pink", valueAr: "زهري", sortOrder: 1 },
    ],
  },
  {
    id: "size",
    nameAr: "الحجم",
    kind: "size",
    sortOrder: 1,
    values: [
      { id: "small", valueAr: "صغير", sortOrder: 0 },
      { id: "large", valueAr: "كبير", sortOrder: 1 },
    ],
  },
];
const variant = (
  id: string,
  color: string,
  size: string,
  isDefault = false,
) => ({
  id,
  optionValues: { color, size },
  available: true,
  isDefault,
});
const all = [
  variant("blue-small", "blue", "small"),
  variant("blue-large", "blue", "large"),
  variant("pink-small", "pink", "small", true),
  variant("pink-large", "pink", "large"),
];
const optionOrder = ["color", "size"];

const image = (
  id: string,
  scope: GalleryImage["scope"],
  extra: Partial<GalleryImage> = {},
): GalleryImage => ({
  id,
  src: `/${id}.webp`,
  alt: id,
  width: 800,
  height: 800,
  sortOrder: 0,
  isPrimary: false,
  scope,
  variantId: null,
  optionId: null,
  optionValueId: null,
  ...extra,
});
const shared = image("shared", "product", { isPrimary: true });
const extraShared = image("shared-2", "product", { sortOrder: 4 });
const blue = image("blue", "option_value", {
  optionId: "color",
  optionValueId: "blue",
  sortOrder: 1,
});
const pink = image("pink", "option_value", {
  optionId: "color",
  optionValueId: "pink",
  sortOrder: 2,
});
const pinkLarge = image("pink-large", "variant", {
  variantId: "pink-large",
  sortOrder: 3,
});
const loose = image("loose", "unassigned", { sortOrder: 5 });
const gallery = [loose, pinkLarge, pink, blue, extraShared, shared];

describe("resolveImage priority", () => {
  it("1. shows the exact variant image first", () => {
    expect(
      resolveImage(gallery, {
        variantId: "pink-large",
        selection: { color: "pink", size: "large" },
        optionOrder,
      })?.id,
    ).toBe("pink-large");
  });

  it("2. falls back to the selected option value's image", () => {
    expect(
      resolveImage(gallery, {
        variantId: "pink-small",
        selection: { color: "pink", size: "small" },
        optionOrder,
      })?.id,
    ).toBe("pink");
  });

  it("2. uses a value image even while the selection is incomplete", () => {
    expect(
      resolveImage(gallery, {
        variantId: null,
        selection: { color: "blue" },
        optionOrder,
      })?.id,
    ).toBe("blue");
  });

  it("3. then the primary shared image", () => {
    expect(
      resolveImage([shared, extraShared, loose], {
        variantId: "blue-small",
        selection: { color: "blue", size: "small" },
        optionOrder,
      })?.id,
    ).toBe("shared");
  });

  it("4. then any other shared image", () => {
    expect(
      resolveImage([extraShared, loose], {
        variantId: null,
        selection: {},
      })?.id,
    ).toBe("shared-2");
  });

  it("5. returns null for the placeholder when nothing is classified", () => {
    expect(
      resolveImage([loose], { variantId: null, selection: {} }),
    ).toBeNull();
  });

  it("never shows an unclassified image to customers", () => {
    expect(customerGallery(gallery).map((row) => row.id)).not.toContain(
      "loose",
    );
    expect(customerGallery(gallery)[0]?.id).toBe("shared");
  });
});

describe("selectionForImage", () => {
  it("an option-value image selects that value and keeps a compatible size", () => {
    expect(
      selectionForImage(blue, options, all, { color: "pink", size: "large" }),
    ).toEqual({
      kind: "variant",
      variantId: "blue-large",
      selection: { color: "blue", size: "large" },
    });
  });

  it("selects only one value per option and never an unrelated option", () => {
    const picked = selectionForImage(blue, options, all, {
      color: "pink",
      size: "small",
    });
    expect(picked).toEqual({
      kind: "variant",
      variantId: "blue-small",
      selection: { color: "blue", size: "small" },
    });
    if (picked.kind === "variant")
      expect(Object.keys(picked.selection).sort()).toEqual(["color", "size"]);
  });

  it("moves to a deterministic valid variant when the kept size no longer exists", () => {
    const live = all.filter((row) => row.id !== "blue-large");
    expect(
      selectionForImage(blue, options, live, { color: "pink", size: "large" }),
    ).toEqual({
      kind: "variant",
      variantId: "blue-small",
      selection: { color: "blue", size: "small" },
    });
  });

  it("an exact-variant image selects all and only that variant's values", () => {
    expect(
      selectionForImage(pinkLarge, options, all, { color: "blue" }),
    ).toEqual({
      kind: "variant",
      variantId: "pink-large",
      selection: { color: "pink", size: "large" },
    });
  });

  it("a shared image does not change the selection", () => {
    expect(
      selectionForImage(shared, options, all, { color: "blue", size: "small" }),
    ).toEqual({ kind: "none" });
  });

  it("an image whose variant is not on sale changes nothing", () => {
    const archived = image("gone", "variant", { variantId: "blue-xl" });
    expect(selectionForImage(archived, options, all, {})).toEqual({
      kind: "none",
    });
    const noVariants = selectionForImage(blue, options, [], {});
    expect(noVariants).toEqual({ kind: "none" });
  });
});

describe("imageScopeLabel", () => {
  it("names what an image shows for alt text", () => {
    const label = (id: string) => (id === "pink-large" ? "زهري · كبير" : null);
    expect(imageScopeLabel(blue, options, label)).toBe("اللون: أزرق");
    expect(imageScopeLabel(pinkLarge, options, label)).toBe("زهري · كبير");
    expect(imageScopeLabel(shared, options, label)).toBeNull();
  });
});
