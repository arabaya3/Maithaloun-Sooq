import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductImageZoom } from "@/features/catalog/components/product-image-zoom";

vi.mock("next/image", () => ({
  default: ({
    alt,
    style,
    className,
  }: {
    alt: string;
    style?: React.CSSProperties;
    className?: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub
    <img alt={alt} className={className} style={style} src="/test.jpg" />
  ),
}));

function mockMatchMedia({
  coarse = false,
  reduceMotion = false,
}: {
  coarse?: boolean;
  reduceMotion?: boolean;
} = {}) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches:
        (query.includes("pointer: coarse") && coarse) ||
        (query.includes("prefers-reduced-motion: reduce") && reduceMotion),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const image = {
  kind: "image" as const,
  src: "/products/arar.jpg",
  alt: "سائل جلي عرار",
};

describe("ProductImageZoom", () => {
  beforeEach(() => {
    mockMatchMedia();
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("magnifies the photo inside the frame on pointer move", () => {
    render(<ProductImageZoom image={image} />);

    const trigger = screen.getByRole("button", { name: "تكبير صورة المنتج" });
    const photo = trigger.querySelector("img");
    expect(photo).toBeTruthy();

    Object.defineProperty(photo, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 300,
        right: 200,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerMove(trigger, { clientX: 50, clientY: 75 });

    expect(trigger).toHaveAttribute("data-zooming", "true");
    expect(photo).toHaveStyle({
      transform: "scale(2)",
      transformOrigin: "25% 25%",
    });
    expect(trigger.querySelector(".product-image-zoom-lens")).toBeNull();
  });

  it("opens a dialog from the keyboard without leaving a lens overlay", async () => {
    const user = userEvent.setup();
    render(<ProductImageZoom image={image} />);

    const trigger = screen.getByRole("button", { name: "تكبير صورة المنتج" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("dialog", { name: "تكبير صورة المنتج" }),
    ).toBeInTheDocument();
    expect(trigger.querySelector(".product-image-zoom-lens")).toBeNull();
  });

  it("opens the dialog on click for coarse pointers", async () => {
    mockMatchMedia({ coarse: true });
    const user = userEvent.setup();
    render(<ProductImageZoom image={image} />);

    await user.click(screen.getByRole("button", { name: "تكبير صورة المنتج" }));

    expect(
      screen.getByRole("dialog", { name: "تكبير صورة المنتج" }),
    ).toBeInTheDocument();
  });
});
