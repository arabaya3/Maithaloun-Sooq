"use client";

import {
  ChevronLeft,
  LayoutGrid,
  Leaf,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  localizedCategoryDescription,
  localizedCategoryName,
  type ProductCategory,
} from "@/features/catalog/domain/category";
import {
  localizedProductName,
  type Product,
} from "@/features/catalog/domain/product";
import { groupDailyProducts } from "@/features/storefront/domain/daily-category";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

/** How long each group of products stays in the scene before the next one (eight seconds). */
export const DAILY_GROUP_INTERVAL_MS = 8_000;

/** The next group's photos start loading this long before it appears. */
export const DAILY_GROUP_PREFETCH_MS = 5_000;

const LEAF = "M0 0 C10 -14 28 -17 40 -5 C28 7 11 8 0 0 Z";

/** A leafy sprig, drawn in currentColor. Decoration only. */
function Sprig({ className }: { className: string }) {
  const leaves: [number, number, number][] = [
    [6, 6, -20],
    [18, 20, 35],
    [26, 34, -35],
    [38, 48, 30],
    [46, 64, -30],
  ];
  return (
    <svg className={className} viewBox="0 0 90 100" aria-hidden="true" focusable="false">
      <path d="M2 2 C24 30 40 60 58 96" fill="none" stroke="currentColor" strokeWidth="2" />
      {leaves.map(([x, y, rotate]) => (
        <path
          key={`${x}-${y}`}
          d={LEAF}
          fill="currentColor"
          transform={`translate(${x} ${y}) rotate(${rotate})`}
        />
      ))}
    </svg>
  );
}

/** Two small four-point sparkles. Decoration only. */
function Sparkle() {
  const star = "M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z";
  return (
    <svg className="daily-scene-sparkle" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d={star} fill="currentColor" transform="translate(0 14)" />
      <path d={star} fill="currentColor" transform="translate(22 0) scale(0.7)" />
    </svg>
  );
}

function useReducedMotion() {
  // Still until the browser says otherwise: the server render never starts anything moving.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function usePageHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/**
 * Which group is in the scene. It moves on by itself every `interval` while the page is visible
 * and the visitor does not ask for reduced motion; there are no controls. Groups are mounted
 * (their photos requested) only shortly before they are shown.
 */
function useGroupRotation(count: number, interval: number) {
  const reducedMotion = useReducedMotion();
  const hidden = usePageHidden();
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([0]));
  const current = count ? Math.min(active, count - 1) : 0;

  const mount = useCallback((index: number) => {
    setMounted((previous) =>
      previous.has(index) ? previous : new Set([...previous, index]),
    );
  }, []);

  const autoplay = count > 1 && !hidden && !reducedMotion;

  useEffect(() => {
    if (!autoplay) return;
    const next = (current + 1) % count;
    const lead = Math.min(DAILY_GROUP_PREFETCH_MS, interval / 2);
    const prefetch = window.setTimeout(() => mount(next), interval - lead);
    const advance = window.setTimeout(() => {
      mount(next);
      setActive(next);
    }, interval);
    return () => {
      window.clearTimeout(prefetch);
      window.clearTimeout(advance);
    };
  }, [autoplay, current, count, interval, mount]);

  return { active: current, mounted, autoplay };
}

/**
 * «Today's category»: the category the server picked for this store day, shown as a lit scene in
 * which real products from it stand on pedestals, a few at a time. Everything named comes from the
 * catalog; without a category it falls back to a plain link to every category.
 */
export function DailyCategoryBanner({
  category,
  products,
  productCount = 0,
  interval = DAILY_GROUP_INTERVAL_MS,
}: {
  category: ProductCategory | null;
  products: readonly Product[];
  productCount?: number;
  /** For tests only; the storefront always uses DAILY_GROUP_INTERVAL_MS. */
  interval?: number;
}) {
  const { m, locale } = useI18n();
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  // A photo that fails to load leaves its group rather than leaving a hole on the counter.
  const groups = useMemo(
    () =>
      groupDailyProducts(
        products.filter(
          (product) => product.image.kind === "image" && !failed.has(product.id),
        ),
      ),
    [products, failed],
  );
  const rotation = useGroupRotation(groups.length, interval);

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
  const multiple = groups.length > 1;

  return (
    <section
      className="daily-category daily-scene"
      data-category-id={category.code}
      aria-labelledby="daily-category-title"
      aria-roledescription={multiple ? "carousel" : undefined}
    >
      <div className="daily-category-body daily-scene-panel">
        <Sprig className="daily-scene-sprig daily-scene-sprig--top" />
        <Sprig className="daily-scene-sprig daily-scene-sprig--bottom" />
        <p className="daily-category-eyebrow">
          <Leaf aria-hidden="true" />
          {m.store.todayCategory}
        </p>
        <h2 id="daily-category-title">{name}</h2>
        <p className="daily-category-text">
          {description || m.store.dailyDiscover(name)}
        </p>
        {productCount > 0 ? (
          <p className="daily-category-count">
            {m.store.categoryProductCount(productCount)}
          </p>
        ) : null}
        <Link
          href={href}
          className="daily-category-cta"
          aria-label={`${m.store.dailyShop}: ${name}`}
        >
          {m.store.dailyShop}
          <ChevronLeft className="rtl-flip" aria-hidden="true" />
        </Link>
      </div>

      {groups.length ? (
        <div
          className="daily-scene-stage"
          aria-label={m.store.dailyCarousel(name)}
          role="group"
          aria-live={rotation.autoplay ? "off" : "polite"}
        >
          <Sprig className="daily-scene-plant" />
          <Sparkle />
          <span className="daily-scene-pedestal" aria-hidden="true" />
          {groups.map((group, index) => {
            const active = index === rotation.active;
            if (!active && !rotation.mounted.has(index)) return null;
            return (
              <div
                key={group.map((product) => product.id).join("|")}
                className="daily-scene-group"
                role="group"
                aria-roledescription={multiple ? "slide" : undefined}
                aria-label={
                  multiple ? m.store.dailyGroup(index + 1, groups.length) : undefined
                }
                data-active={active}
                data-count={group.length}
                aria-hidden={active ? undefined : true}
                inert={!active}
              >
                {group.map((product, position) => (
                  <Link
                    key={product.id}
                    href={`/products/${product.slug}`}
                    className="daily-scene-product"
                    data-position={position}
                    aria-label={localizedProductName(product, locale)}
                  >
                    <span className="daily-scene-photo">
                      {product.image.kind === "image" ? (
                        <Image
                          src={product.image.src}
                          alt=""
                          fill
                          sizes="(min-width: 48rem) 176px, 104px"
                          preload={index === 0}
                          loading={index === 0 ? undefined : "eager"}
                          onError={() =>
                            setFailed((previous) =>
                              new Set([...previous, product.id]),
                            )
                          }
                        />
                      ) : null}
                    </span>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}

    </section>
  );
}
