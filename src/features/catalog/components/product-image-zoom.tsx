"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import type { ProductVariant } from "@/features/catalog/domain/product-variant";

type ZoomImage = Extract<ProductVariant["image"], { kind: "image" }>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ProductImageZoom({
  image,
  className = "product-detail-media",
  sizes = "(min-width: 768px) 45vw, 100vw",
  priority = false,
}: {
  image: ZoomImage;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const dialogTitleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCoarse, setIsCoarse] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [zooming, setZooming] = useState(false);
  const [photoStyle, setPhotoStyle] = useState<CSSProperties>({});

  useEffect(() => {
    const coarseQuery = window.matchMedia("(pointer: coarse)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setIsCoarse(coarseQuery.matches);
      setReduceMotion(motionQuery.matches);
    };
    sync();
    coarseQuery.addEventListener("change", sync);
    motionQuery.addEventListener("change", sync);
    return () => {
      coarseQuery.removeEventListener("change", sync);
      motionQuery.removeEventListener("change", sync);
    };
  }, []);

  const resetZoom = useCallback(() => {
    setZooming(false);
    setPhotoStyle({});
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    queueMicrotask(() => closeRef.current?.focus());

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !closeRef.current) return;
      event.preventDefault();
      closeRef.current.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDialog, dialogOpen]);

  function updateZoom(event: PointerEvent<HTMLButtonElement>) {
    if (isCoarse || reduceMotion) return;
    const frame = frameRef.current;
    const photo = frame?.querySelector("img");
    if (!frame || !photo) return;

    const rect = photo.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);

    setZooming(true);
    setPhotoStyle({
      transform: "scale(2)",
      transformOrigin: `${x}% ${y}%`,
    });
  }

  function openDialog() {
    resetZoom();
    setDialogOpen(true);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDialog();
    }
  }

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    if (!isCoarse && !reduceMotion) {
      event.preventDefault();
      return;
    }
    openDialog();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`product-image-zoom ${className} product-art--photo`}
        data-image-kind="image"
        data-coarse={isCoarse}
        data-zooming={zooming}
        aria-label="تكبير صورة المنتج"
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        onPointerMove={updateZoom}
        onPointerLeave={resetZoom}
      >
        <div ref={frameRef} className="product-image-zoom-frame">
          <Image
            src={image.src}
            alt={image.alt}
            fill
            sizes={sizes}
            className="product-photo"
            priority={priority}
            style={photoStyle}
            onError={resetZoom}
          />
        </div>
      </button>

      {dialogOpen ? (
        <div
          className="product-image-zoom-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          onClick={closeDialog}
        >
          <div
            className="product-image-zoom-dialog-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={dialogTitleId} className="sr-only">
              تكبير صورة المنتج
            </h2>
            <button
              ref={closeRef}
              type="button"
              className="product-image-zoom-close"
              aria-label="إغلاق"
              onClick={closeDialog}
            >
              إغلاق
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- dialog viewer uses natural sizing */}
            <img src={image.src} alt={image.alt} />
          </div>
        </div>
      ) : null}
    </>
  );
}
