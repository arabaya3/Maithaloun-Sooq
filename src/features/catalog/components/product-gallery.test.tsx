import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  ProductGallery,
  type GalleryItem,
} from "@/features/catalog/components/product-gallery";
import { renderWithProviders } from "@/test/render-with-providers";

const image = (id: string, width = 800, height = 800): GalleryItem => ({
  id,
  src: `/products/${id}.webp`,
  alt: `صورة ${id}`,
  width,
  height,
  sortOrder: 0,
  isPrimary: false,
  scope: "product",
  variantId: null,
  optionId: null,
  optionValueId: null,
  scopeLabel: null,
});

function Gallery({ images }: { images: GalleryItem[] }) {
  const [active, setActive] = useState(images[0]!.id);
  return (
    <ProductGallery
      images={images}
      activeId={active}
      priorityId={images[0]!.id}
      label="معرض"
      onSelect={(next) => setActive(next.id)}
    />
  );
}

function hover(stage: Element) {
  fireEvent.pointerMove(stage, {
    pointerType: "mouse",
    clientX: 10,
    clientY: 10,
  });
}

describe("product gallery", () => {
  it("shows one photo on the same stage without arrows, thumbnails or a counter", () => {
    const { container } = renderWithProviders(
      <Gallery images={[image("one")]} />,
      { products: [] },
    );
    expect(container.querySelector(".product-gallery-stage")).not.toBeNull();
    expect(container.querySelector(".product-gallery-image")).not.toBeNull();
    expect(container.querySelector(".product-gallery-arrows")).toBeNull();
    expect(container.querySelector(".product-gallery-thumbs")).toBeNull();
    expect(
      container.querySelector(".product-gallery-position"),
    ).toHaveAttribute("hidden");
  });

  it("uses the same stage for several photos, with arrows and thumbnails", () => {
    const { container } = renderWithProviders(
      <Gallery images={[image("a"), image("b", 1200, 300), image("c")]} />,
      { products: [] },
    );
    expect(container.querySelectorAll(".product-gallery-stage")).toHaveLength(
      1,
    );
    expect(container.querySelector(".product-gallery-arrows")).not.toBeNull();
    expect(
      container.querySelectorAll(".product-gallery-thumbs button"),
    ).toHaveLength(3);
  });

  it("zooms with the mouse and starts unzoomed again after changing photo", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <Gallery images={[image("a"), image("b")]} />,
      { products: [] },
    );
    const stage = container.querySelector(".product-gallery-stage")!;
    hover(stage);
    expect(stage).toHaveAttribute("data-zooming", "true");
    expect(
      (container.querySelector(".product-gallery-image") as HTMLElement).style
        .transform,
    ).toContain("scale");

    await user.click(screen.getByRole("button", { name: "الصورة التالية" }));
    expect(stage).toHaveAttribute("data-zooming", "false");
    hover(stage);
    const shown = container.querySelector(".product-gallery-image")!;
    expect(shown).toHaveAttribute("alt", "صورة b");
    expect((shown as HTMLElement).style.transform).toContain("scale");
  });

  it("opens a full-screen viewer that moves between photos and closes with Escape", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Gallery images={[image("a"), image("b")]} />, {
      products: [],
    });
    await user.click(
      screen.getByRole("button", { name: "فتح الصورة بحجم كامل" }),
    );
    const viewer = screen.getByRole("dialog", { name: "فتح الصورة بحجم كامل" });
    expect(viewer.querySelector("img")).toHaveAttribute(
      "src",
      "/products/a.webp",
    );
    const nextButtons = screen.getAllByRole("button", {
      name: "الصورة التالية",
    });
    await user.click(nextButtons.at(-1)!);
    expect(viewer.querySelector("img")).toHaveAttribute(
      "src",
      "/products/b.webp",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
