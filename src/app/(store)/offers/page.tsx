import { BadgePercent } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { ProductCard } from "@/features/catalog/components/product-card";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { productsOnOffer } from "@/features/storefront/domain/home-merchandising";
import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: m.meta.offersTitle, description: m.meta.offersDescription };
}

export default async function OffersPage() {
  await connection();
  const [all, m] = await Promise.all([productRepository.list(), getMessages()]);
  const products = productsOnOffer(all);

  return (
    <>
      <SiteHeader />
      <main className="page-shell listing-page">
        <div className="listing-heading">
          <span className="eyebrow">MAYTHA</span>
          <h1>{m.common.offers}</h1>
          <span className="results-count">
            {m.common.productCount(products.length)}
          </span>
        </div>
        {products.length ? (
          <div className="product-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="empty-state" role="status">
            <BadgePercent aria-hidden="true" />
            <h2>{m.store.noOffers}</h2>
            <p>{m.store.noOffersHint}</p>
            <Link href="/">{m.common.backHome}</Link>
          </div>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
