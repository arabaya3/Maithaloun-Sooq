import type { ProductCategory } from "@/features/catalog/domain/category";
import { localizedCategoryName } from "@/features/catalog/domain/category";
import {
  isProductAvailable,
  type Product,
} from "@/features/catalog/domain/product";
import { normalizeSearchText } from "@/features/catalog/domain/product-search";
import { cardPriceAgorot } from "@/features/catalog/domain/product-sort";

// Words that carry no product meaning in a shopping question.
const STOP_WORDS = new Set(
  [
    "بدي",
    "بدنا",
    "عندكم",
    "عندك",
    "في",
    "فيه",
    "شو",
    "ايش",
    "اي",
    "انا",
    "هل",
    "من",
    "على",
    "عن",
    "لل",
    "ل",
    "ال",
    "و",
    "او",
    "كم",
    "سعر",
    "اسعار",
    "ارخص",
    "اغلى",
    "منتج",
    "منتجات",
    "اشي",
    "شي",
    "the",
    "a",
    "an",
    "do",
    "you",
    "have",
    "any",
    "for",
    "i",
    "want",
    "need",
    "some",
    "please",
    "price",
    "cheapest",
    "what",
    "is",
    "are",
    "of",
  ].map(normalizeSearchText),
);

function tokens(text: string): string[] {
  return normalizeSearchText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^(ال|وال|بال|لل|و)(?=\S{3,})/, ""))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/**
 * Scores catalog products against a free-text request. Only real, published products come back,
 * available ones first; the score only orders them, it never invents a match.
 */
export function matchProducts(
  products: readonly Product[],
  categories: readonly ProductCategory[],
  query: string,
  options: {
    categoryCode?: string;
    limit?: number;
    cheapestFirst?: boolean;
  } = {},
): Product[] {
  const wanted = tokens(query);
  const categoryNames = new Map(
    categories.map((category) => [
      category.code,
      normalizeSearchText(
        `${localizedCategoryName(category, "ar")} ${localizedCategoryName(category, "en")}`,
      ),
    ]),
  );
  const scored = products
    .filter(
      (product) =>
        !options.categoryCode || product.categoryId === options.categoryCode,
    )
    .map((product) => {
      const name = normalizeSearchText(
        [product.nameAr, product.nameEn, product.latinName]
          .filter(Boolean)
          .join(" "),
      );
      const brand = normalizeSearchText(product.brand ?? "");
      const category = categoryNames.get(product.categoryId) ?? "";
      const description = normalizeSearchText(
        [product.description, product.descriptionEn].filter(Boolean).join(" "),
      );
      let score = 0;
      for (const token of wanted) {
        if (brand && (brand === token || brand.includes(token))) score += 6;
        if (name.includes(token)) score += 5;
        if (category.includes(token)) score += 3;
        if (description.includes(token)) score += 1;
      }
      return { product, score };
    })
    .filter((entry) => !wanted.length || entry.score > 0);
  scored.sort(
    (a, b) =>
      Number(isProductAvailable(b.product)) -
        Number(isProductAvailable(a.product)) ||
      (options.cheapestFirst
        ? cardPriceAgorot(a.product) - cardPriceAgorot(b.product)
        : b.score - a.score),
  );
  return scored.slice(0, options.limit ?? 6).map((entry) => entry.product);
}
