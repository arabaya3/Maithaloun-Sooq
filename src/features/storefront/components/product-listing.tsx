"use client";

import { Check, LayoutGrid, PackageSearch } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { categoryIcons } from "@/features/catalog/components/category-icons";
import { ProductCard } from "@/features/catalog/components/product-card";
import {
  ALL_CATEGORIES,
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import type { Product } from "@/features/catalog/domain/product";
import {
  categoryProductCounts,
  productsInCategory,
} from "@/features/catalog/domain/product-categories";
import {
  DEFAULT_PRODUCT_SORT,
  parseProductSort,
  sortProducts,
  type ProductSort,
} from "@/features/catalog/domain/product-sort";
import { CatalogToolbar } from "@/features/storefront/components/catalog-toolbar";
import { useListScrollRestore } from "@/features/storefront/components/use-list-scroll-restore";
import { isNewArrival } from "@/features/storefront/domain/new-arrivals";
import { useI18n } from "@/i18n/i18n-provider";

export const LISTING_BATCH = 12;

/**
 * A product grid with sort, an optional category filter and «show more». Its state lives in the
 * address (?sort, ?category, ?shown), so a shared link or the back button brings the same list back.
 * Sorting runs on the whole list before it is cut into pages, and each product appears once.
 */
export function ProductListing({
  products,
  heading,
  categories,
  newSince,
  emptyState,
}: {
  products: readonly Product[];
  heading: ReactNode;
  /** When given, the list can be narrowed to one of these categories. */
  categories?: readonly ProductCategory[];
  newSince?: string | null;
  emptyState?: ReactNode;
}) {
  const { m, locale } = useI18n();
  const [sort, setSort] = useState<ProductSort>(DEFAULT_PRODUCT_SORT);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [draftCategory, setDraftCategory] = useState<string>(ALL_CATEGORIES);
  const [shown, setShown] = useState(LISTING_BATCH);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl =
      categories?.find((item) => item.code === params.get("category"))?.code ??
      ALL_CATEGORIES;
    const count = Number(params.get("shown"));
    queueMicrotask(() => {
      setSort(parseProductSort(params.get("sort")));
      setCategory(fromUrl);
      setDraftCategory(fromUrl);
      if (Number.isSafeInteger(count) && count > LISTING_BATCH) setShown(count);
      setReady(true);
    });
    // Once, on arrival; later changes are written to the address below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useListScrollRestore(ready);

  const write = (next: {
    sort?: ProductSort;
    category?: string;
    shown?: number;
  }) => {
    const url = new URL(window.location.href);
    const nextSort = next.sort ?? sort;
    const nextCategory = next.category ?? category;
    const nextShown = next.shown ?? LISTING_BATCH;
    if (nextSort === DEFAULT_PRODUCT_SORT) url.searchParams.delete("sort");
    else url.searchParams.set("sort", nextSort);
    if (nextCategory === ALL_CATEGORIES) url.searchParams.delete("category");
    else url.searchParams.set("category", nextCategory);
    if (nextShown > LISTING_BATCH)
      url.searchParams.set("shown", String(nextShown));
    else url.searchParams.delete("shown");
    window.history.replaceState(window.history.state, "", url);
  };

  const filtered = useMemo(
    () =>
      sortProducts(
        category === ALL_CATEGORIES
          ? products
          : productsInCategory(products, category),
        sort,
      ),
    [category, products, sort],
  );
  const counts = useMemo(() => categoryProductCounts(products), [products]);
  const visible = filtered.slice(0, shown);
  const remaining = filtered.length - visible.length;

  const applyCategory = (code: string) => {
    setCategory(code);
    setDraftCategory(code);
    setShown(LISTING_BATCH);
    write({ category: code, shown: LISTING_BATCH });
  };

  return (
    <section className="catalog-section" aria-label={m.store.allProducts}>
      <CatalogToolbar
        heading={heading}
        count={filtered.length}
        sort={sort}
        onSort={(value) => {
          setSort(value);
          setShown(LISTING_BATCH);
          write({ sort: value, shown: LISTING_BATCH });
        }}
        chips={
          categories && category !== ALL_CATEGORIES
            ? [
                {
                  key: "category",
                  label: m.store.categoryFilter(
                    localizedCategoryName(
                      categories.find((item) => item.code === category)!,
                      locale,
                    ),
                  ),
                  onRemove: () => applyCategory(ALL_CATEGORIES),
                },
              ]
            : []
        }
        onClearFilters={() => applyCategory(ALL_CATEGORIES)}
        sheet={
          categories?.length
            ? {
                activeCount: category === ALL_CATEGORIES ? 0 : 1,
                previewCount:
                  draftCategory === ALL_CATEGORIES
                    ? products.length
                    : (counts.get(draftCategory) ?? 0),
                canReset: draftCategory !== ALL_CATEGORIES,
                onOpen: () => setDraftCategory(category),
                onApply: () => applyCategory(draftCategory),
                onReset: () => setDraftCategory(ALL_CATEGORIES),
                content: (
                  <fieldset className="filter-sheet-group">
                    <legend>{m.store.categoryHeading}</legend>
                    <div className="filter-sheet-options">
                      {[
                        {
                          code: ALL_CATEGORIES,
                          name: m.store.allFilter,
                          icon: LayoutGrid,
                          count: products.length,
                        },
                        ...categories.map((item) => ({
                          code: item.code,
                          name: localizedCategoryName(item, locale),
                          icon: categoryIcons[item.icon] ?? LayoutGrid,
                          count: counts.get(item.code) ?? 0,
                        })),
                      ].map((option) => {
                        const Icon = option.icon;
                        return (
                          <label key={option.code} className="filter-option">
                            <input
                              className="sr-only"
                              type="radio"
                              name="listing-category"
                              checked={draftCategory === option.code}
                              onChange={() => setDraftCategory(option.code)}
                            />
                            <Icon
                              className="filter-option-icon"
                              aria-hidden="true"
                            />
                            <span>{option.name}</span>
                            <span
                              className="filter-option-count"
                              aria-hidden="true"
                            >
                              {option.count}
                            </span>
                            <span
                              className="filter-option-radio"
                              aria-hidden="true"
                            >
                              <Check />
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ),
              }
            : undefined
        }
      />
      {filtered.length ? (
        <>
          <div className="product-grid">
            {visible.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                isNew={isNewArrival(product, newSince)}
              />
            ))}
          </div>
          {remaining > 0 ? (
            <div className="catalog-more">
              <p className="catalog-more-count">
                {m.store.showing(visible.length, filtered.length)}
              </p>
              <button
                type="button"
                className="catalog-more-button"
                onClick={() => {
                  const next = shown + LISTING_BATCH;
                  setShown(next);
                  write({ shown: next });
                }}
              >
                {m.store.showMore(Math.min(remaining, LISTING_BATCH))}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        (emptyState ?? (
          <div className="empty-state" role="status">
            <PackageSearch aria-hidden="true" />
            <h3>{m.store.noResults}</h3>
          </div>
        ))
      )}
    </section>
  );
}
