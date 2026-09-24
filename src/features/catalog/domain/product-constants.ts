export const productCategoryIds = [
  "laundry",
  "kitchen",
  "bathroom",
  "tools",
  "home",
] as const;

export const placeholderKinds = [
  "general-cleaner",
  "bleach",
  "brush",
  "dish-liquid",
  "floor-cleaner",
  "degreaser",
] as const;

export type PlaceholderKind = (typeof placeholderKinds)[number];

export const productAvailabilityValues = ["available", "unavailable"] as const;
export const productDetailsStatusValues = ["placeholder", "verified"] as const;
