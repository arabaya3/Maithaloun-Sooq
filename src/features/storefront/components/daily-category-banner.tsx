"use client";

import { ChevronLeft, LayoutGrid } from "lucide-react";

import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  localizedCategoryDescription,
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import type { Product } from "@/features/catalog/domain/product";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

/**
 * «Today's category»: one compact banner for the category the server picked for this store day.
 * Everything shown comes from the catalog: the category's name and description and real photos of
 * products listed in it. Without a category it falls back to a plain link to every category.
 */
export function DailyCategoryBanner({
  category,
  products,
}: {
  category: ProductCategory | null;
  products: readonly Product[];
}) {
  const { m, locale } = useI18n();

  if (!category) {
    return (
      <section
        className="daily-category"
        data-fallback="true"
        aria-labelledby="daily-category-title"
      >
        <div className="daily-category-body">
          <p className="daily-category-eyebrow">MAYTHA MARKET</p>
          <h2 id="daily-category-title">{m.store.dailyFallbackTitle}</h2>
          <Link href="/categories" className="daily-category-cta">
            {m.store.dailyFallbackCta}
            <ChevronLeft className="rtl-flip" aria-hidden="true" />
          </Link>
        </div>
        <div className="daily-category-art" aria-hidden="true">
          <LayoutGrid />
        </div>
      </section>
    );
  }

  const name = localizedCategoryName(category, locale);
  const description = localizedCategoryDescription(category, locale);
  const href = `/categories/${encodeURIComponent(category.code)}`;

  return (
    <section
      className="daily-category"
      data-category-id={category.code}
      aria-labelledby="daily-category-title"
    >
      <div className="daily-category-body">
        <p className="daily-category-eyebrow">{m.store.todayCategory}</p>
        <h2 id="daily-category-title">{name}</h2>
        {description ? (
          <p className="daily-category-text">{description}</p>
        ) : null}
        <Link href={href} className="daily-category-cta">
          {m.store.shopCategoryCta(name)}
          <ChevronLeft className="rtl-flip" aria-hidden="true" />
        </Link>
      </div>
      {products.length ? (
        <ul
          className="daily-category-photos"
          data-count={products.length}
          aria-hidden="true"
        >
          {products.map((product, index) => (
            <li key={product.id}>
              <ProductMedia
                product={product}
                className="daily-category-photo"
                sizes="(min-width: 48rem) 160px, 96px"
                priority={index === 0}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
