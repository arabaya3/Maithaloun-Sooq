import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

export interface StoredDocumentLocation {
  provider: "supabase" | "local";
  bucket: string;
  path: string;
}

export interface PrivateDocumentStore {
  put(
    objectPath: string,
    bytes: Buffer,
    mimeType: string,
  ): Promise<StoredDocumentLocation>;
  read(location: StoredDocumentLocation): Promise<Buffer>;
  signedUrl(
    location: StoredDocumentLocation,
    expiresInSeconds: number,
  ): Promise<string | null>;
}

const BUCKET = "private-documents";
const SAFE_PATH = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

function assertSafePath(objectPath: string): void {
  if (!SAFE_PATH.test(objectPath) || objectPath.includes("..")) {
    throw new Error("UNSAFE_DOCUMENT_PATH");
  }
}

function supabaseStore(url: string, secret: string): PrivateDocumentStore {
  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let bucketReady = false;

  async function ensureBucket() {
    if (bucketReady) return;
    const existing = await client.storage.getBucket(BUCKET);
    if (existing.error) {
      const created = await client.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: "12MB",
      });
      if (created.error) throw new Error("STORAGE_BUCKET_FAILED");
    } else if (existing.data.public) {
      // Invoices and spreadsheets must never sit in a public bucket.
      throw new Error("STORAGE_BUCKET_PUBLIC");
    }
    bucketReady = true;
  }

  return {
    async put(objectPath, bytes, mimeType) {
      assertSafePath(objectPath);
      await ensureBucket();
      const upload = await client.storage
        .from(BUCKET)
        .upload(objectPath, bytes, { contentType: mimeType, upsert: false });
      if (upload.error) throw new Error("STORAGE_UPLOAD_FAILED");
      return { provider: "supabase", bucket: BUCKET, path: objectPath };
    },
    async read(location) {
      assertSafePath(location.path);
      const download = await client.storage
        .from(location.bucket)
        .download(location.path);
      if (download.error) throw new Error("STORAGE_READ_FAILED");
      return Buffer.from(await download.data.arrayBuffer());
    },
    async signedUrl(location, expiresInSeconds) {
      assertSafePath(location.path);
      const signed = await client.storage
        .from(location.bucket)
        .createSignedUrl(location.path, expiresInSeconds);
      if (signed.error) throw new Error("STORAGE_SIGN_FAILED");
      return signed.data.signedUrl;
    },
  };
}

function localStore(root: string): PrivateDocumentStore {
  const resolve = (objectPath: string) => {
    assertSafePath(objectPath);
    return path.join(root, ...objectPath.split("/"));
  };
  return {
    async put(objectPath, bytes) {
      const target = resolve(objectPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
      return { provider: "local", bucket: "local", path: objectPath };
    },
    read: (location) => readFile(resolve(location.path)),
    signedUrl: async () => null,
  };
}

let cached: PrivateDocumentStore | null = null;

export function getPrivateDocumentStore(): PrivateDocumentStore {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (url && secret) {
    cached = supabaseStore(url, secret);
  } else if (process.env.NODE_ENV !== "production") {
    // Development and tests keep documents on disk, outside the repository and the public folder.
    cached = localStore(path.join(process.cwd(), ".local-documents"));
  } else {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }
  return cached;
}
