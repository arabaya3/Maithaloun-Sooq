import { describe, expect, it } from "vitest";

import {
  MAX_GALLERY_UPLOAD_BYTES,
  galleryFileProblem,
  galleryUploadMessages,
} from "./gallery-upload-limits";

describe("galleryFileProblem", () => {
  it("rejects a 9.5 MB image before it is sent", () => {
    expect(
      galleryFileProblem({ size: 9.5 * 1024 * 1024, type: "image/jpeg" }),
    ).toBe(galleryUploadMessages.too_large);
  });

  it("accepts an image at the limit and rejects other types", () => {
    expect(
      galleryFileProblem({
        size: MAX_GALLERY_UPLOAD_BYTES,
        type: "image/webp",
      }),
    ).toBeNull();
    expect(galleryFileProblem({ size: 10, type: "image/svg+xml" })).toBe(
      galleryUploadMessages.unsupported,
    );
  });
});
