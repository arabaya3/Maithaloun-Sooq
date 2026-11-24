"use client";

import { Check, LayoutGrid, PackageSearch, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { categoryIcons } from "@/features/catalog/components/category-icons";
import { ProductCard } from "@/features/catalog/components/product-card";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  ALL_CATEGORIES,
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import {
  isInCategory,
  productCategoryCodes,
  type CategoryId,
  type Product,
} from "@/features/catalog/domain/product";
import { filterProducts } from "@/features/catalog/domain/product-search";
import {
  DEFAULT_PRODUCT_SORT,
  parseProductSort,
  sortProducts,
  type ProductSort,
} from "@/features/catalog/domain/product-sort";
import { CatalogToolbar } from "@/features/storefront/components/catalog-toolbar";
import { DailyCategoryBanner } from "@/features/storefront/components/daily-category-banner";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { useListScrollRestore } from "@/features/storefront/components/use-list-scroll-restore";
import { categoryCovers } from "@/features/storefront/domain/home-merchandising";
import { isNewArrival } from "@/features/storefront/domain/new-arrivals";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

// The first batch keeps the phone page short; more is one tap away, never on scroll.
export const CATALOG_BATCH = 12;

/** The category the server picked for today (Asia/Hebron) and the products whose photos it shows. */
export interface DailyCategory {
  code: string | null;
  productIds: readonly string[];
}

function ProductSearch({
  query,
  onChange,
  inputRef,
}: {
  query: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { m } = useI18n();
  return (
    <div className="search-wrap" role="search">
      <label htmlFor="product-search" className="sr-only">
        {m.store.searchLabel}
      </label>
      <Search aria-hidden="true" />
      <input
        ref={inputRef}
        id="product-search"
        type="search"
        enterKeyHint="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            document
              .getElementById("catalog")
              ?.scrollIntoView({ block: "start" });
          }
        }}
        placeholder={m.store.searchPlaceholder}
        autoComplete="off"
      />
      {query ? (
        <button
          type="button"
          className="clear-search"
          aria-label={m.store.clearSearch}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function CategoryPicker({
  categories,
  covers,
}: {
  categories: readonly ProductCategory[];
  covers: ReadonlyMap<string, Product>;
}) {
  const { m, locale } = useI18n();
  if (!categories.length) return null;
  return (
    <section className="categories-section" aria-labelledby="categories-title">
      <div className="home-section-heading">
        <h2 id="categories-title">{m.store.shopByCategory}</h2>
        <Link href="/categories" className="home-section-link">
          {m.store.allCategories}
        </Link>
      </div>
      <ul className="category-list">
        {categories.map((category) => {
          const Icon = categoryIcons[category.icon] ?? LayoutGrid;
          const cover = covers.get(category.code);
          return (
            <li key={category.code}>
              <Link
                href={`/categories/${encodeURIComponent(category.code)}`}
                className="category-item"
                data-category-id={category.code}
              >
                <span
                  className="category-icon"
                  data-cover={Boolean(cover)}
                  aria-hidden="true"
                >
                  {cover ? (
                    <ProductMedia
                      product={cover}
                      className="category-cover"
                      sizes="(min-width: 48rem) 160px, 96px"
                    />
                  ) : (
                    <Icon />
                  )}
                </span>
                <span className="category-label">
                  {localizedCategoryName(category, locale)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Mirrors the filters into the address, so a search or category can be shared and survives a reload. */
function writeFiltersToUrl(
  category: CategoryId,
  query: string,
  sort: ProductSort,
) {
  // Only the catalog's own parameters change; anything else in the address is kept.
  const url = new URL(window.location.href);
  url.searchParams.delete("shown");
  if (sort === DEFAULT_PRODUCT_SORT) url.searchParams.delete("sort");
  else url.searchParams.set("sort", sort);
  if (category === ALL_CATEGORIES) url.searchParams.delete("category");
  else url.searchParams.set("category", category);
  if (query.trim()) url.searchParams.set("q", query.trim());
  else url.searchParams.delete("q");
  window.history.replaceState(window.history.state, "", url);
}

export function Storefront({
  products,
  categories,
  initialCategory = ALL_CATEGORIES,
  initialQuery = "",
  initialSort = DEFAULT_PRODUCT_SORT,
  daily = null,
  newSince = null,
  readFiltersFromUrl = false,
}: {
  products: readonly Product[];
  categories: readonly ProductCategory[];
  initialCategory?: CategoryId;
  initialQuery?: string;
  initialSort?: ProductSort;
  /** Computed on the server for the store day, so every visitor and the first paint agree. */
  daily?: DailyCategory | null;
  /** Products created since this ISO time carry the «new» badge. */
  newSince?: string | null;
  /** The cached home page reads ?category, ?q and ?sort in the browser, in place (no remount). */
  readFiltersFromUrl?: boolean;
}) {
  const { m, locale } = useI18n();
  const [query, setQueryState] = useState(initialQuery);
  const [category, setCategoryState] = useState<CategoryId>(initialCategory);
  const [sort, setSortState] = useState<ProductSort>(initialSort);
  // The phone sheet edits a draft category that only applies on «Show results».
  const [draftCategory, setDraftCategory] =
    useState<CategoryId>(initialCategory);
  const setCategory = (code: CategoryId) => {
    setCategoryState(code);
    setDraftCategory(code);
    writeFiltersToUrl(code, query, sort);
  };
  const setQuery = (value: string) => {
    setQueryState(value);
    writeFiltersToUrl(category, value, sort);
  };
  const setSort = (value: ProductSort) => {
    setSortState(value);
    writeFiltersToUrl(category, query, value);
  };
  const [filtersReady, setFiltersReady] = useState(!readFiltersFromUrl);
  const filterKey = `${category}|${query.trim()}|${sort}`;
  const [batch, setBatch] = useState({ key: filterKey, count: CATALOG_BATCH });
  useEffect(() => {
    if (!readFiltersFromUrl) return;
    const params = new URLSearchParams(window.location.search);
    // Unknown, hidden or archived codes fall back to every product.
    const fromUrl =
      categories.find((item) => item.code === params.get("category"))?.code ??
      ALL_CATEGORIES;
    const queryFromUrl = (params.get("q") ?? "").slice(0, 100);
    const sortFromUrl = parseProductSort(params.get("sort"));
    const shown = Number(params.get("shown"));
    queueMicrotask(() => {
      setFiltersReady(true);
      if (Number.isSafeInteger(shown) && shown > CATALOG_BATCH) {
        setBatch({
          key: `${fromUrl}|${queryFromUrl.trim()}|${sortFromUrl}`,
          count: shown,
        });
      }
      setCategoryState(fromUrl);
      setDraftCategory(fromUrl);
      setQueryState(queryFromUrl);
      setSortState(sortFromUrl);
    });
    // Once, on arrival: later changes are written to the address by the setters above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useListScrollRestore(filtersReady);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const covers = useMemo(() => categoryCovers(products), [products]);
  const dailyCategory =
    categories.find((item) => item.code === daily?.code) ?? null;
  const dailyProducts = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    return (daily?.productIds ?? []).flatMap((id) => byId.get(id) ?? []);
  }, [daily, products]);
  const dailyProductCount = useMemo(
    () =>
      daily?.code
        ? products.filter((product) => isInCategory(product, daily.code!))
            .length
        : 0,
    [daily, products],
  );

  const filteredProducts = useMemo(
    () =>
      sortProducts(
        filterProducts(products, { query, categoryId: category }),
        sort,
      ),
    [category, products, query, sort],
  );
  // A new search or category starts again from the first batch.
  const visibleCount = batch.key === filterKey ? batch.count : CATALOG_BATCH;
  const categoryCounts = useMemo(() => {
    const matches = filterProducts(products, {
      query,
      categoryId: ALL_CATEGORIES,
    });
    const counts = new Map<CategoryId, number>([
      [ALL_CATEGORIES, matches.length],
    ]);
    for (const product of matches) {
      for (const code of productCategoryCodes(product)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
    return counts;
  }, [products, query]);
  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const remaining = filteredProducts.length - visibleProducts.length;
  const selectedCategory = categories.find((item) => item.code === category);
  const hasActiveFilter = Boolean(query.trim()) || category !== ALL_CATEGORIES;

  useEffect(() => {
    if (window.location.hash === "#product-search") {
      searchInputRef.current?.focus();
    }
  }, []);

  const resetFilters = () => {
    setQueryState("");
    setCategoryState(ALL_CATEGORIES);
    setDraftCategory(ALL_CATEGORIES);
    writeFiltersToUrl(ALL_CATEGORIES, "", sort);
    queueMicrotask(() => searchInputRef.current?.focus());
  };

  return (
    <>
      <SiteHeader
        search={
          <ProductSearch
            query={query}
            onChange={setQuery}
            inputRef={searchInputRef}
          />
        }
      />
      <main className="page-shell storefront-main">
        <h1 className="sr-only">{m.store.shopHeading}</h1>
        {hasActiveFilter ? null : (
          <div className="catalog-merchandising">
            <DailyCategoryBanner
              category={dailyCategory}
              products={dailyProducts}
              productCount={dailyProductCount}
            />
            <CategoryPicker categories={categories} covers={covers} />
          </div>
        )}
        <section
          id="catalog"
          className="catalog-section"
          aria-labelledby="catalog-title"
        >
          <CatalogToolbar
            heading={
              <>
                <h2 id="catalog-title">
                  {hasActiveFilter
                    ? m.store.searchResults
                    : m.store.newArrivals}
                </h2>
                <Link href="/products" className="home-section-link">
                  {m.store.viewAll}
                </Link>
              </>
            }
            count={filteredProducts.length}
            sort={sort}
            onSort={setSort}
            chips={[
              ...(query.trim()
                ? [
                    {
                      key: "q",
                      label: m.store.searchQuery(query.trim()),
                      onRemove: () => setQuery(""),
                    },
                  ]
                : []),
              ...(category !== ALL_CATEGORIES && selectedCategory
                ? [
                    {
                      key: "category",
                      label: m.store.categoryFilter(
                        localizedCategoryName(selectedCategory, locale),
                      ),
                      onRemove: () => setCategory(ALL_CATEGORIES),
                    },
                  ]
                : []),
            ]}
            onClearFilters={resetFilters}
            sheet={{
              activeCount: category === ALL_CATEGORIES ? 0 : 1,
              previewCount: categoryCounts.get(draftCategory) ?? 0,
              canReset: draftCategory !== ALL_CATEGORIES,
              onOpen: () => setDraftCategory(category),
              onApply: () => setCategory(draftCategory),
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
                      },
                      ...categories.map((item) => ({
                        code: item.code,
                        name: localizedCategoryName(item, locale),
                        icon: categoryIcons[item.icon] ?? LayoutGrid,
                      })),
                    ].map((option) => {
                      const Icon = option.icon;
                      return (
                        <label key={option.code} className="filter-option">
                          <input
                            className="sr-only"
                            type="radio"
                            name="catalog-category"
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
                            {categoryCounts.get(option.code) ?? 0}
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
            }}
          />

          {filteredProducts.length ? (
            <>
              <div className="product-grid">
                {visibleProducts.map((product) => (
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
                    {m.store.showing(
                      visibleProducts.length,
                      filteredProducts.length,
                    )}
                  </p>
                  <button
                    type="button"
                    className="catalog-more-button"
                    onClick={() => {
                      const count = visibleCount + CATALOG_BATCH;
                      setBatch({ key: filterKey, count });
                      if (readFiltersFromUrl) {
                        const url = new URL(window.location.href);
                        url.searchParams.set("shown", String(count));
                        window.history.replaceState(
                          window.history.state,
                          "",
                          url,
                        );
                      }
                    }}
                  >
                    {m.store.showMore(Math.min(remaining, CATALOG_BATCH))}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state" role="status">
              <PackageSearch aria-hidden="true" />
              <h3>{m.store.noResults}</h3>
              <p>{m.store.noResultsHint}</p>
              <button type="button" onClick={resetFilters}>
                {m.store.showAllProducts}
              </button>
            </div>
          )}
        </section>
      </main>
      <MobileNavigation />
    </>
  );
}
