"use client";

import { Heart, Menu, Search, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useCart } from "@/features/cart/cart-provider";

import { BrandLogo } from "./brand-logo";
import { useNavigationCategories } from "./store-navigation";

const HEADER_CATEGORY_LIMIT = 6;

/** A plain search for pages without the live catalog; it lands on the home page with the query. */
function HeaderSearchForm() {
  return (
    <form className="search-wrap" action="/" role="search">
      <label htmlFor="header-search" className="sr-only">
        ابحث في المنتجات
      </label>
      <Search aria-hidden="true" />
      <input
        id="header-search"
        name="q"
        type="search"
        enterKeyHint="search"
        placeholder="ابحث عن منتج أو ماركة…"
        autoComplete="off"
      />
    </form>
  );
}

export function SiteHeader({ search }: { search?: ReactNode }) {
  const { count } = useCart();
  const pathname = usePathname() ?? "";
  const categories = useNavigationCategories();
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="site-header">
      <div className="header-bar page-shell">
        <Link
          href="/categories"
          className="header-icon header-menu"
          aria-label="كل الأقسام"
        >
          <Menu aria-hidden="true" />
        </Link>
        <BrandLogo />
        <div className="header-search">{search ?? <HeaderSearchForm />}</div>
        <nav className="header-actions" aria-label="حسابي والسلة">
          <Link
            href="/account"
            className="header-action header-action-wide"
            aria-current={isCurrent("/account") ? "page" : undefined}
          >
            <UserRound aria-hidden="true" />
            <span>حسابي</span>
          </Link>
          <Link
            href="/favorites"
            className="header-action header-action-wide"
            aria-current={isCurrent("/favorites") ? "page" : undefined}
          >
            <Heart aria-hidden="true" />
            <span>المفضلة</span>
          </Link>
          <Link href="/cart" className="header-action cart-button">
            <span className="cart-icon">
              <ShoppingBag aria-hidden="true" />
              {count > 0 ? (
                <span className="cart-count" aria-hidden="true">
                  {count}
                </span>
              ) : null}
            </span>
            <span className="header-action-label" aria-hidden="true">
              السلة
            </span>
            <span className="sr-only" aria-live="polite">
              السلة، عدد المنتجات {count}
            </span>
          </Link>
        </nav>
      </div>

      <nav className="desktop-navigation" aria-label="التنقل الرئيسي">
        <div className="page-shell desktop-navigation-row">
          <Link
            href="/categories"
            className="desktop-navigation-all"
            aria-current={
              pathname === "/categories"
                ? "page"
                : isCurrent("/categories")
                  ? "true"
                  : undefined
            }
          >
            <Menu aria-hidden="true" />
            الأقسام
          </Link>
          {categories.slice(0, HEADER_CATEGORY_LIMIT).map((category) => {
            const href = `/categories/${encodeURIComponent(category.code)}`;
            return (
              <Link
                key={category.code}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
              >
                {category.nameAr}
              </Link>
            );
          })}
          <Link
            href="/offers"
            className="desktop-navigation-offers"
            aria-current={isCurrent("/offers") ? "page" : undefined}
          >
            العروض
          </Link>
        </div>
      </nav>
    </header>
  );
}
