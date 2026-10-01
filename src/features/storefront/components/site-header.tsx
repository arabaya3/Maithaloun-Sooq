"use client";

import { MapPin, Search, ShoppingCart } from "lucide-react";
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
  searchInputRef,
}: {
  searchInputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { count } = useCart();
  const pathname = usePathname() ?? "";

  return (
    <header className="site-header">
      <div className="header-bar page-shell">
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

        <div className="header-actions">
          {searchInputRef ? (
            <button
              type="button"
              className="header-icon search-trigger"
              aria-label="البحث عن منتج"
              onClick={() => {
                searchInputRef.current?.focus();
                searchInputRef.current?.scrollIntoView({ block: "center" });
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
      </div>

      {searchInputRef ? null : (
        <p className="delivery-indicator page-shell">
          <MapPin aria-hidden="true" />
          توصيل داخل ميثلون · الدفع عند الاستلام
        </p>
      )}
    </header>
  );
}
