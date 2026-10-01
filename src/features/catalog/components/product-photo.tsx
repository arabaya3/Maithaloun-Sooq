"use client";

import Image from "next/image";
import { useState } from "react";

import { ProductPlaceholder } from "@/features/catalog/components/product-placeholder";

export function MissingProductPhoto({
  alt,
  className,
}: {
  alt: string;
  className: string;
}) {
  return (
    <div
      className={className}
      data-image-kind="missing"
      role="img"
      aria-label={alt}
    >
      <ProductPlaceholder kind="general-cleaner" />
    </div>
  );
}

export function ProductPhoto({
  src,
  alt,
  className,
  sizes,
  priority,
}: {
  src: string;
  alt: string;
  className: string;
  sizes: string;
  priority: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <MissingProductPhoto alt={alt} className={className} />;

  return (
    <div className={`${className} product-art--photo`} data-image-kind="image">
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className="product-photo"
        priority={priority}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
