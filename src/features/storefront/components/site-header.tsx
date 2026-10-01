"use client";

import { MapPin, Search, ShoppingCart, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RefObject } from "react";

import { useCart } from "@/features/cart/cart-provider";

import { BrandLogo } from "./brand-logo";

const desktopNavigation = [
  { href: "/", label: "الرئيسية" },
  { href: "/categories", label: "الأقسام" },
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
  const pathname = usePathname() ?? "";
  const hasSearch = searchQuery !== undefined && onSearchChange !== undefined;

  return (
    <header className="site-header">
      <div className="header-bar page-shell">
        {hasSearch ? (
          <button
            type="button"
            className="header-icon search-trigger"
            aria-label="البحث عن منتج"
            onClick={() => {
              searchInputRef?.current?.focus();
              searchInputRef?.current?.scrollIntoView({ block: "center" });
            }}
          >
            <Search aria-hidden="true" />
          </button>
        ) : (
          <Link
            href="/#product-search"
            className="header-icon search-trigger"
            aria-label="البحث عن منتج"
          >
            <Search aria-hidden="true" />
          </Link>
        )}

        <BrandLogo />

        <nav className="desktop-navigation" aria-label="التنقل الرئيسي">
          {desktopNavigation.map((item) => {
            const current =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link href="/cart" className="header-icon cart-button">
          <ShoppingCart aria-hidden="true" />
          <span className="sr-only" aria-live="polite">
            السلة، عدد المنتجات {count}
          </span>
          {count > 0 ? (
            <span className="cart-count" aria-hidden="true">
              {count}
            </span>
          ) : null}
        </Link>
      </div>

      {hasSearch ? null : (
        <p className="delivery-indicator page-shell">
          <MapPin aria-hidden="true" />
          توصيل داخل ميثلون · الدفع عند الاستلام
        </p>
      )}

      {hasSearch ? (
        <div className="search-row page-shell">
          <div className="search-wrap">
            <label htmlFor="product-search" className="sr-only">
              ابحث في المنتجات
            </label>
            <Search aria-hidden="true" />
            <input
              ref={searchInputRef}
              id="product-search"
              type="search"
              enterKeyHint="search"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="ابحث عن منظف، معطر، فرشاة…"
              autoComplete="off"
            />
            {searchQuery ? (
              <button
                type="button"
                className="clear-search"
                aria-label="مسح البحث"
                onClick={() => {
                  onSearchChange("");
                  searchInputRef?.current?.focus();
                }}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
