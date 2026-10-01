import { ProductImageZoom } from "@/features/catalog/components/product-image-zoom";
import { ProductPhoto } from "@/features/catalog/components/product-photo";
import { ProductPlaceholder } from "@/features/catalog/components/product-placeholder";
import type { Product } from "@/features/catalog/domain/product";

type ProductImage = Product["image"];

export function ProductMedia({
  product,
  image,
  className = "product-art",
  sizes = "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw",
  priority = false,
  enableZoom = false,
}: {
  product: Product;
  image?: ProductImage;
  className?: string;
  sizes?: string;
  priority?: boolean;
  enableZoom?: boolean;
}) {
  const displayImage = image ?? product.image;

  if (displayImage.kind === "image") {
    if (enableZoom) {
      return (
        <ProductImageZoom
          key={displayImage.src}
          image={displayImage}
          className={className}
          sizes={sizes}
          priority={priority}
        />
      );
    }

    return (
      <ProductPhoto
        key={displayImage.src}
        src={displayImage.src}
        alt={displayImage.alt}
        className={className}
        sizes={sizes}
        priority={priority}
      />
    );
  }

  return (
    <div className={className} data-image-kind="placeholder">
      <ProductPlaceholder kind={displayImage.variant} />
    </div>
  );
}
