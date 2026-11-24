"use client";

import { ChevronLeft, LayoutGrid, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  localizedCategoryDescription,
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import {
  localizedProductName,
  type Product,
} from "@/features/catalog/domain/product";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

/** How long each product stays in the banner's showcase before the next one. */
export const DAILY_SHOWCASE_INTERVAL_MS = 4000;

/**
 * Turns through the showcase products on a timer. It stays still for people who ask for reduced
 * motion, pauses while the banner is hovered or focused, and stops for good once a dot is chosen.
 */
function useShowcase(count: number) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    // Without matchMedia (old browsers, tests) the showcase simply stays still.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (count < 2 || paused || stopped || reducedMotion) return;
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % count),
      DAILY_SHOWCASE_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [count, paused, stopped, reducedMotion]);

  return {
    active: count ? active % count : 0,
    choose(index: number) {
      setStopped(true);
      setActive(index);
    },
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  };
}

/**
 * «Today's category»: the category the server picked for this store day, with a showcase that
 * turns through real products listed in it. Everything shown comes from the catalog; without a
 * category it falls back to a plain link to every category.
 */
export function DailyCategoryBanner({
  category,
  products,
  productCount = 0,
}: {
  category: ProductCategory | null;
  products: readonly Product[];
  productCount?: number;
}) {
  const { m, locale } = useI18n();
  const showcase = useShowcase(products.length);

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
  const current = products[showcase.active];

  return (
    <section
      className="daily-category"
      data-category-id={category.code}
      aria-labelledby="daily-category-title"
      onMouseEnter={showcase.pause}
      onMouseLeave={showcase.resume}
      onFocus={showcase.pause}
      onBlur={showcase.resume}
    >
      <div className="daily-category-body">
        <p className="daily-category-eyebrow">
          <Sparkles aria-hidden="true" />
          {m.store.todayCategory}
        </p>
        <h2 id="daily-category-title">{name}</h2>
        {description ? (
          <p className="daily-category-text">{description}</p>
        ) : productCount > 0 ? (
          <p className="daily-category-text">
            {m.store.categoryProductCount(productCount)}
          </p>
        ) : null}
        <Link href={href} className="daily-category-cta">
          {m.store.shopCategoryCta(name)}
          <ChevronLeft className="rtl-flip" aria-hidden="true" />
        </Link>
      </div>

      {current ? (
        <div className="daily-showcase">
          <Link
            href={`/products/${current.slug}`}
            className="daily-showcase-card"
          >
            <span className="daily-showcase-stage">
              {products.map((product, index) => (
                <span
                  key={product.id}
                  className="daily-showcase-slide"
                  data-active={index === showcase.active}
                  aria-hidden={index !== showcase.active}
                >
                  <ProductMedia
                    product={product}
                    className="daily-category-photo"
                    sizes="(min-width: 48rem) 220px, 140px"
                    priority={index === 0}
                  />
                </span>
              ))}
            </span>
            <span className="daily-showcase-name">
              <bdi dir="auto">{localizedProductName(current, locale)}</bdi>
            </span>
          </Link>
          {products.length > 1 ? (
            <div className="daily-showcase-dots">
              {products.map((product, index) => (
                <button
                  key={product.id}
                  type="button"
                  className="daily-showcase-dot"
                  aria-label={m.store.showcaseProduct(
                    index + 1,
                    localizedProductName(product, locale),
                  )}
                  aria-current={index === showcase.active ? "true" : undefined}
                  onClick={() => showcase.choose(index)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
