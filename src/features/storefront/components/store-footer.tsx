"use client";

import { MessageCircle } from "lucide-react";

import { formatWhatsAppDisplay } from "@/features/orders/domain/phone";
import { whatsAppChatUrl } from "@/features/orders/domain/whatsapp-order";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

import { infoPages } from "@/features/storefront/info-pages";

import { BrandWordmark } from "./brand-logo";

export function StoreFooter({
  storeWhatsApp = null,
}: {
  storeWhatsApp?: string | null;
}) {
  const { m } = useI18n();
  const chatUrl = storeWhatsApp ? whatsAppChatUrl(storeWhatsApp) : null;
  const links = infoPages.filter(
    ({ key }) => key !== "about" && (key !== "contact" || !chatUrl),
  );
  return (
    <footer className="store-footer">
      <div className="store-footer-inner page-shell">
        <span className="brand-lockup store-footer-wordmark" dir="ltr">
          <BrandWordmark />
        </span>
        <nav className="store-footer-links" aria-label={m.info.pagesLabel}>
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {m.info[link.key].title}
            </Link>
          ))}
        </nav>
        {chatUrl && storeWhatsApp ? (
          <div className="store-footer-bottom">
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
          </div>
        ) : null}
      </div>
    </footer>
  );
}
