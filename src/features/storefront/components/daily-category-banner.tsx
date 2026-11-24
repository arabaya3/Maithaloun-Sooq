"use client";

import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Leaf,
  Pause,
  Play,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
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
import { DailySceneWall } from "@/features/storefront/components/daily-scene";
import { groupDailyProducts } from "@/features/storefront/domain/daily-category";
import { dailySceneTheme } from "@/features/storefront/domain/daily-scene-theme";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

/** How long each group of products stays in the scene before the next one (two minutes). */
export const DAILY_GROUP_INTERVAL_MS = 120_000;

/** The next group's photos start loading this long before it appears. */
export const DAILY_GROUP_PREFETCH_MS = 5_000;

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
 * Which group is in the scene. It moves on by itself every `interval` while the page is visible,
 * the visitor has not paused it and does not ask for reduced motion. Any change of group (by the
 * timer or by hand) starts a fresh wait. Groups are mounted (their photos requested) only when they
 * are about to be shown, or when the visitor points at a control that would show them.
 */
function useGroupRotation(count: number, interval: number) {
  const reducedMotion = useReducedMotion();
  const hidden = usePageHidden();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [restart, setRestart] = useState(0);
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([0]));
  const current = count ? Math.min(active, count - 1) : 0;

  const mount = useCallback((index: number) => {
    setMounted((previous) =>
      previous.has(index) ? previous : new Set([...previous, index]),
    );
  }, []);

  const autoplay = count > 1 && !paused && !hidden && !reducedMotion;

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
  }, [autoplay, current, count, interval, mount, restart]);

  const go = useCallback(
    (index: number) => {
      if (!count) return;
      const target = ((index % count) + count) % count;
      mount(target);
      setActive(target);
      setRestart((value) => value + 1);
    },
    [count, mount],
  );

  return {
    active: current,
    mounted,
    paused,
    reducedMotion,
    autoplay,
    go,
    next: () => go(current + 1),
    previous: () => go(current - 1),
    warm: (index: number) => mount(((index % count) + count) % count),
    togglePause: () => setPaused((value) => !value),
  };
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
  const theme = dailySceneTheme(category?.code);

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
  const rtl = locale === "ar";
  const multiple = groups.length > 1;

  const style = {
    "--scene-panel": theme.panel,
    "--scene-wall-top": theme.wallTop,
    "--scene-wall-bottom": theme.wallBottom,
    "--scene-light": theme.light,
    "--scene-counter": theme.counter,
    "--scene-counter-edge": theme.counterEdge,
    "--scene-speck": theme.speck,
    "--scene-pedestal": theme.pedestal,
    "--scene-shade": theme.shade,
  } as CSSProperties;

  function onControlsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // On an Arabic page the next group lies to the left.
    const forward = (event.key === "ArrowLeft") === rtl;
    if (forward) rotation.next();
    else rotation.previous();
  }

  return (
    <section
      className="daily-category daily-scene"
      data-category-id={category.code}
      data-motif={theme.motif}
      aria-labelledby="daily-category-title"
      aria-roledescription={multiple ? "carousel" : undefined}
      style={style}
    >
      <div className="daily-scene-backdrop" aria-hidden="true">
        <DailySceneWall motif={theme.motif} />
        <div className="daily-scene-counter" />
      </div>

      <div className="daily-category-body daily-scene-panel">
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
                    {/* The pedestal comes first so the photo is painted onto it. */}
                    <span className="daily-scene-pedestal" aria-hidden="true" />
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

      {multiple ? (
        <div className="daily-scene-controls" onKeyDown={onControlsKeyDown}>
          <button
            type="button"
            className="daily-scene-arrow"
            aria-label={m.store.dailyPrevious}
            onClick={rotation.previous}
            onPointerEnter={() => rotation.warm(rotation.active - 1)}
            onFocus={() => rotation.warm(rotation.active - 1)}
          >
            <ChevronRight className="rtl-flip" aria-hidden="true" />
          </button>
          <div className="daily-scene-dots">
            {groups.map((group, index) => (
              <button
                key={group.map((product) => product.id).join("|")}
                type="button"
                className="daily-scene-dot"
                aria-label={m.store.dailyShowGroup(index + 1)}
                aria-current={index === rotation.active ? "true" : undefined}
                onClick={() => rotation.go(index)}
                onPointerEnter={() => rotation.warm(index)}
                onFocus={() => rotation.warm(index)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="daily-scene-arrow"
            aria-label={m.store.dailyNext}
            onClick={rotation.next}
            onPointerEnter={() => rotation.warm(rotation.active + 1)}
            onFocus={() => rotation.warm(rotation.active + 1)}
          >
            <ChevronLeft className="rtl-flip" aria-hidden="true" />
          </button>
          {rotation.reducedMotion ? null : (
            <button
              type="button"
              className="daily-scene-arrow daily-scene-pause"
              aria-label={rotation.paused ? m.store.dailyPlay : m.store.dailyPause}
              onClick={rotation.togglePause}
            >
              {rotation.paused ? (
                <Play aria-hidden="true" />
              ) : (
                <Pause aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
