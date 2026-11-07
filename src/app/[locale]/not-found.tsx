import type { Metadata } from "next";

import { BrandSymbol } from "@/features/storefront/components/brand-logo";
import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";

// Rendered when a storefront page calls notFound(). It reads only the route's language: no catalog.
export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: m.meta.notFoundTitle };
}

export default async function NotFoundPage() {
  const { misc, store } = await getMessages();
  return (
    <main className="placeholder-page page-shell">
      <div className="placeholder-panel status-panel">
        <BrandSymbol className="status-brand-symbol" />
        <p className="status-code" aria-hidden="true">
          404
        </p>
        <h1>{misc.notFoundHeading}</h1>
        <p>{misc.notFoundText}</p>
        <div className="status-actions">
          <Link href="/">{misc.backToStore}</Link>
          <Link href="/categories" className="status-secondary">
            {store.browseCategories}
          </Link>
        </div>
      </div>
    </main>
  );
}
