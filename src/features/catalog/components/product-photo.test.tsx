import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductImageZoom } from "@/features/catalog/components/product-image-zoom";
import { ProductPhoto } from "@/features/catalog/components/product-photo";

const missing = {
  src: "/dev-product-images/00000000-0000-0000-0000-000000000000.webp",
  alt: "منظف عام Secret",
};

describe("missing product images", () => {
  it("swaps a failed card photo for a same-size placeholder once", () => {
    const { container } = render(
      <ProductPhoto
        {...missing}
        className="product-art"
        sizes="50vw"
        priority={false}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: missing.alt }));

    const fallback = screen.getByRole("img", { name: missing.alt });
    expect(fallback).toHaveClass("product-art");
    expect(fallback).toHaveAttribute("data-image-kind", "missing");
    expect(container.querySelector("img")).toBeNull();
  });

  it("swaps a failed detail photo for the placeholder", () => {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    const { container } = render(
      <ProductImageZoom
        image={{ kind: "image", width: 800, height: 800, ...missing }}
      />,
    );

    fireEvent.error(container.querySelector("img")!);

    expect(screen.getByRole("img", { name: missing.alt })).toHaveClass(
      "product-detail-media",
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
