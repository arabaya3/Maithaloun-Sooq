"use client";

import { useI18n } from "@/i18n/i18n-provider";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import { Link } from "@/i18n/link";

import { infoPages } from "@/features/storefront/info-pages";

import { BrandWordmark } from "./brand-logo";

export function StoreFooter() {
  const { m } = useI18n();
  const links = [
    { href: "/categories", label: m.common.categories },
    { href: "/brands", label: m.common.brands },
    { href: "/offers", label: m.common.offers },
    { href: "/favorites", label: m.common.favorites },
    { href: "/account", label: m.common.account },
    { href: "/cart", label: m.common.cart },
  ];
  return (
    <footer className="store-footer">
      <div className="store-footer-inner page-shell">
        <div className="store-footer-identity">
          <BrandWordmark className="store-footer-wordmark" />
          <p className="store-footer-note">{m.common.trustLine}</p>
          <p className="store-footer-note">{m.common.deliveryAndCash}</p>
        </div>
        <nav className="store-footer-links" aria-label={m.store.storeLinks}>
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
          <LanguageSwitcher />
        </nav>
        <nav className="store-footer-links" aria-label={m.info.pagesLabel}>
          {infoPages.map((link) => (
            <Link key={link.href} href={link.href}>
              {m.info[link.key].title}
            </Link>
          ))}
        </nav>
        <p className="store-footer-attribution">{m.store.managedBy}</p>
      </div>
    </footer>
  );
}
