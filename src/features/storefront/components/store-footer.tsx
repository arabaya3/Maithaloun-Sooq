"use client";

import { MessageCircle } from "lucide-react";

import { formatWhatsAppDisplay } from "@/features/orders/domain/phone";
import { whatsAppChatUrl } from "@/features/orders/domain/whatsapp-order";
import { useI18n } from "@/i18n/i18n-provider";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import { Link } from "@/i18n/link";

import { infoPages } from "@/features/storefront/info-pages";

import { BrandLogoTile, BrandWordmark } from "./brand-logo";

export function StoreFooter({
  storeWhatsApp = null,
}: {
  storeWhatsApp?: string | null;
}) {
  const { m } = useI18n();
  const chatUrl = storeWhatsApp ? whatsAppChatUrl(storeWhatsApp) : null;
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
          <span className="brand-lockup store-footer-wordmark" dir="ltr">
            <BrandLogoTile decorative className="store-footer-logo" />
            <BrandWordmark />
          </span>
          <p className="store-footer-note">{m.common.trustLine}</p>
        </div>
        <nav className="store-footer-links" aria-label={m.store.storeLinks}>
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <nav className="store-footer-links" aria-label={m.info.pagesLabel}>
          {infoPages.map((link) => (
            <Link key={link.href} href={link.href}>
              {m.info[link.key].title}
            </Link>
          ))}
        </nav>
        <div className="store-footer-bottom">
          {chatUrl && storeWhatsApp ? (
            <a
              className="store-footer-whatsapp"
              href={chatUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${m.info.whatsappCta}: ${formatWhatsAppDisplay(storeWhatsApp)}`}
            >
              <MessageCircle aria-hidden="true" />
              <span>{m.info.whatsappCta}</span>
              <bdi dir="ltr">{formatWhatsAppDisplay(storeWhatsApp)}</bdi>
            </a>
          ) : null}
          <div className="store-footer-meta">
            <p className="store-footer-attribution">{m.store.managedBy}</p>
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </footer>
  );
}
