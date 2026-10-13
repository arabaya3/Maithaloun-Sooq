import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ProductCard } from "@/features/catalog/components/product-card";
import {
  localizedCategoryDescription,
  localizedCategoryName,
} from "@/features/catalog/domain/category";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { Link } from "@/i18n/link";
import { getLocale, getMessages } from "@/i18n/server";

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

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
  const [category, locale, m] = await Promise.all([
    params.then(({ code }) => findCategory(decode(code))),
    getLocale(),
    getMessages(),
  ]);
  return category
    ? {
        title: localizedCategoryName(category, locale),
        description:
          localizedCategoryDescription(category, locale) ?? undefined,
      }
    : { title: m.meta.categoryMissing };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();
  const code = decode((await params).code);
  const [category, products, locale, m] = await Promise.all([
    findCategory(code),
    productRepository.list(),
    getLocale(),
    getMessages(),
  ]);
  if (!category) notFound();
  const inCategory = products.filter(
    (product) => product.categoryId === category.code,
  );
  const description = localizedCategoryDescription(category, locale);

  return (
    <>
      <SiteHeader />
      <main className="page-shell categories-page">
        <nav aria-label={m.common.breadcrumb} className="category-breadcrumb">
          <Link href="/categories">
            <ArrowRight className="rtl-flip" aria-hidden="true" />
            {m.store.allCategoriesBack}
          </Link>
        </nav>
        <div className="section-heading catalog-heading">
          <h1>{localizedCategoryName(category, locale)}</h1>
          <span className="results-count">
            {m.common.productCount(inCategory.length)}
          </span>
        </div>
        {description ? (
          <p className="category-description">{description}</p>
        ) : null}
        {inCategory.length ? (
          <div className="product-grid">
            {inCategory.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="empty-state" role="status">
            <h2>{m.store.emptyCategory}</h2>
            <Link href="/categories">{m.store.browseOtherCategories}</Link>
          </div>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
