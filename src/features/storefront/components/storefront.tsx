"use client";

import { LayoutGrid, PackageSearch, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { categoryIcons } from "@/features/catalog/components/category-icons";
import { ProductCard } from "@/features/catalog/components/product-card";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  ALL_CATEGORIES,
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import type { CategoryId, Product } from "@/features/catalog/domain/product";
import { filterProducts } from "@/features/catalog/domain/product-search";
import {
  sortProducts,
  type ProductSort,
} from "@/features/catalog/domain/product-sort";
import { CatalogToolbar } from "@/features/storefront/components/catalog-toolbar";
import { Hero } from "@/features/storefront/components/hero";
import {
  BestSellers,
  EditorialBanners,
  FeaturedBrands,
  StoreBenefits,
} from "@/features/storefront/components/home-sections";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import {
  categoryCovers,
  type CatalogBrand,
} from "@/features/storefront/domain/home-merchandising";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

// The first batch keeps the phone page short; more is one tap away, never on scroll.
export const CATALOG_BATCH = 12;

export interface HomeMerchandising {
  heroProducts: readonly Product[];
  brands: readonly CatalogBrand[];
  bestSellers: readonly Product[];
}

const emptyMerchandising: HomeMerchandising = {
  heroProducts: [],
  brands: [],
  bestSellers: [],
};

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
  selected,
  onSelect,
}: {
  categories: readonly ProductCategory[];
  covers: ReadonlyMap<string, Product>;
  selected: CategoryId;
  onSelect: (category: CategoryId) => void;
}) {
  const { m, locale } = useI18n();
  const options = [
    { code: ALL_CATEGORIES, name: m.store.allFilter, icon: "grid" as const },
    ...categories.map((category) => ({
      code: category.code,
      name: localizedCategoryName(category, locale),
      icon: category.icon,
    })),
  ];
  return (
    <section className="categories-section" aria-labelledby="categories-title">
      <div className="home-section-heading">
        <h2 id="categories-title">{m.store.shopByCategory}</h2>
        <Link href="/categories" className="home-section-link">
          {m.store.allCategories}
        </Link>
      </div>
      <div
        className="category-list"
        role="group"
        aria-labelledby="categories-title"
      >
        {options.map((category) => {
          const active = selected === category.code;
          const Icon = categoryIcons[category.icon] ?? LayoutGrid;
          const cover = covers.get(category.code);
          return (
            <button
              key={category.code}
              type="button"
              className="category-item"
              data-category-id={category.code}
              data-active={active}
              aria-pressed={active}
              onClick={() => onSelect(category.code)}
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
                    sizes="112px"
                  />
                ) : (
                  <Icon />
                )}
              </span>
              <span className="category-label">{category.name}</span>
            </button>
          );
        })}
      </div>
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
  if (sort === "featured") url.searchParams.delete("sort");
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
  initialSort = "featured",
  merchandising = emptyMerchandising,
}: {
  products: readonly Product[];
  categories: readonly ProductCategory[];
  initialCategory?: CategoryId;
  initialQuery?: string;
  initialSort?: ProductSort;
  merchandising?: HomeMerchandising;
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const covers = useMemo(() => categoryCovers(products), [products]);

  const filteredProducts = useMemo(
    () =>
      sortProducts(
        filterProducts(products, { query, categoryId: category }),
        sort,
      ),
    [category, products, query, sort],
  );
  const filterKey = `${category}|${query.trim()}|${sort}`;
  const [batch, setBatch] = useState({ key: filterKey, count: CATALOG_BATCH });
  // A new search or category starts again from the first batch.
  const visibleCount = batch.key === filterKey ? batch.count : CATALOG_BATCH;
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
        {hasActiveFilter ? (
          <h1 className="sr-only">{m.store.shopHeading}</h1>
        ) : (
          <Hero products={merchandising.heroProducts} />
        )}
        <CategoryPicker
          categories={categories}
          covers={covers}
          selected={category}
          onSelect={setCategory}
        />
        {hasActiveFilter ? null : (
          <>
            <FeaturedBrands brands={merchandising.brands} />
            <BestSellers products={merchandising.bestSellers} />
            <EditorialBanners categories={categories} />
          </>
        )}
        <section
          id="catalog"
          className="catalog-section"
          aria-labelledby="catalog-title"
        >
          <div className="home-section-heading catalog-heading">
            <h2 id="catalog-title">
              {hasActiveFilter ? m.store.searchResults : m.store.allProducts}
            </h2>
          </div>
          <CatalogToolbar
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
              onApply: () => setCategory(draftCategory),
              onReset: () => setDraftCategory(ALL_CATEGORIES),
              content: (
                <fieldset className="filter-sheet-group">
                  <legend>{m.store.categoryHeading}</legend>
                  <div className="filter-sheet-options">
                    {[
                      { code: ALL_CATEGORIES, name: m.store.allFilter },
                      ...categories.map((item) => ({
                        code: item.code,
                        name: localizedCategoryName(item, locale),
                      })),
                    ].map((option) => (
                      <button
                        key={option.code}
                        type="button"
                        className="filter-option"
                        aria-pressed={draftCategory === option.code}
                        onClick={() => setDraftCategory(option.code)}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ),
            }}
          />

          {filteredProducts.length ? (
            <>
              <div className="product-grid">
                {visibleProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
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
                    onClick={() =>
                      setBatch({
                        key: filterKey,
                        count: visibleCount + CATALOG_BATCH,
                      })
                    }
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
        {hasActiveFilter ? null : <StoreBenefits />}
      </main>
      <MobileNavigation />
    </>
  );
}
