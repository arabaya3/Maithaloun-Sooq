import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ProductCard } from "@/features/catalog/components/product-card";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { formatProductCount } from "@/shared/lib/format-product-count";

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
  const name = decode((await params).name);
  return { title: name || "الماركة غير موجودة" };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  await connection();
  const name = decode((await params).name);
  const products = name
    ? (await productRepository.list()).filter(
        (product) => product.brand?.trim() === name,
      )
    : [];
  // Only brands that have products on sale resolve.
  if (!products.length) notFound();

  return (
    <>
      <SiteHeader />
      <main className="page-shell listing-page">
        <nav aria-label="مسار التصفح" className="category-breadcrumb">
          <Link href="/brands">
            <ArrowRight aria-hidden="true" />
            كل الماركات
          </Link>
        </nav>
        <div className="listing-heading">
          <h1>
            <bdi dir="auto">{name}</bdi>
          </h1>
          <span className="results-count">
            {formatProductCount(products.length)}
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
