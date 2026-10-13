import { BadgePercent } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ProductCard } from "@/features/catalog/components/product-card";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { productsOnOffer } from "@/features/storefront/domain/home-merchandising";
import { formatProductCount } from "@/shared/lib/format-product-count";

export const metadata: Metadata = {
  title: "العروض",
  description: "المنتجات التي عليها عروض حالية في MAYTHA.",
};

export default async function OffersPage() {
  await connection();
  const products = productsOnOffer(await productRepository.list());

  return (
    <>
      <SiteHeader />
      <main className="page-shell listing-page">
        <div className="listing-heading">
          <span className="eyebrow">MAYTHA</span>
          <h1>العروض</h1>
          <span className="results-count">
            {formatProductCount(products.length)}
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
            <h2>لا توجد عروض حالياً</h2>
            <p>عد لاحقاً للاطلاع على الجديد.</p>
            <Link href="/">العودة إلى الرئيسية</Link>
          </div>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
