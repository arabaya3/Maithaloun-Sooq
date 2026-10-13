"use client";

import { LayoutGrid, PackageSearch, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { categoryIcons } from "@/features/catalog/components/category-icons";
import { ProductCard } from "@/features/catalog/components/product-card";
import {
  ALL_CATEGORIES,
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import type { CategoryId, Product } from "@/features/catalog/domain/product";
import { filterProducts } from "@/features/catalog/domain/product-search";
import { Hero } from "@/features/storefront/components/hero";
import {
  BestSellers,
  FeaturedBrands,
  PromoBanners,
  StoreBenefits,
} from "@/features/storefront/components/home-sections";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import type { CatalogBrand } from "@/features/storefront/domain/home-merchandising";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

// The first batch keeps the phone page short; more is one tap away, never on scroll.
export const CATALOG_BATCH = 12;

export interface HomeMerchandising {
  heroProducts: readonly Product[];
  brands: readonly CatalogBrand[];
  bestSellers: readonly Product[];
  offerProducts: readonly Product[];
  featured: { category: ProductCategory; product: Product | null } | null;
}

const emptyMerchandising: HomeMerchandising = {
  heroProducts: [],
  brands: [],
  bestSellers: [],
  offerProducts: [],
  featured: null,
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
  selected,
  onSelect,
}: {
  categories: readonly ProductCategory[];
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
              <span className="category-icon" aria-hidden="true">
                <Icon />
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
function writeFiltersToUrl(category: CategoryId, query: string) {
  const url = new URL(window.location.href);
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
  merchandising = emptyMerchandising,
}: {
  products: readonly Product[];
  categories: readonly ProductCategory[];
  initialCategory?: CategoryId;
  initialQuery?: string;
  merchandising?: HomeMerchandising;
}) {
  const { m, locale } = useI18n();
  const [query, setQueryState] = useState(initialQuery);
  const [category, setCategoryState] = useState<CategoryId>(initialCategory);
  const setCategory = (code: CategoryId) => {
    setCategoryState(code);
    writeFiltersToUrl(code, query);
  };
  const setQuery = (value: string) => {
    setQueryState(value);
    writeFiltersToUrl(category, value);
  };
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(
    () => filterProducts(products, { query, categoryId: category }),
    [category, products, query],
  );
  const filterKey = `${category}|${query.trim()}`;
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
    writeFiltersToUrl(ALL_CATEGORIES, "");
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
          selected={category}
          onSelect={setCategory}
        />
        {hasActiveFilter ? (
          <div className="active-filter-summary" role="status">
            <span>
              {query.trim() ? m.store.searchQuery(query.trim()) : null}
              {query.trim() && category !== ALL_CATEGORIES ? " · " : null}
              {category !== ALL_CATEGORIES && selectedCategory
                ? m.store.categoryFilter(
                    localizedCategoryName(selectedCategory, locale),
                  )
                : null}
            </span>
            <button type="button" onClick={resetFilters}>
              {m.store.clearFilters}
            </button>
          </div>
        ) : (
          <>
            <FeaturedBrands brands={merchandising.brands} />
            <BestSellers products={merchandising.bestSellers} />
            <PromoBanners
              offerProducts={merchandising.offerProducts}
              featured={merchandising.featured}
            />
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
            <span className="results-count" aria-live="polite">
              {m.common.productCount(filteredProducts.length)}
            </span>
          </div>

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
