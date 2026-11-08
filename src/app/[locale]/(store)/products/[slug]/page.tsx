import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ProductBackLink } from "@/features/catalog/components/product-back-link";
import { ProductCard } from "@/features/catalog/components/product-card";
import {
  ProductDetailPanel,
  ProductDetailPanelDefault,
} from "@/features/catalog/components/product-detail-panel";
import {
  localizedProductName,
  localizedProductText,
} from "@/features/catalog/domain/product";
import { localizedCategoryName } from "@/features/catalog/domain/category";
import { assignableCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { Link } from "@/i18n/link";
import { getLocale, getMessages, localizedAlternates } from "@/i18n/server";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

// Product pages are rendered on first visit and then served from the cache; admin changes refresh
// them at once (revalidateStorefront) and the store layout's revalidate window is the safety net.
// The locale layout checks the language; this segment's own values are rendered on first visit (ISR).
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const [product, locale, m, alternates] = await Promise.all([
    productRepository.getBySlug(slug),
    getLocale(),
    getMessages(),
    localizedAlternates(`/products/${slug}`),
  ]);
  if (!product) notFound();
  const name = localizedProductName(product, locale);

  return {
    title: name,
    alternates,
    description:
      localizedProductText(product, locale).description ??
      m.meta.productDescription(name),
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const product = await productRepository.getBySlug((await params).slug);
  if (!product) notFound();

  const [products, categories, presentation, locale, m] = await Promise.all([
    productRepository.list(),
    assignableCategories(),
    productRepository.presentation(product.id),
    getLocale(),
    getMessages(),
  ]);
  const relatedProducts = products
    .filter(
      (candidate) =>
        candidate.id !== product.id &&
        candidate.categoryId === product.categoryId,
    )
    .slice(0, 3);
  const name = localizedProductName(product, locale);
  const category = categories.find(
    (entry) => entry.code === product.categoryId,
  );

  const panel = {
    product,
    categoryLabel: category
      ? localizedCategoryName(category, locale)
      : product.categoryId,
    presentation,
  };

  return (
    <>
      <SiteHeader />
      <main className="page-shell detail-page">
        <div className="detail-navigation">
          <ProductBackLink label={locale === "ar" ? "رجوع" : "Back"} />
          {category ? <span>{panel.categoryLabel}</span> : null}
        </div>
        <nav className="breadcrumb" aria-label={m.catalog.breadcrumb}>
          <Link href="/">{m.common.home}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">
            <bdi dir="auto">{name}</bdi>
          </span>
        </nav>

        <Suspense fallback={<ProductDetailPanelDefault {...panel} />}>
          <ProductDetailPanel {...panel} />
        </Suspense>

        {relatedProducts.length ? (
          <section
            className="related-products"
            aria-labelledby="related-products-title"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">{m.catalog.sameCategory}</span>
                <h2 id="related-products-title">{m.catalog.relatedProducts}</h2>
              </div>
              {category ? (
                <Link href={`/categories/${encodeURIComponent(category.code)}`}>
                  {locale === "ar" ? "عرض الكل" : "View all"}
                </Link>
              ) : null}
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
