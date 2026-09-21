import Image from "next/image";

import { ProductPlaceholder } from "@/features/catalog/components/product-placeholder";
import type { Product } from "@/features/catalog/domain/product";

export function ProductMedia({
  product,
  className = "product-art",
  sizes = "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw",
}: {
  product: Product;
  className?: string;
  sizes?: string;
}) {
  return (
    <div className={className}>
      {product.image.kind === "image" ? (
        <Image
          src={product.image.src}
          alt={product.image.alt}
          fill
          sizes={sizes}
        />
      ) : (
        <ProductPlaceholder kind={product.image.variant} />
      )}
    </div>
  );
}
