"use client";

import {
  Bath,
  Grid2X2,
  Home,
  Leaf,
  MapPin,
  PackageSearch,
  Paintbrush,
  Search,
  ShoppingBasket,
  Sparkles,
  SprayCan,
  Tag,
  UserRound,
  WashingMachine,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ComponentType } from "react";

import { useCart } from "@/features/cart/cart-provider";
import { ProductCard } from "@/features/catalog/components/product-card";
import {
  categories,
  type CategoryId,
  type Product,
} from "@/features/catalog/domain/product";
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

const navigation = [
  { href: "/", label: "الرئيسية", icon: Home },
  { href: "/categories", label: "الفئات", icon: Grid2X2 },
  { href: "/offers", label: "العروض", icon: Tag },
  { href: "/account", label: "حسابي", icon: UserRound },
];

function SiteHeader({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const { count } = useCart();

  return (
    <header className="site-header">
      <div className="header-main page-shell">
        <Link className="brand" href="/" aria-label="سوق ميثلون، الرئيسية">
          <span className="brand-mark" aria-hidden="true">
            <Leaf />
          </span>
          <span>
            <strong>سوق ميثلون</strong>
            <small>احتياجات البيت في مكان واحد</small>
          </span>
        </Link>

        <nav className="desktop-navigation" aria-label="التنقل الرئيسي">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <button
            type="button"
            className="location-button"
            aria-label="اختيار منطقة التوصيل، الموقع غير محدد"
          >
            <MapPin aria-hidden="true" />
            <span>
              <strong>اختر منطقة التوصيل</strong>
              <small>الموقع غير محدد</small>
            </span>
          </button>
          <button
            type="button"
            className="cart-button"
            aria-label={`السلة، ${formatProductCount(count)}`}
          >
            <ShoppingBasket aria-hidden="true" />
            <span className="cart-count" aria-live="polite">
              {count}
            </span>
          </button>
        </div>
      </div>

      <div className="search-wrap page-shell">
        <label htmlFor="product-search">ابحث في منتجات التنظيف</label>
        <Search aria-hidden="true" />
        <input
          id="product-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="ابحث عن منتج..."
          autoComplete="off"
        />
        {query ? (
          <button
            type="button"
            className="clear-search"
            aria-label="مسح البحث"
            onClick={() => onQueryChange("")}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  );
}

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
        <span className="promo-brush">
          <Paintbrush />
        </span>
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

function MobileNavigation() {
  return (
    <nav className="mobile-navigation" aria-label="التنقل الرئيسي للهاتف">
      {navigation.map((item, index) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={index === 0 ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Storefront({ products }: { products: readonly Product[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId>("all");

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ar");
    return products.filter((product) => {
      const categoryMatches =
        category === "all" || product.categoryId === category;
      const searchMatches =
        !normalizedQuery ||
        product.name.toLocaleLowerCase("ar").includes(normalizedQuery);
      return categoryMatches && searchMatches;
    });
  }, [category, products, query]);

  return (
    <>
      <SiteHeader query={query} onQueryChange={setQuery} />
      <main className="page-shell storefront-main">
        <PromoBanner />
        <CategoryPicker selected={category} onSelect={setCategory} />
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
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
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
