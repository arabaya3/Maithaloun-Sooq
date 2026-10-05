import { orderGallery, type GalleryImage } from "./product-gallery";
import {
  closestVariant,
  variantForSelection,
  type OptionSelection,
  type ProductOption,
  type SelectableVariant,
} from "./product-options";

type ScopedImage = Pick<
  GalleryImage,
  | "id"
  | "isPrimary"
  | "sortOrder"
  | "scope"
  | "variantId"
  | "optionId"
  | "optionValueId"
>;

/** Images a customer may see: everything except images the owner has not classified yet. */
export function customerGallery<T extends ScopedImage>(
  images: readonly T[],
): T[] {
  return orderGallery(images.filter((image) => image.scope !== "unassigned"));
}

/**
 * The single image-priority rule shared by the storefront, the admin preview and the legacy image mirrors:
 * 1. an image of the exact resolved variant;
 * 2. an image of a selected option value (earlier options first);
 * 3. the product's primary shared image;
 * 4. any other shared image;
 * 5. null, so the caller shows its placeholder.
 */
export function resolveImage<T extends ScopedImage>(
  images: readonly T[],
  input: {
    variantId: string | null;
    selection: OptionSelection;
    optionOrder?: readonly string[];
  },
): T | null {
  const ordered = customerGallery(images);
  if (input.variantId) {
    const own = ordered.find(
      (image) =>
        image.scope === "variant" && image.variantId === input.variantId,
    );
    if (own) return own;
  }
  const optionOrder = input.optionOrder ?? Object.keys(input.selection).sort();
  for (const optionId of optionOrder) {
    const valueId = input.selection[optionId];
    if (!valueId) continue;
    const forValue = ordered.find(
      (image) =>
        image.scope === "option_value" &&
        image.optionId === optionId &&
        image.optionValueId === valueId,
    );
    if (forValue) return forValue;
  }
  const shared = ordered.filter((image) => image.scope === "product");
  return shared.find((image) => image.isPrimary) ?? shared[0] ?? null;
}

export type ImageSelection =
  | { kind: "none" }
  | { kind: "variant"; variantId: string; selection: OptionSelection };

/**
 * What tapping an image selects.
 * - An exact-variant image selects all and only that variant's values.
 * - An option-value image selects that value and keeps the other choices when that combination exists,
 *   otherwise moves to the closest variant carrying the value.
 * - A shared image, or one whose variant or value is not on sale, changes nothing.
 */
export function selectionForImage<T extends SelectableVariant>(
  image: ScopedImage,
  options: readonly ProductOption[],
  variants: readonly T[],
  current: OptionSelection,
): ImageSelection {
  if (image.scope === "variant" && image.variantId) {
    const variant = variants.find((row) => row.id === image.variantId);
    return variant
      ? {
          kind: "variant",
          variantId: variant.id,
          selection: { ...variant.optionValues },
        }
      : { kind: "none" };
  }
  if (image.scope === "option_value" && image.optionId && image.optionValueId) {
    const wanted = { ...current, [image.optionId]: image.optionValueId };
    const exact = variantForSelection(options, variants, wanted);
    const variant =
      exact ??
      closestVariant(variants, current, image.optionId, image.optionValueId);
    return variant
      ? {
          kind: "variant",
          variantId: variant.id,
          selection: { ...variant.optionValues },
        }
      : { kind: "none" };
  }
  return { kind: "none" };
}

/** Readable name of what an image shows, for alt text and admin summaries. */
export function imageScopeLabel(
  image: ScopedImage,
  options: readonly Pick<ProductOption, "id" | "nameAr" | "values">[],
  variantLabel: (variantId: string) => string | null,
): string | null {
  if (image.scope === "variant" && image.variantId)
    return variantLabel(image.variantId);
  if (image.scope === "option_value") {
    const option = options.find((row) => row.id === image.optionId);
    const value = option?.values.find((row) => row.id === image.optionValueId);
    return option && value ? `${option.nameAr}: ${value.valueAr}` : null;
  }
  return null;
}
