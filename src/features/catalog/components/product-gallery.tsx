"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { GalleryImage } from "@/features/catalog/domain/product-gallery";

export function ProductGallery({
  images,
  label,
}: {
  images: readonly GalleryImage[];
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const first = images[0]?.id;

  // A different variant brings its own images; the view returns to its first one.
  useEffect(() => {
    trackRef.current?.scrollTo({ left: 0 });
    queueMicrotask(() => setActive(0));
  }, [first]);

  function show(index: number) {
    const track = trackRef.current;
    const bounded = Math.max(0, Math.min(images.length - 1, index));
    const slide = track?.children[bounded] as HTMLElement | undefined;
    slide?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
    setActive(bounded);
  }

  function onScroll() {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const index = Math.round(Math.abs(track.scrollLeft) / track.clientWidth);
    if (index !== active) setActive(Math.min(images.length - 1, index));
  }

  // In RTL the left arrow moves forward.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(active + 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      show(active - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      show(0);
    } else if (event.key === "End") {
      event.preventDefault();
      show(images.length - 1);
    }
  }

  return (
    <section
      className="product-gallery"
      aria-roledescription="معرض صور"
      aria-label={label}
    >
      <div
        ref={trackRef}
        className="product-gallery-track"
        tabIndex={0}
        aria-live="polite"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        {images.map((image, index) => (
          <figure
            key={image.id}
            className="product-gallery-slide"
            aria-roledescription="صورة"
            aria-label={`صورة ${index + 1} من ${images.length}`}
            aria-hidden={index !== active}
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="(min-width: 768px) 45vw, 100vw"
              priority={index === 0}
              loading={index === 0 ? "eager" : "lazy"}
            />
          </figure>
        ))}
      </div>
      {images.length > 1 ? (
        <>
          <div className="product-gallery-arrows">
            <button
              type="button"
              aria-label="الصورة السابقة"
              disabled={active === 0}
              onClick={() => show(active - 1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="الصورة التالية"
              disabled={active === images.length - 1}
              onClick={() => show(active + 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
          </div>
          <div
            className="product-gallery-thumbs"
            role="group"
            aria-label="اختيار صورة"
          >
            {images.map((image, index) => (
              <button
                key={image.id}
                type="button"
                aria-label={`عرض الصورة ${index + 1} من ${images.length}`}
                aria-current={index === active ? "true" : undefined}
                onClick={() => show(index)}
              >
                <Image
                  src={image.src}
                  alt=""
                  width={56}
                  height={56}
                  sizes="56px"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
