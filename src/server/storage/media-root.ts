import "server-only";

import path from "node:path";

/**
 * Self-hosted file storage. When MEDIA_ROOT is set (the server's data folder), files live on disk:
 * public product photos under <root>/public, private documents under <root>/private.
 */
export function getMediaRoot(): string | null {
  const root = process.env.MEDIA_ROOT?.trim();
  return root ? path.resolve(root) : null;
}

export const MEDIA_URL_PREFIX = "/media/";
export const MEDIA_PRODUCT_PREFIX = "/media/products/";
export const MEDIA_PRODUCT_FILE = /^[0-9a-f-]{36}\.webp$/;
export const MEDIA_PRODUCT_SRC = /^\/media\/products\/[0-9a-f-]{36}\.webp$/;

const PUBLIC_FILE = /^[a-z0-9][a-z0-9_-]{0,80}\/[a-z0-9][a-z0-9_.-]{0,120}$/;
const TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** Resolves a public media path ("products/<uuid>.webp") to a file inside <root>/public, or null. */
export function resolvePublicMedia(
  root: string,
  relative: string,
): { file: string; type: string } | null {
  if (!PUBLIC_FILE.test(relative) || relative.includes("..")) return null;
  const type = TYPES[path.extname(relative).toLowerCase()];
  if (!type) return null;
  const base = path.join(root, "public");
  const file = path.join(base, ...relative.split("/"));
  if (!file.startsWith(base + path.sep)) return null;
  return { file, type };
}
