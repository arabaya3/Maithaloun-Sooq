import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ProductCard } from "@/features/catalog/components/product-card";
import { ProductDetailPanel } from "@/features/catalog/components/product-detail-panel";
import { getProductDisplayName } from "@/features/catalog/domain/product";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  await connection();
  const product = await productRepository.getBySlug((await params).slug);
  if (!product) notFound();

  return {
    title: getProductDisplayName(product),
    description:
      product.description ??
      `تفاصيل ${getProductDisplayName(product)} في سوق ميثلون.`,
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: ProductPageProps) {
  await connection();
  const product = await productRepository.getBySlug((await params).slug);
  if (!product) notFound();

  const variantParam = (await searchParams).variant;
  const initialVariantId = Array.isArray(variantParam)
    ? variantParam[0]
    : variantParam;

  const products = await productRepository.list();
  const relatedProducts = products
    .filter(
      (candidate) =>
        candidate.id !== product.id &&
        candidate.categoryId === product.categoryId,
    )
    .slice(0, 3);
  const name = getProductDisplayName(product);

  return (
    <>
      <SiteHeader />
      <main className="page-shell detail-page">
        <nav className="breadcrumb" aria-label="مسار التنقل">
          <Link href="/">الرئيسية</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">
            <bdi dir="auto">{name}</bdi>
          </span>
        </nav>

        <Link className="back-link" href="/">
          <ArrowRight aria-hidden="true" />
          العودة إلى المنتجات
        </Link>

        <Suspense fallback={null}>
          <ProductDetailPanel
            product={product}
            initialVariantId={initialVariantId}
          />
        </Suspense>

        {relatedProducts.length ? (
          <section
            className="related-products"
            aria-labelledby="related-products-title"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">من الفئة نفسها</span>
                <h2 id="related-products-title">منتجات ذات صلة</h2>
              </div>
            </div>
            <div className="product-grid">
              {relatedProducts.map((relatedProduct) => (
                <ProductCard key={relatedProduct.id} product={relatedProduct} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <MobileNavigation />
    </>
  );
}
