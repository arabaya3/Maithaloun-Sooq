import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import {
  FREE_DELIVERY_THRESHOLD_AGOROT,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "@/features/delivery/delivery-policy";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { formatWhatsAppDisplay } from "@/features/orders/domain/phone";
import { whatsAppChatUrl } from "@/features/orders/domain/whatsapp-order";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { infoPages, type InfoPageKey } from "@/features/storefront/info-pages";
import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";
import { formatIls } from "@/shared/lib/format-currency";

export async function infoPageMetadata(key: InfoPageKey): Promise<Metadata> {
  const page = (await getMessages()).info[key];
  return { title: page.title, description: page.description };
}

export async function InfoPage({ pageKey }: { pageKey: InfoPageKey }) {
  await connection();
  const [m, storeNumber] = await Promise.all([
    getMessages(),
    storeContactService.whatsAppNumber(),
  ]);
  const page = m.info[pageKey];
  // The one store number lives in Admin settings; without it the order conversation is the channel.
  const chatUrl = storeNumber ? whatsAppChatUrl(storeNumber) : null;
  const display = storeNumber ? formatWhatsAppDisplay(storeNumber) : null;
  const contact =
    chatUrl && display
      ? m.info.contactByNumber(display)
      : m.info.contactByConversation;
  // Amounts come from the delivery policy itself, so the page can never disagree with checkout.
  const fill = (text: string) =>
    text
      .replace("{free}", formatIls(FREE_DELIVERY_THRESHOLD_AGOROT))
      .replace("{fee}", formatIls(STANDARD_DELIVERY_FEE_AGOROT))
      .replace("{contact}", contact);

  return (
    <>
      <SiteHeader />
      <main className="page-shell info-page">
        <article className="info-article" aria-labelledby="info-title">
          <span className="eyebrow">MAYTHA MARKET</span>
          <h1 id="info-title">{page.title}</h1>
          {pageKey === "contact" && chatUrl && display ? (
            <section
              className="info-whatsapp"
              aria-labelledby="info-whatsapp-title"
            >
              <h2 id="info-whatsapp-title">{m.info.officialWhatsAppTitle}</h2>
              <p>{m.info.officialWhatsAppText}</p>
              <p className="info-whatsapp-number">
                <bdi dir="ltr">{display}</bdi>
              </p>
              <a
                className="info-cta"
                href={chatUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle aria-hidden="true" />
                {m.info.whatsappCta}
              </a>
            </section>
          ) : null}
          {page.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{fill(paragraph)}</p>
              ))}
            </section>
          ))}
          {pageKey === "contact" && !chatUrl ? (
            <p className="info-note">{m.info.whatsappUnavailable}</p>
          ) : null}
        </article>
        <nav className="info-links" aria-label={m.info.pagesLabel}>
          {infoPages.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={item.key === pageKey ? "page" : undefined}
            >
              {m.info[item.key].title}
            </Link>
          ))}
        </nav>
      </main>
      <MobileNavigation />
    </>
  );
}
