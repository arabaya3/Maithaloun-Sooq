"use client";

import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { ProductPlaceholder } from "@/features/catalog/components/product-placeholder";
import type { GalleryImage } from "@/features/catalog/domain/product-gallery";
import { useI18n } from "@/i18n/i18n-provider";

const SWIPE_DISTANCE = 40;
const ZOOM_SCALE = 2.2;

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
  const { m, locale } = useI18n();
  // Thumbnails follow the reading direction: the next one is to the left in Arabic, to the right in English.
  const forward = locale === "ar" ? -1 : 1;
  const thumbsRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState<{ id: string; style: CSSProperties } | null>(
    null,
  );
  const [viewerOpen, setViewerOpen] = useState(false);
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

  function onThumbKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = {
      ArrowLeft: index - forward,
      ArrowRight: index + forward,
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
    moved.current = false;
  }

  // A mouse zooms toward the cursor, clipped by the stage; touch keeps swipe and opens the viewer instead.
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || !active) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setZoom({
      id: active.id,
      style: {
        transform: `scale(${ZOOM_SCALE})`,
        transformOrigin: `${Math.min(100, Math.max(0, x))}% ${Math.min(100, Math.max(0, y))}%`,
      },
    });
  }

  // A sideways swipe on the main image changes it; vertical movement is left to the page scroll.
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dy) > Math.abs(dx)) return;
    moved.current = true;
    show(dx * forward < 0 ? index + 1 : index - 1);
  }

  const position = m.catalog.imagePosition(index + 1, images.length);
  const activeAlt = active.scopeLabel
    ? `${active.alt} — ${active.scopeLabel}`
    : active.alt;
  // Zoom belongs to one image, so switching images always starts unzoomed.
  const zoomStyle = zoom?.id === active.id ? zoom.style : undefined;
  const multiple = images.length > 1;

  return (
    <section
      className="product-gallery"
      aria-roledescription={m.catalog.galleryRole}
      aria-label={label}
    >
      <div
        className="product-gallery-stage"
        data-zooming={Boolean(zoomStyle)}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setZoom(null)}
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
            style={zoomStyle}
          />
        )}
        {failed.has(active.id) ? null : (
          <button
            type="button"
            className="product-gallery-expand"
            aria-label={m.catalog.openViewer}
            aria-haspopup="dialog"
            onClick={() => {
              if (!moved.current) setViewerOpen(true);
            }}
          >
            <Expand aria-hidden="true" />
            <span className="product-gallery-zoom-hint" aria-hidden="true">
              {m.catalog.zoomHint}
            </span>
          </button>
        )}
        <p
          className="product-gallery-position"
          aria-live="polite"
          hidden={!multiple && !active.scopeLabel}
        >
          <span className="sr-only">{m.catalog.imagePrefix}</span>
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
              aria-label={m.catalog.previousImage}
              disabled={index === 0}
              onClick={() => show(index - 1)}
            >
              <ChevronRight className="rtl-flip" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={m.catalog.nextImage}
              disabled={index === images.length - 1}
              onClick={() => show(index + 1)}
            >
              <ChevronLeft className="rtl-flip" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div
          ref={thumbsRef}
          className="product-gallery-thumbs"
          role="group"
          aria-label={m.catalog.chooseImage}
          onKeyDown={onThumbKey}
        >
          {images.map((image, at) => (
            <button
              key={image.id}
              type="button"
              tabIndex={at === index ? 0 : -1}
              aria-label={`${m.catalog.showImage(at + 1, images.length)}${image.scopeLabel ? ` — ${image.scopeLabel}` : ""}`}
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
      {viewerOpen ? (
        <GalleryViewer
          images={images}
          index={index}
          onShow={(next) => show(next)}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </section>
  );
}

/** Full-screen viewer for touch and keyboard; the browser's own pinch zoom stays available. */
function GalleryViewer({
  images,
  index,
  onShow,
  onClose,
}: {
  images: readonly GalleryItem[];
  index: number;
  onShow: (index: number) => void;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const forward = locale === "ar" ? -1 : 1;
  const image = images[index]!;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onShow(index - forward);
      if (event.key === "ArrowRight") onShow(index + forward);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forward, index, onClose, onShow]);

  return (
    <div
      className="gallery-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={m.catalog.openViewer}
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        className="gallery-viewer-close"
        aria-label={m.catalog.close}
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- the viewer shows the original file at its natural size */}
      <img
        className="gallery-viewer-image"
        src={image.src}
        alt={
          image.scopeLabel ? `${image.alt} — ${image.scopeLabel}` : image.alt
        }
        onClick={(event) => event.stopPropagation()}
      />
      {images.length > 1 ? (
        <div
          className="gallery-viewer-nav"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label={m.catalog.previousImage}
            disabled={index === 0}
            onClick={() => onShow(index - 1)}
          >
            <ChevronRight className="rtl-flip" aria-hidden="true" />
          </button>
          <span aria-live="polite">
            {m.catalog.imagePosition(index + 1, images.length)}
          </span>
          <button
            type="button"
            aria-label={m.catalog.nextImage}
            disabled={index === images.length - 1}
            onClick={() => onShow(index + 1)}
          >
            <ChevronLeft className="rtl-flip" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
