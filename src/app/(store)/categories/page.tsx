import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { categoryIcon } from "@/features/catalog/components/category-icons";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  localizedCategoryDescription,
  localizedCategoryName,
} from "@/features/catalog/domain/category";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { categoryCovers } from "@/features/storefront/domain/home-merchandising";
import { Link } from "@/i18n/link";
import { getLocale, getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    title: m.meta.categoriesTitle,
    description: m.meta.categoriesDescription,
  };
}

export default async function CategoriesPage() {
  await connection();
  const [categories, products, locale, m] = await Promise.all([
    storefrontCategories(),
    productRepository.list(),
    getLocale(),
    getMessages(),
  ]);
  const covers = categoryCovers(products);
  const counts = new Map<string, number>();
  for (const product of products) {
    counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
  }

  return (
    <>
      <SiteHeader />
      <main className="page-shell categories-page">
        <div className="categories-page-heading">
          <span className="eyebrow">MAYTHA MARKET</span>
          <h1>{m.common.categories}</h1>
        </div>
        {categories.length ? (
          <ul className="category-directory">
            {categories.map((category) => {
              const Icon = categoryIcon(category.icon);
              const cover = covers.get(category.code);
              const description = localizedCategoryDescription(
                category,
                locale,
              );
              return (
                <li key={category.code}>
                  <Link
                    href={`/categories/${encodeURIComponent(category.code)}`}
                  >
                    <span
                      className="category-icon"
                      data-cover={Boolean(cover)}
                      aria-hidden="true"
                    >
                      {cover ? (
                        <ProductMedia
                          product={cover}
                          className="category-cover"
                          sizes="(min-width: 48rem) 220px, 96px"
                        />
                      ) : (
                        <Icon />
                      )}
                    </span>
                    <span className="category-directory-text">
                      <strong>{localizedCategoryName(category, locale)}</strong>
                      {description ? <small>{description}</small> : null}
                      <small className="category-directory-count">
                        {m.common.productCount(counts.get(category.code) ?? 0)}
                      </small>
                    </span>
                    <ChevronLeft className="rtl-flip" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-state" role="status">
            {m.store.noCategories}
          </p>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
