import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

/**
 * Rendered posts and Reels. Meta fetches media by URL when publishing, so in production they live
 * in a public Supabase bucket. They are marketing material meant to be public anyway; nothing private
 * is ever rendered into them.
 */
export interface SocialMediaStore {
  put(bytes: Buffer, kind: "jpg" | "mp4"): Promise<string>;
}

const contentTypes = { jpg: "image/jpeg", mp4: "video/mp4" } as const;
export const SOCIAL_BUCKET = "social-media";
export const LOCAL_MEDIA_ROUTE = "/admin/api/social/media/";
const LOCAL_FILE = /^[0-9a-f-]{36}\.(jpg|mp4)$/;

export function supabaseMediaStore(
  url: string,
  secret: string,
): SocialMediaStore {
  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let bucketReady = false;
  return {
    async put(bytes, kind) {
      if (!bucketReady) {
        const existing = await client.storage.getBucket(SOCIAL_BUCKET);
        if (existing.error) {
          const created = await client.storage.createBucket(SOCIAL_BUCKET, {
            public: true,
            allowedMimeTypes: Object.values(contentTypes),
            fileSizeLimit: "50MB",
          });
          if (created.error) throw new Error("STORAGE_BUCKET_FAILED");
        }
        bucketReady = true;
      }
      const objectPath = `posts/${randomUUID()}.${kind}`;
      const upload = await client.storage
        .from(SOCIAL_BUCKET)
        .upload(objectPath, bytes, {
          contentType: contentTypes[kind],
          cacheControl: "31536000",
          upsert: false,
        });
      if (upload.error) throw new Error("STORAGE_UPLOAD_FAILED");
      return client.storage.from(SOCIAL_BUCKET).getPublicUrl(objectPath).data
        .publicUrl;
    },
  };
}

export function localMediaRoot(): string {
  return path.join(process.cwd(), ".local-documents", "social-media");
}

/** Development only: files on disk, served to signed-in admins by the media route. */
export function localMediaStore(root = localMediaRoot()): SocialMediaStore {
  return {
    async put(bytes, kind) {
      const file = `${randomUUID()}.${kind}`;
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, file), bytes, { flag: "wx" });
      return `${LOCAL_MEDIA_ROUTE}${file}`;
    },
  };
}

export async function readLocalMedia(
  file: string,
  root = localMediaRoot(),
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const match = LOCAL_FILE.exec(file);
  if (!match) return null;
  try {
    return {
      bytes: await readFile(path.join(root, file)),
      contentType: contentTypes[match[1] as "jpg" | "mp4"],
    };
  } catch {
    return null;
  }
}

/** Meta can only fetch media from a public https address; local files are for previews only. */
export function isPublishableMediaUrl(url: string | null): url is string {
  return Boolean(url && url.startsWith("https://"));
}

export function mediaStoreFromEnv(env: {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}): SocialMediaStore {
  if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    return supabaseMediaStore(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  }
  return localMediaStore();
}

/**
 * The bytes of a stored video or image, for an admin download. Only our own media is read: a
 * local preview file, or an object in this project's public bucket. Any other address is refused.
 */
export async function readStoredMedia(
  url: string,
  supabaseUrl: string | undefined,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (url.startsWith(LOCAL_MEDIA_ROUTE)) {
    return readLocalMedia(url.slice(LOCAL_MEDIA_ROUTE.length));
  }
  if (!supabaseUrl) return null;
  const prefix = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${SOCIAL_BUCKET}/posts/`;
  const match = url.startsWith(prefix)
    ? LOCAL_FILE.exec(url.slice(prefix.length))
    : null;
  if (!match) return null;
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) return null;
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: contentTypes[match[1] as "jpg" | "mp4"],
  };
}
