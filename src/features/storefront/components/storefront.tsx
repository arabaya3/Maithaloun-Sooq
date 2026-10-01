"use client";

import {
  Bath,
  Brush,
  CookingPot,
  House,
  LayoutGrid,
  PackageSearch,
  Search,
  WashingMachine,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { ProductCard } from "@/features/catalog/components/product-card";
import {
  categories,
  type CategoryId,
  type Product,
} from "@/features/catalog/domain/product";
import { filterProducts } from "@/features/catalog/domain/product-search";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { Hero } from "@/features/storefront/components/hero";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { formatProductCount } from "@/shared/lib/format-product-count";

const categoryIcons: Record<CategoryId, LucideIcon> = {
  all: LayoutGrid,
  laundry: WashingMachine,
  kitchen: CookingPot,
  bathroom: Bath,
  tools: Brush,
  home: House,
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
  selected,
  onSelect,
}: {
  selected: CategoryId;
  onSelect: (category: CategoryId) => void;
}) {
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
        {categories.map((category) => {
          const active = selected === category.id;
          const Icon = categoryIcons[category.id];
          return (
            <button
              key={category.id}
              type="button"
              className="category-item"
              data-category-id={category.id}
              data-active={active}
              aria-pressed={active}
              onClick={() => onSelect(category.id)}
            >
              <span className="category-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="category-label">{category.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Storefront({ products }: { products: readonly Product[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId>("all");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(
    () => filterProducts(products, { query, categoryId: category }),
    [category, products, query],
  );
  const selectedCategory = categories.find((item) => item.id === category);
  const hasActiveFilter = Boolean(query.trim()) || category !== "all";

  useEffect(() => {
    if (window.location.hash === "#product-search") {
      searchInputRef.current?.focus();
    }
  }, []);

  const resetFilters = () => {
    setQuery("");
    setCategory("all");
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
        <CategoryPicker selected={category} onSelect={setCategory} />
        {hasActiveFilter ? (
          <div className="active-filter-summary" role="status">
            <span>
              {query.trim() ? `البحث: ${query.trim()}` : null}
              {query.trim() && category !== "all" ? "، " : null}
              {category !== "all"
                ? `الفئة: ${selectedCategory?.label ?? ""}`
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
            <div className="product-grid">
              {filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
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
