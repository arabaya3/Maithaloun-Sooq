import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import {
  brandPath,
  catalogBrands,
} from "@/features/storefront/domain/home-merchandising";
import { formatProductCount } from "@/shared/lib/format-product-count";

export const metadata: Metadata = {
  title: "الماركات",
  description: "الماركات المتوفرة في MAYTHA.",
};

export default async function BrandsPage() {
  await connection();
  const brands = catalogBrands(await productRepository.list());

  return (
    <>
      <SiteHeader />
      <main className="page-shell listing-page">
        <div className="listing-heading">
          <span className="eyebrow">MAYTHA</span>
          <h1>الماركات</h1>
        </div>
        {brands.length ? (
          <ul className="brand-directory">
            {brands.map((brand) => (
              <li key={brand.name}>
                <Link href={brandPath(brand.name)} className="brand-tile">
                  <bdi dir="auto">{brand.name}</bdi>
                  <small>{formatProductCount(brand.productCount)}</small>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state" role="status">
            <h2>لم تُضف الماركات بعد</h2>
            <Link href="/categories">تصفّح الأقسام</Link>
          </div>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
