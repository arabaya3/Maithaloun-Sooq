import type { Metadata } from "next";
import { connection } from "next/server";

import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { BrandMark } from "@/features/storefront/components/brand-mark";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import {
  brandPath,
  catalogBrands,
} from "@/features/storefront/domain/home-merchandising";
import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: m.meta.brandsTitle, description: m.meta.brandsDescription };
}

export default async function BrandsPage() {
  await connection();
  const [products, m] = await Promise.all([
    productRepository.list(),
    getMessages(),
  ]);
  const brands = catalogBrands(products);

  return (
    <>
      <SiteHeader />
      <main className="page-shell listing-page">
        <div className="listing-heading">
          <span className="eyebrow">MAYTHA MARKET</span>
          <h1>{m.common.brands}</h1>
        </div>
        {brands.length ? (
          <ul className="brand-directory">
            {brands.map((brand) => (
              <li key={brand.name}>
                <Link href={brandPath(brand.name)} className="brand-tile">
                  <span className="brand-tile-mark">
                    <BrandMark name={brand.name} />
                  </span>
                  <small>{m.common.productCount(brand.productCount)}</small>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state" role="status">
            <h2>{m.store.noBrands}</h2>
            <Link href="/categories">{m.store.browseCategories}</Link>
          </div>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
