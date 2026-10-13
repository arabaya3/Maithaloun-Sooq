import type { Metadata } from "next";
import { connection } from "next/server";

import {
  FREE_DELIVERY_THRESHOLD_AGOROT,
  STANDARD_DELIVERY_FEE_AGOROT,
} from "@/features/delivery/delivery-policy";
import { storeContactService } from "@/features/orders/application/order-service-instance";
import { whatsAppLinks } from "@/features/orders/domain/whatsapp-order";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";
import { formatIls } from "@/shared/lib/format-currency";

import { infoPages, type InfoPageKey } from "@/features/storefront/info-pages";

// Amounts come from the delivery policy itself, so the page can never disagree with checkout.
function fill(text: string) {
  return text
    .replace("{free}", formatIls(FREE_DELIVERY_THRESHOLD_AGOROT))
    .replace("{fee}", formatIls(STANDARD_DELIVERY_FEE_AGOROT));
}

export async function infoPageMetadata(key: InfoPageKey): Promise<Metadata> {
  const page = (await getMessages()).info[key];
  return { title: page.title, description: page.description };
}

export async function InfoPage({ pageKey }: { pageKey: InfoPageKey }) {
  await connection();
  const m = await getMessages();
  const page = m.info[pageKey];
  const whatsapp =
    pageKey === "contact" ? await storeContactService.whatsAppNumber() : null;
  const links = whatsapp ? whatsAppLinks(whatsapp, "") : null;

  return (
    <>
      <SiteHeader />
      <main className="page-shell info-page">
        <article className="info-article" aria-labelledby="info-title">
          <span className="eyebrow">MAYTHA</span>
          <h1 id="info-title">{page.title}</h1>
          {page.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{fill(paragraph)}</p>
              ))}
            </section>
          ))}
          {pageKey === "contact" ? (
            links ? (
              <a className="info-cta" href={links.app}>
                {m.info.whatsappCta}
              </a>
            ) : (
              <p className="info-note">{m.info.whatsappUnavailable}</p>
            )
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
