import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { MAX_GALLERY_UPLOAD_BYTES } from "@/features/admin/domain/gallery-upload-limits";

import {
  removeProductPhoto,
  uploadProductPhoto,
} from "@/features/admin/product-capture/product-capture-service";

export interface StoredProductImage {
  src: string;
  width: number;
  height: number;
}

export interface ProductImageStore {
  put(webp: Buffer): Promise<StoredProductImage>;
  remove?(src: string): Promise<boolean>;
}

export const DEV_PRODUCT_IMAGE_PREFIX = "/dev-product-images/";
const DEV_FILE = /^[0-9a-f-]{36}\.webp$/;

function localRoot() {
  return path.join(process.cwd(), ".local-documents", "product-images");
}

export async function readDevProductImage(
  file: string,
): Promise<Buffer | null> {
  if (process.env.NODE_ENV === "production" || !DEV_FILE.test(file)) {
    return null;
  }
  try {
    return await readFile(path.join(localRoot(), file));
  } catch {
    return null;
  }
}

// Product photos are public storefront assets; development without Supabase keeps them on disk.
export function getProductImageStore(): ProductImageStore {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
    return { put: uploadProductPhoto, remove: removeProductPhoto };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }
  return {
    async remove(src) {
      const file = src.startsWith(DEV_PRODUCT_IMAGE_PREFIX)
        ? src.slice(DEV_PRODUCT_IMAGE_PREFIX.length)
        : "";
      if (!DEV_FILE.test(file)) return false;
      await rm(path.join(localRoot(), file), { force: true });
      return true;
    },
    async put(webp) {
      const file = `${randomUUID()}.webp`;
      await mkdir(localRoot(), { recursive: true });
      await writeFile(path.join(localRoot(), file), webp, { flag: "wx" });
      const metadata = await sharp(webp).metadata();
      return {
        src: `${DEV_PRODUCT_IMAGE_PREFIX}${file}`,
        width: metadata.width ?? 1_200,
        height: metadata.height ?? 1_200,
      };
    },
  };
}

const MAX_GALLERY_PIXELS = 40_000_000;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class GalleryUploadError extends Error {
  constructor(readonly code: "too_large" | "unsupported" | "too_many_pixels") {
    super(code);
  }
}

// The real format is read from the file content, never from its name or declared type; SVG is never accepted.
export async function prepareGalleryImage(bytes: Buffer): Promise<Buffer> {
  if (bytes.byteLength > MAX_GALLERY_UPLOAD_BYTES) {
    throw new GalleryUploadError("too_large");
  }
  let metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw new GalleryUploadError("unsupported");
  }
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new GalleryUploadError("unsupported");
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_GALLERY_PIXELS
  ) {
    throw new GalleryUploadError("too_many_pixels");
  }
  return sharp(bytes)
    .rotate()
    .resize(1_600, 1_600, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer();
}
