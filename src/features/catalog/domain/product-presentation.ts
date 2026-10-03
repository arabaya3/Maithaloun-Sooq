import type { GalleryImage } from "./product-gallery";
import type { OptionSelection, ProductOption } from "./product-options";

export interface ProductPresentation {
  gallery: GalleryImage[];
  options: ProductOption[];
  variantOptions: Record<string, OptionSelection>;
  packCounts: Record<string, number | null>;
}

export const emptyPresentation: ProductPresentation = {
  gallery: [],
  options: [],
  variantOptions: {},
  packCounts: {},
};
