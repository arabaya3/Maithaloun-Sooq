import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ProductCard } from "@/features/catalog/components/product-card";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { brandLogo } from "@/features/storefront/brand-logos";
import { BrandMark } from "@/features/storefront/components/brand-mark";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const [name, m] = await Promise.all([
    params.then((value) => decode(value.name)),
    getMessages(),
  ]);
  return { title: name || m.meta.brandMissing };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  await connection();
  const [name, all, m] = await Promise.all([
    params.then((value) => decode(value.name)),
    productRepository.list(),
    getMessages(),
  ]);
  const products = name
    ? all.filter((product) => product.brand?.trim() === name)
    : [];
  // Only brands that have products on sale resolve.
  if (!products.length) notFound();

  return (
    <>
      <SiteHeader />
      <main className="page-shell listing-page">
        <nav aria-label={m.common.breadcrumb} className="category-breadcrumb">
          <Link href="/brands">
            <ArrowRight className="rtl-flip" aria-hidden="true" />
            {m.store.allBrandsBack}
          </Link>
        </nav>
        <div className="listing-heading">
          {name && brandLogo(name) ? (
            <span className="brand-page-logo">
              <BrandMark name={name} decorative />
            </span>
          ) : null}
          <h1>
            <bdi dir="auto">{name}</bdi>
          </h1>
          <span className="results-count">
            {m.common.productCount(products.length)}
          </span>
        </div>
        <div className="product-grid">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </main>
      <MobileNavigation />
    </>
  );
}
