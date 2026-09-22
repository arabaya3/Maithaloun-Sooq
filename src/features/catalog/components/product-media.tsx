import Image from "next/image";

import { ProductPlaceholder } from "@/features/catalog/components/product-placeholder";
import type { Product } from "@/features/catalog/domain/product";

export function ProductMedia({
  product,
  className = "product-art",
  sizes = "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw",
  priority = false,
}: {
  product: Product;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  if (product.image.kind === "image") {
    return (
      <div
        className={`${className} product-art--photo`}
        data-image-kind="image"
      >
        <Image
          src={product.image.src}
          alt={product.image.alt}
          fill
          sizes={sizes}
          className="product-photo"
          priority={priority}
        />
      </div>
    );
  }

  return (
    <div className={className} data-image-kind="placeholder">
      <ProductPlaceholder kind={product.image.variant} />
    </div>
  );
}
