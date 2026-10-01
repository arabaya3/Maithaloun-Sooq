import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { uploadProductPhoto } from "@/features/admin/product-capture/product-capture-service";

export interface StoredProductImage {
  src: string;
  width: number;
  height: number;
}

export interface ProductImageStore {
  put(webp: Buffer): Promise<StoredProductImage>;
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
    return { put: uploadProductPhoto };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }
  return {
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
