import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({
    alt,
    onError,
    ...props
  }: {
    alt: string;
    onError?: () => void;
    src: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} data-src={props.src} onError={onError} />
  ),
}));

import { PromoBanner } from "./promo-banner";

describe("PromoBanner", () => {
  it("renders Maythalun hero copy and local media shell", () => {
    const { container } = render(<PromoBanner />);

    expect(
      screen.getByRole("heading", { level: 1, name: "من ميثلون… لبيتك" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("احتياجات النظافة والمنزل بسهولة، مع توصيل محلي."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "تسوّق المنتجات" }),
    ).toHaveAttribute("href", "#catalog");
    expect(container.querySelector(".promo-media")).not.toBeNull();
    expect(container.querySelector(".promo-overlay")).not.toBeNull();
  });

  it("falls back to jpeg then warm surface if image loading fails", () => {
    const { container } = render(<PromoBanner />);
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(container.querySelector("img")?.getAttribute("data-src")).toBe(
      "/assets/hero/maythalun-1280.jpg",
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".promo-banner")).not.toBeNull();
  });
});
