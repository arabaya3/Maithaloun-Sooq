import {
  getProductDisplayName,
  type CategoryId,
  type Product,
} from "./product";

export interface ProductFilter {
  query: string;
  categoryId: CategoryId;
}

export function normalizeSearchText(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("ar-PS")
    .replace(/[\u0640\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

export function filterProducts(
  products: readonly Product[],
  filter: ProductFilter,
): readonly Product[] {
  const query = normalizeSearchText(filter.query);

  return products.filter((product) => {
    const categoryMatches =
      filter.categoryId === "all" || product.categoryId === filter.categoryId;
    const searchMatches =
      !query ||
      normalizeSearchText(getProductDisplayName(product)).includes(query);

    return categoryMatches && searchMatches;
  });
}
