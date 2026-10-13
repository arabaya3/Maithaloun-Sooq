import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ProductCard } from "@/features/catalog/components/product-card";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { formatProductCount } from "@/shared/lib/format-product-count";

// Only visible, non-archived categories resolve; anything else is a 404.
async function findCategory(code: string) {
  const categories = await storefrontCategories();
  return categories.find((category) => category.code === code) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const category = await findCategory(decodeURIComponent((await params).code));
  return category
    ? { title: category.nameAr, description: category.description ?? undefined }
    : { title: "القسم غير موجود" };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();
  const code = decodeURIComponent((await params).code);
  const [category, products] = await Promise.all([
    findCategory(code),
    productRepository.list(),
  ]);
  if (!category) notFound();
  const inCategory = products.filter(
    (product) => product.categoryId === category.code,
  );

  return (
    <>
      <SiteHeader />
      <main className="page-shell categories-page">
        <nav aria-label="مسار التصفح" className="category-breadcrumb">
          <Link href="/categories">
            <ArrowRight aria-hidden="true" />
            كل الأقسام
          </Link>
        </nav>
        <div className="section-heading catalog-heading">
          <h1>{category.nameAr}</h1>
          <span className="results-count">
            {formatProductCount(inCategory.length)}
          </span>
        </div>
        {category.description ? (
          <p className="category-description">{category.description}</p>
        ) : null}
        {inCategory.length ? (
          <div className="product-grid">
            {inCategory.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="empty-state" role="status">
            <h2>لا توجد منتجات في هذا القسم حالياً</h2>
            <Link href="/categories">تصفّح أقساماً أخرى</Link>
          </div>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
