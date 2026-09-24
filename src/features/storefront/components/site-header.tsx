"use client";

import { Leaf, MapPin, Search, ShoppingBasket, X } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";

import { useCart } from "@/features/cart/cart-provider";
import { formatProductCount } from "@/shared/lib/format-product-count";

const desktopNavigation = [
  { href: "/", label: "الرئيسية" },
  { href: "/categories", label: "الفئات" },
  { href: "/offers", label: "العروض" },
  { href: "/account", label: "حسابي" },
];

export function SiteHeader({
  searchQuery,
  onSearchChange,
  searchInputRef,
}: {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { count } = useCart();
  const hasSearch = searchQuery !== undefined && onSearchChange !== undefined;

  return (
    <header className="site-header">
      <div className="header-layout page-shell" data-has-search={hasSearch}>
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
          {desktopNavigation.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        {hasSearch ? (
          <div className="search-wrap">
            <label htmlFor="product-search">ابحث في منتجات التنظيف</label>
            <Search aria-hidden="true" />
            <input
              ref={searchInputRef}
              id="product-search"
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="ابحث عن منتج..."
              autoComplete="off"
            />
            {searchQuery ? (
              <button
                type="button"
                className="clear-search"
                aria-label="مسح البحث"
                onClick={() => onSearchChange("")}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="header-actions">
          <p className="delivery-indicator" aria-label="منطقة التوصيل">
            <MapPin aria-hidden="true" />
            <span>التوصيل داخل ميثلون</span>
          </p>
          <Link
            href="/cart"
            className="cart-button"
            aria-label={`السلة، ${formatProductCount(count)}`}
          >
            <ShoppingBasket aria-hidden="true" />
            <span className="cart-count" aria-live="polite">
              {count}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
