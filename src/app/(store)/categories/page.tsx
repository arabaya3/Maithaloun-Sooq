import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { categoryIcon } from "@/features/catalog/components/category-icons";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";
import { formatProductCount } from "@/shared/lib/format-product-count";

export const metadata: Metadata = {
  title: "الأقسام",
  description: "تصفّح أقسام سوق ميثلون واختر ما يحتاجه البيت.",
};

export default async function CategoriesPage() {
  await connection();
  const [categories, products] = await Promise.all([
    storefrontCategories(),
    productRepository.list(),
  ]);
  const counts = new Map<string, number>();
  for (const product of products) {
    counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
  }

  return (
    <>
      <SiteHeader />
      <main className="page-shell categories-page">
        <div className="categories-page-heading">
          <span className="eyebrow">سوق ميثلون</span>
          <h1>الأقسام</h1>
        </div>
        {categories.length ? (
          <ul className="category-directory">
            {categories.map((category) => {
              const Icon = categoryIcon(category.icon);
              return (
                <li key={category.code}>
                  <Link
                    href={`/categories/${encodeURIComponent(category.code)}`}
                  >
                    <span className="category-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="category-directory-text">
                      <strong>{category.nameAr}</strong>
                      {category.description ? (
                        <small>{category.description}</small>
                      ) : null}
                      <small className="category-directory-count">
                        {formatProductCount(counts.get(category.code) ?? 0)}
                      </small>
                    </span>
                    <ChevronLeft aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-state" role="status">
            لا توجد أقسام منشورة حالياً.
          </p>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
