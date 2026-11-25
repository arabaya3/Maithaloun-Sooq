import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductCategory } from "@/features/catalog/domain/category";
import { withDefaultVariant } from "@/test/mock-product-repository";
import { renderWithProviders } from "@/test/render-with-providers";

import {
  DAILY_GROUP_INTERVAL_MS,
  DAILY_GROUP_PREFETCH_MS,
  DailyCategoryBanner,
} from "./daily-category-banner";

const category = {
  code: "laundry",
  nameAr: "الغسيل",
  nameEn: "Laundry",
  icon: "shirt",
  sortOrder: 30,
} as unknown as ProductCategory;

function makeProducts(count: number) {
  return Array.from({ length: count }, (_, index) =>
    withDefaultVariant({
      id: `laundry-${index}`,
      slug: `laundry-item-${index}`,
      nameAr: `منتج غسيل ${index + 1}`,
      priceAgorot: 900,
      categoryId: "laundry",
      image: {
        kind: "image",
        src: `/media/laundry-${index}.webp`,
        alt: `منتج غسيل ${index + 1}`,
        width: 800,
        height: 800,
      },
      availability: "available",
      detailsStatus: "placeholder",
    }),
  );
}

let reducedMotion = false;

function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce") ? reducedMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function renderBanner(count: number, locale: "ar" | "en" = "ar") {
  const products = makeProducts(count);
  const view = renderWithProviders(
    <DailyCategoryBanner
      category={category}
      products={products}
      productCount={14}
    />,
    { products, locale },
  );
  return { products, ...view };
}

function activeGroup(container: HTMLElement) {
  return container.querySelector<HTMLElement>(
    '.daily-scene-group[data-active="true"]',
  )!;
}

function activeIds(container: HTMLElement) {
  return [...activeGroup(container).querySelectorAll("a")].map((link) =>
    link.getAttribute("href")!.replace(/.*laundry-item-/, ""),
  );
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  stubMatchMedia();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
});

describe("DailyCategoryBanner", () => {
  it("shows the category, a neutral subtitle, its product count and a link to shop it", () => {
    renderBanner(3);
    expect(
      screen.getByRole("heading", { level: 2, name: "الغسيل" }),
    ).toBeVisible();
    expect(screen.getByText("اكتشف الغسيل")).toBeVisible();
    expect(screen.getByText("14 منتجًا في هذا القسم")).toBeVisible();
    const cta = screen.getByRole("link", { name: /^تسوّق القسم: الغسيل/ });
    expect(cta).toHaveAttribute(
      "href",
      expect.stringContaining("/categories/laundry"),
    );
    expect(cta).toHaveTextContent("تسوّق القسم");
  });

  it("uses the category description from the catalog when there is one", () => {
    const products = makeProducts(1);
    renderWithProviders(
      <DailyCategoryBanner
        category={{ ...category, description: "كل ما يلزم للغسيل" } as ProductCategory}
        products={products}
      />,
      { products },
    );
    expect(screen.getByText("كل ما يلزم للغسيل")).toBeVisible();
    expect(screen.queryByText("اكتشف الغسيل")).toBeNull();
  });

  it("splits the products into one product at a time labelled as slides", () => {
    const { container } = renderBanner(3);
    const region = container.querySelector(".daily-category")!;
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    const group = activeGroup(container);
    expect(group).toHaveAttribute("aria-roledescription", "slide");
    expect(group).toHaveAttribute("aria-label", "المجموعة 1 من 3");
    expect(activeIds(container)).toEqual(["0"]);
    expect(screen.queryByRole("button")).toBeNull();
    // Only the first group is mounted: the others' photos are not requested yet.
    expect(container.querySelectorAll(".daily-scene-group")).toHaveLength(1);
  });

  it("moves to the next group after exactly eight seconds, not before", () => {
    const { container } = renderBanner(2);
    expect(DAILY_GROUP_INTERVAL_MS).toBe(8_000);
    advance(DAILY_GROUP_INTERVAL_MS - 1);
    expect(activeIds(container)).toEqual(["0"]);
    advance(1);
    expect(activeIds(container)).toEqual(["1"]);
    advance(DAILY_GROUP_INTERVAL_MS);
    expect(activeIds(container)).toEqual(["0"]);
  });

  it("mounts the next group a few seconds before it appears, hidden and inert", () => {
    const { container } = renderBanner(2);
    const lead = Math.min(DAILY_GROUP_PREFETCH_MS, DAILY_GROUP_INTERVAL_MS / 2);
    advance(DAILY_GROUP_INTERVAL_MS - lead - 1);
    expect(container.querySelectorAll(".daily-scene-group")).toHaveLength(1);
    advance(1);
    const groups = container.querySelectorAll(".daily-scene-group");
    expect(groups).toHaveLength(2);
    expect(groups[1]).toHaveAttribute("aria-hidden", "true");
    expect(groups[1]).toHaveAttribute("inert");
  });

  it("does not rotate while the page is hidden", () => {
    const { container } = renderBanner(2);
    advance(DAILY_GROUP_INTERVAL_MS / 2);
    setHidden(true);
    advance(DAILY_GROUP_INTERVAL_MS * 2);
    expect(activeIds(container)).toEqual(["0"]);
    setHidden(false);
    advance(DAILY_GROUP_INTERVAL_MS);
    expect(activeIds(container)).toEqual(["1"]);
  });

  it("never rotates by itself for reduced motion", () => {
    reducedMotion = true;
    stubMatchMedia();
    const { container } = renderBanner(2);
    advance(DAILY_GROUP_INTERVAL_MS * 3);
    expect(activeIds(container)).toEqual(["0"]);
  });

  it("never rotates with a single group", () => {
    const { container } = renderBanner(1);
    expect(
      container.querySelector(".daily-category"),
    ).not.toHaveAttribute("aria-roledescription");
    advance(DAILY_GROUP_INTERVAL_MS * 2);
    expect(activeIds(container)).toEqual(["0"]);
  });

  it("clears its timers when it goes away", () => {
    const { unmount } = renderBanner(2);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a product whose photo fails instead of leaving a hole", () => {
    const { container } = renderBanner(2);
    const images = activeGroup(container).querySelectorAll("img");
    expect(images).toHaveLength(1);
    fireEvent.error(images[0]!);
    expect(activeIds(container)).toEqual(["1"]);
    expect(
      within(activeGroup(container)).queryByRole("link", {
        name: "منتج غسيل 1",
      }),
    ).toBeNull();
  });
});
