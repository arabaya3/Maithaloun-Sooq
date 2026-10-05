"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { ProductPlaceholder } from "@/features/catalog/components/product-placeholder";
import type { GalleryImage } from "@/features/catalog/domain/product-gallery";

const SWIPE_DISTANCE = 40;

export interface GalleryItem extends GalleryImage {
  /** What the image shows, such as «اللون: أزرق»; null for a shared product image. */
  scopeLabel: string | null;
}

// The parent owns which image is active, so tapping an image can also choose its variant and choosing a variant can move the image.
export function ProductGallery({
  images,
  activeId,
  label,
  priorityId,
  onSelect,
}: {
  images: readonly GalleryItem[];
  activeId: string | null;
  label: string;
  /** Only the image shown on first paint is loaded with priority. */
  priorityId: string | null;
  onSelect: (image: GalleryItem) => void;
}) {
  const thumbsRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const index = Math.max(
    0,
    images.findIndex((image) => image.id === activeId),
  );
  const active = images[index];
  if (!active) return null;

  function markFailed(id: string) {
    setFailed((current) => new Set(current).add(id));
  }

  function show(next: number, focus = false) {
    const bounded = Math.max(0, Math.min(images.length - 1, next));
    const image = images[bounded];
    if (!image) return;
    onSelect(image);
    if (focus) {
      const button = thumbsRef.current?.querySelectorAll("button")[bounded];
      button?.focus();
    }
  }

  // Thumbnails run right to left, so the left arrow moves to the next one.
  function onThumbKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = {
      ArrowLeft: index + 1,
      ArrowRight: index - 1,
      Home: 0,
      End: images.length - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    show(next, true);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    swipe.current = { x: event.clientX, y: event.clientY };
  }

  // A sideways swipe on the main image changes it; vertical movement is left to the page scroll.
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dy) > Math.abs(dx)) return;
    show(dx > 0 ? index + 1 : index - 1);
  }

  const position = `${index + 1} من ${images.length}`;
  const activeAlt = active.scopeLabel
    ? `${active.alt} — ${active.scopeLabel}`
    : active.alt;

  return (
    <section
      className="product-gallery"
      aria-roledescription="معرض صور"
      aria-label={label}
    >
      <div
        className="product-gallery-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {failed.has(active.id) ? (
          <div
            className="product-gallery-missing"
            role="img"
            aria-label={activeAlt}
          >
            <ProductPlaceholder kind="general-cleaner" />
          </div>
        ) : (
          <Image
            key={active.id}
            className="product-gallery-image"
            src={active.src}
            alt={activeAlt}
            width={active.width}
            height={active.height}
            sizes="(min-width: 1024px) 40vw, (min-width: 768px) 45vw, 100vw"
            priority={active.id === priorityId}
            loading={active.id === priorityId ? "eager" : "lazy"}
            onError={() => markFailed(active.id)}
            draggable={false}
          />
        )}
        <p className="product-gallery-position" aria-live="polite">
          <span className="sr-only">الصورة </span>
          {position}
          {active.scopeLabel ? (
            <span className="product-gallery-scope">
              {" "}
              · {active.scopeLabel}
            </span>
          ) : null}
        </p>
        {images.length > 1 ? (
          <div className="product-gallery-arrows">
            <button
              type="button"
              aria-label="الصورة السابقة"
              disabled={index === 0}
              onClick={() => show(index - 1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="الصورة التالية"
              disabled={index === images.length - 1}
              onClick={() => show(index + 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div
          ref={thumbsRef}
          className="product-gallery-thumbs"
          role="group"
          aria-label="اختيار صورة"
          onKeyDown={onThumbKey}
        >
          {images.map((image, at) => (
            <button
              key={image.id}
              type="button"
              tabIndex={at === index ? 0 : -1}
              aria-label={`عرض الصورة ${at + 1} من ${images.length}${image.scopeLabel ? ` — ${image.scopeLabel}` : ""}`}
              aria-current={at === index ? "true" : undefined}
              data-scope={image.scope}
              onClick={() => show(at)}
            >
              {failed.has(image.id) ? (
                <span className="product-gallery-thumb-missing" aria-hidden />
              ) : (
                <Image
                  src={image.src}
                  alt=""
                  width={56}
                  height={56}
                  loading="lazy"
                  onError={() => markFailed(image.id)}
                  draggable={false}
                />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
