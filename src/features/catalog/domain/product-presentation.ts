import type { GalleryImage } from "./product-gallery";
import type { OptionSelection, ProductOption } from "./product-options";

export interface ProductPresentation {
  gallery: GalleryImage[];
  options: ProductOption[];
  variantOptions: Record<string, OptionSelection>;
  packCounts: Record<string, number | null>;
  /** Live variants do not each name one exact choice yet; the product is shown but cannot be bought. */
  incomplete: boolean;
}

export const emptyPresentation: ProductPresentation = {
  gallery: [],
  options: [],
  variantOptions: {},
  packCounts: {},
  incomplete: false,
};
