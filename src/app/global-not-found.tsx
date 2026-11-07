import type { Metadata } from "next";

import { BrandSymbol } from "@/features/storefront/components/brand-logo";
import { messagesFor } from "@/i18n/messages";

import { baseMetadata } from "./base-metadata";

import "./globals.css";

// Unmatched addresses (mostly scanners and stale links) get one fully static page: no catalog, no
// database, no request data. The language is unknown here, so it speaks both.
const ar = messagesFor("ar");
const en = messagesFor("en");

export const metadata: Metadata = {
  ...baseMetadata,
  title: `${ar.meta.notFoundTitle} | MAYTHA MARKET`,
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="ar" dir="rtl">
      <body className="storefront-font-scope">
        <main className="placeholder-page page-shell">
          <div className="placeholder-panel status-panel">
            <BrandSymbol className="status-brand-symbol" />
            <p className="status-code" aria-hidden="true">
              404
            </p>
            <h1>{ar.misc.notFoundHeading}</h1>
            <p>{ar.misc.notFoundText}</p>
            <p lang="en" dir="ltr">
              {en.misc.notFoundText}
            </p>
            {/* Plain links: this page is served outside every layout, so a full load is right. */}
            <div className="status-actions">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/">{ar.misc.backToStore}</a>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/en" lang="en" dir="ltr" className="status-secondary">
                {en.misc.backToStore}
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
