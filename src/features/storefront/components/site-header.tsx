"use client";

import { Heart, Menu, Search, ShoppingBag, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useCart } from "@/features/cart/cart-provider";
import { splitLocalePath } from "@/i18n/config";
import { useI18n } from "@/i18n/i18n-provider";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import { Link } from "@/i18n/link";

import { BrandLogo } from "./brand-logo";
import { useNavigationCategories } from "./store-navigation";

const HEADER_CATEGORY_LIMIT = 6;

/** A plain search for pages without the live catalog; it lands on the home page with the query. */
function HeaderSearchForm() {
  const { m, href } = useI18n();
  return (
    <form className="search-wrap" action={href("/")} role="search">
      <label htmlFor="header-search" className="sr-only">
        {m.store.searchLabel}
      </label>
      <Search aria-hidden="true" />
      <input
        id="header-search"
        name="q"
        type="search"
        enterKeyHint="search"
        placeholder={m.store.searchPlaceholder}
        autoComplete="off"
      />
    </form>
  );
}

export function SiteHeader({ search }: { search?: ReactNode }) {
  const { count } = useCart();
  const { m } = useI18n();
  const pathname = splitLocalePath(usePathname() ?? "/").path;
  const categories = useNavigationCategories();
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="site-header">
      <div className="header-bar page-shell">
        <Link
          href="/categories"
          className="header-icon header-menu"
          aria-label={m.store.allCategories}
        >
          <Menu aria-hidden="true" />
        </Link>
        <BrandLogo />
        <div className="header-search">{search ?? <HeaderSearchForm />}</div>
        <nav className="header-actions" aria-label={m.store.accountAndCart}>
          <LanguageSwitcher className="header-language" />
          <Link
            href="/account"
            className="header-action header-action-wide"
            aria-current={isCurrent("/account") ? "page" : undefined}
          >
            <UserRound aria-hidden="true" />
            <span>{m.common.account}</span>
          </Link>
          <Link
            href="/favorites"
            className="header-action header-action-wide"
            aria-current={isCurrent("/favorites") ? "page" : undefined}
          >
            <Heart aria-hidden="true" />
            <span>{m.common.favorites}</span>
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
              {m.common.cart}
            </span>
            <span className="sr-only" aria-live="polite">
              {m.store.cartCount(count)}
            </span>
          </Link>
        </nav>
      </div>

      <nav className="desktop-navigation" aria-label={m.store.mainNavigation}>
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
            {m.common.categories}
          </Link>
          {categories.slice(0, HEADER_CATEGORY_LIMIT).map((category) => {
            const href = `/categories/${encodeURIComponent(category.code)}`;
            return (
              <Link
                key={category.code}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
              >
                {category.name}
              </Link>
            );
          })}
          <Link
            href="/offers"
            className="desktop-navigation-offers"
            aria-current={isCurrent("/offers") ? "page" : undefined}
          >
            {m.common.offers}
          </Link>
        </div>
      </nav>
    </header>
  );
}
