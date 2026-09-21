import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ProductCard } from "@/features/catalog/components/product-card";
import { ProductDetailActions } from "@/features/catalog/components/product-detail-actions";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  getCategoryLabel,
  getProductDisplayName,
  isProductAvailable,
} from "@/features/catalog/domain/product";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { formatIls } from "@/shared/lib/format-currency";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
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

export default async function ProductPage({ params }: ProductPageProps) {
  await connection();
  const product = await productRepository.getBySlug((await params).slug);
  if (!product) notFound();

  const products = await productRepository.list();
  const relatedProducts = products
    .filter(
      (candidate) =>
        candidate.id !== product.id &&
        candidate.categoryId === product.categoryId,
    )
    .slice(0, 3);
  const name = getProductDisplayName(product);
  const available = isProductAvailable(product);

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

        <article className="product-detail">
          <ProductMedia
            product={product}
            className="product-detail-media"
            sizes="(min-width: 768px) 45vw, 100vw"
          />
          <div className="product-detail-content">
            <span className="eyebrow">
              {getCategoryLabel(product.categoryId)}
            </span>
            <h1>
              <bdi dir="auto">{name}</bdi>
            </h1>
            <p
              className="product-detail-price"
              aria-label={`السعر ${formatIls(product.priceAgorot)}`}
            >
              <bdi dir="ltr">{formatIls(product.priceAgorot)}</bdi>
            </p>
            <p className="availability-status" data-available={available}>
              {available ? "متاح للإضافة إلى السلة" : "غير متاح حالياً"}
            </p>
            <p className="product-description">
              {product.description ??
                "تتوفر معلومات المنتج الأساسية المعروضة حالياً، وستُضاف التفاصيل بعد اعتمادها."}
            </p>
            {product.usageNotes ? (
              <section aria-labelledby="usage-title">
                <h2 id="usage-title">ملاحظات الاستخدام</h2>
                <p>{product.usageNotes}</p>
              </section>
            ) : null}
            <ProductDetailActions product={product} />
          </div>
        </article>

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
