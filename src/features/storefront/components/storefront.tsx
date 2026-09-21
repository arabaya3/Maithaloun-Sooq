"use client";

import {
  Bath,
  Grid2X2,
  Home,
  PackageSearch,
  Paintbrush,
  Sparkles,
  SprayCan,
  WashingMachine,
} from "lucide-react";
import { useMemo, useRef, useState, type ComponentType } from "react";

import { ProductCard } from "@/features/catalog/components/product-card";
import {
  categories,
  type CategoryId,
  type Product,
} from "@/features/catalog/domain/product";
import { filterProducts } from "@/features/catalog/domain/product-search";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { formatProductCount } from "@/shared/lib/format-product-count";

const categoryIcons: Record<
  CategoryId,
  ComponentType<{ "aria-hidden": true }>
> = {
  all: Grid2X2,
  laundry: WashingMachine,
  kitchen: SprayCan,
  bathroom: Bath,
  tools: Paintbrush,
  home: Home,
};

function PromoBanner() {
  return (
    <section className="promo-banner" aria-labelledby="promo-title">
      <div className="promo-copy">
        <span className="eyebrow">اختيارات البيت</span>
        <h1 id="promo-title">نظافة مرتبة، واحتياجات أقرب</h1>
        <p>
          تصفّح أساسيات التنظيف المنزلية بسهولة، واختر ما يلزمك من كتالوج واضح.
        </p>
        <a className="promo-cta" href="#catalog">
          تسوّق المنتجات
        </a>
      </div>
      <div className="promo-art" aria-hidden="true">
        <span className="sparkle sparkle-one">
          <Sparkles />
        </span>
        <span className="promo-bottle bottle-tall" />
        <span className="promo-bottle bottle-short" />
      </div>
    </section>
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
      <div className="section-heading">
        <div>
          <span className="eyebrow">تصفّح حسب الاستخدام</span>
          <h2 id="categories-title">الفئات</h2>
        </div>
      </div>
      <div className="category-list" role="list">
        {categories.map((category) => {
          const Icon = categoryIcons[category.id];
          const active = selected === category.id;
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
              <span className="category-icon">
                <Icon aria-hidden={true} />
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
        <PromoBanner />
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
            <div>
              <span className="eyebrow">منتجات منزلية مختارة</span>
              <h2 id="catalog-title">تسوّق المنتجات</h2>
            </div>
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
