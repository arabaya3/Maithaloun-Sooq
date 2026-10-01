"use client";

import {
  Bath,
  Brush,
  CookingPot,
  House,
  LayoutGrid,
  Leaf,
  PackageSearch,
  WashingMachine,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
              <span>{category.label}</span>
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
      <SiteHeader
        searchQuery={query}
        onSearchChange={setQuery}
        searchInputRef={searchInputRef}
      />
      <main className="page-shell storefront-main">
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
              <Leaf aria-hidden="true" />
              {hasActiveFilter ? "نتائج البحث" : "مختارات ميثلون"}
            </h2>
            <span className="results-count" aria-live="polite">
              {formatProductCount(filteredProducts.length)}
            </span>
          </div>

          {filteredProducts.length ? (
            <div className="product-grid">
              {filteredProducts.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  priority={index < 4}
                />
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
