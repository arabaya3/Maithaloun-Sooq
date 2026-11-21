import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { MEDIA_PRODUCT_SRC, resolvePublicMedia } = await import("./media-root");

const root = path.resolve("/data/media");

describe("resolvePublicMedia", () => {
  it("maps a product photo into the public folder", () => {
    const hit = resolvePublicMedia(
      root,
      "products/0b8f4c1e-2f8a-4b8e-9a51-3c1f0e2d4a6b.webp",
    );
    expect(hit?.type).toBe("image/webp");
    expect(hit?.file).toBe(
      path.join(
        root,
        "public",
        "products",
        "0b8f4c1e-2f8a-4b8e-9a51-3c1f0e2d4a6b.webp",
      ),
    );
  });

  it.each([
    "../private/x.webp",
    "products/../../etc/passwd",
    "products/a.svg",
    "products/a.html",
    "private",
    "a/b/c.webp",
    "Products/A.webp",
  ])("refuses %s", (relative) => {
    expect(resolvePublicMedia(root, relative)).toBeNull();
  });
});

describe("MEDIA_PRODUCT_SRC", () => {
  it("accepts only stored product photo paths", () => {
    expect(
      MEDIA_PRODUCT_SRC.test(
        "/media/products/0b8f4c1e-2f8a-4b8e-9a51-3c1f0e2d4a6b.webp",
      ),
    ).toBe(true);
    expect(MEDIA_PRODUCT_SRC.test("/media/products/x.webp")).toBe(false);
    expect(MEDIA_PRODUCT_SRC.test("//evil.example/media/products/x.webp")).toBe(
      false,
    );
  });
});
