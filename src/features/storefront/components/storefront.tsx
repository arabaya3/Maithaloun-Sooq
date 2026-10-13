"use client";

import { LayoutGrid, PackageSearch, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { categoryIcons } from "@/features/catalog/components/category-icons";
import { ProductCard } from "@/features/catalog/components/product-card";
import {
  ALL_CATEGORIES,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import type { CategoryId, Product } from "@/features/catalog/domain/product";
import { filterProducts } from "@/features/catalog/domain/product-search";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { Hero } from "@/features/storefront/components/hero";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { formatProductCount } from "@/shared/lib/format-product-count";

// The first batch keeps the phone page short; more is one tap away, never on scroll.
export const CATALOG_BATCH = 12;

function ProductSearch({
  query,
  onChange,
  inputRef,
}: {
  query: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="search-wrap">
      <label htmlFor="product-search" className="sr-only">
        ابحث في المنتجات
      </label>
      <Search aria-hidden="true" />
      <input
        ref={inputRef}
        id="product-search"
        type="search"
        enterKeyHint="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="ابحث عن منظف، معطر، فرشاة…"
        autoComplete="off"
      />
      {query ? (
        <button
          type="button"
          className="clear-search"
          aria-label="مسح البحث"
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
  const options = [
    { code: ALL_CATEGORIES, nameAr: "الكل", icon: "grid" as const },
    ...categories,
  ];
  return (
    <section className="categories-section" aria-labelledby="categories-title">
      <h2 id="categories-title" className="sr-only">
        الأقسام
      </h2>
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
              <span className="category-label">{category.nameAr}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Storefront({
  products,
  categories,
  initialCategory = ALL_CATEGORIES,
}: {
  products: readonly Product[];
  categories: readonly ProductCategory[];
  initialCategory?: CategoryId;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategoryState] = useState<CategoryId>(initialCategory);
  // The chosen category lives in the address, so it can be shared and survives a reload.
  const setCategory = (code: CategoryId) => {
    setCategoryState(code);
    const url = new URL(window.location.href);
    if (code === ALL_CATEGORIES) url.searchParams.delete("category");
    else url.searchParams.set("category", code);
    window.history.replaceState(window.history.state, "", url);
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
    setQuery("");
    setCategory(ALL_CATEGORIES);
    queueMicrotask(() => searchInputRef.current?.focus());
  };

  return (
    <>
      <SiteHeader searchInputRef={searchInputRef} />
      <main className="page-shell storefront-main">
        <section className="welcome" aria-labelledby="welcome-title">
          <h1 id="welcome-title">أهلًا! شو ناقص البيت اليوم؟</h1>
          <ProductSearch
            query={query}
            onChange={setQuery}
            inputRef={searchInputRef}
          />
        </section>
        <Hero />
        <CategoryPicker
          categories={categories}
          selected={category}
          onSelect={setCategory}
        />
        {hasActiveFilter ? (
          <div className="active-filter-summary" role="status">
            <span>
              {query.trim() ? `البحث: ${query.trim()}` : null}
              {query.trim() && category !== ALL_CATEGORIES ? "، " : null}
              {category !== ALL_CATEGORIES
                ? `الفئة: ${selectedCategory?.nameAr ?? ""}`
                : null}
            </span>
            <button type="button" onClick={resetFilters}>
              مسح عوامل التصفية
            </button>
          </div>
        ) : null}
        <section
          id="catalog"
          className="catalog-section"
          aria-labelledby="catalog-title"
        >
          <div className="section-heading catalog-heading">
            <h2 id="catalog-title">
              {hasActiveFilter ? "نتائج البحث" : "اختيارات للبيت"}
            </h2>
            <span className="results-count" aria-live="polite">
              {formatProductCount(filteredProducts.length)}
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
                    يظهر {visibleProducts.length} من {filteredProducts.length}
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
                    عرض المزيد ({Math.min(remaining, CATALOG_BATCH)})
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state" role="status">
              <PackageSearch aria-hidden="true" />
              <h3>لا توجد نتائج مطابقة</h3>
              <p>جرّب عبارة بحث أخرى أو اختر فئة مختلفة.</p>
              <button type="button" onClick={resetFilters}>
                عرض كل المنتجات
              </button>
            </div>
          )}
        </section>
      </main>
      <MobileNavigation />
    </>
  );
}
