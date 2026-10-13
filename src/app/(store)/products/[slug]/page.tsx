import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ProductCard } from "@/features/catalog/components/product-card";
import { ProductDetailPanel } from "@/features/catalog/components/product-detail-panel";
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
import { getLocale, getMessages } from "@/i18n/server";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  await connection();
  const [product, locale, m] = await Promise.all([
    params.then(({ slug }) => productRepository.getBySlug(slug)),
    getLocale(),
    getMessages(),
  ]);
  if (!product) notFound();
  const name = localizedProductName(product, locale);

  return {
    title: name,
    description:
      localizedProductText(product, locale).description ??
      m.meta.productDescription(name),
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

  return (
    <>
      <SiteHeader />
      <main className="page-shell detail-page">
        <nav className="breadcrumb" aria-label={m.catalog.breadcrumb}>
          <Link href="/">{m.common.home}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">
            <bdi dir="auto">{name}</bdi>
          </span>
        </nav>

        <Link className="back-link" href="/">
          <ArrowRight className="rtl-flip" aria-hidden="true" />
          {m.catalog.backToProducts}
        </Link>

        <Suspense fallback={null}>
          <ProductDetailPanel
            product={product}
            categoryLabel={
              category
                ? localizedCategoryName(category, locale)
                : product.categoryId
            }
            initialVariantId={initialVariantId}
            presentation={presentation}
          />
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
