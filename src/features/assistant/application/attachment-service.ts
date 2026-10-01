import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import type { Database } from "@/features/inventory/application/stock-ledger";
import { ATTACHMENT_TTL_MS } from "@/features/assistant/domain/assistant-policy";
import * as schema from "@/server/db/schema";
import type { PrivateDocumentStore } from "@/server/storage/private-documents";

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const IMAGE_FORMATS = new Set(["jpeg", "png", "webp"]);

export class AttachmentError extends Error {
  constructor(
    readonly code: "unsupported_file" | "file_too_large" | "not_found",
  ) {
    super(code);
    this.name = "AttachmentError";
  }
}

export interface AttachmentView {
  id: string;
  kind: "image" | "pdf";
  width: number | null;
  height: number | null;
  previewUrl: string | null;
}

function isPdf(bytes: Buffer) {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

export class AttachmentService {
  constructor(
    private readonly database: Database,
    private readonly store: () => PrivateDocumentStore,
  ) {}

  // The declared type is ignored; images are decoded and re-encoded, which drops EXIF and location data.
  async upload(actor: AdminActor, bytes: Buffer): Promise<AttachmentView> {
    if (!bytes.byteLength) throw new AttachmentError("unsupported_file");
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentError("file_too_large");
    }
    let stored: Buffer;
    let mimeType: string;
    let extension: string;
    let width: number | null = null;
    let height: number | null = null;
    if (isPdf(bytes)) {
      stored = bytes;
      mimeType = "application/pdf";
      extension = "pdf";
    } else {
      let metadata: Metadata;
      try {
        metadata = await sharp(bytes).metadata();
      } catch {
        throw new AttachmentError("unsupported_file");
      }
      if (
        !metadata.format ||
        !IMAGE_FORMATS.has(metadata.format) ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > MAX_PIXELS
      ) {
        throw new AttachmentError("unsupported_file");
      }
      const { data, info } = await sharp(bytes)
        .rotate()
        .resize(2_200, 2_200, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 86 })
        .toBuffer({ resolveWithObject: true });
      stored = data;
      mimeType = "image/jpeg";
      extension = "jpg";
      width = info.width;
      height = info.height;
    }

    const id = randomUUID();
    const location = await this.store().put(
      `assistant/${actor.id}/${id}.${extension}`,
      stored,
      mimeType,
    );
    await this.database.insert(schema.adminAssistantAttachments).values({
      id,
      adminUserId: actor.id,
      mimeType,
      byteSize: stored.byteLength,
      sha256: createHash("sha256").update(stored).digest("hex"),
      width,
      height,
      storageProvider: location.provider,
      storageBucket: location.bucket,
      storagePath: location.path,
      expiresAt: new Date(Date.now() + ATTACHMENT_TTL_MS),
    });
    return {
      id,
      kind: mimeType === "application/pdf" ? "pdf" : "image",
      width,
      height,
      previewUrl:
        mimeType === "application/pdf"
          ? null
          : `/admin/api/assistant/attachments/${id}`,
    };
  }

  async get(actor: AdminActor, attachmentId: string) {
    if (!z.uuid().safeParse(attachmentId).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.adminAssistantAttachments)
      .where(
        and(
          eq(schema.adminAssistantAttachments.id, attachmentId),
          eq(schema.adminAssistantAttachments.adminUserId, actor.id),
        ),
      )
      .limit(1);
    if (!row || row.status === "deleted") return null;
    return row;
  }

  async read(
    actor: AdminActor,
    attachmentId: string,
  ): Promise<{ bytes: Buffer; mimeType: string; name: string } | null> {
    const row = await this.get(actor, attachmentId);
    if (!row) return null;
    const bytes = await this.store().read({
      provider: row.storageProvider as "supabase" | "local",
      bucket: row.storageBucket,
      path: row.storagePath,
    });
    return {
      bytes,
      mimeType: row.mimeType,
      name: `attachment.${row.mimeType === "application/pdf" ? "pdf" : "jpg"}`,
    };
  }

  async markUsed(attachmentId: string): Promise<void> {
    await this.database
      .update(schema.adminAssistantAttachments)
      .set({ status: "used" })
      .where(eq(schema.adminAssistantAttachments.id, attachmentId));
  }

  // Unused uploads are removed from storage once they expire; used ones stay as evidence.
  async expireTemporary(now: Date): Promise<number> {
    const expired = await this.database
      .select()
      .from(schema.adminAssistantAttachments)
      .where(
        and(
          eq(schema.adminAssistantAttachments.status, "temporary"),
          lt(schema.adminAssistantAttachments.expiresAt, now),
        ),
      )
      .limit(200);
    for (const row of expired) {
      await this.store().remove({
        provider: row.storageProvider as "supabase" | "local",
        bucket: row.storageBucket,
        path: row.storagePath,
      });
      await this.database
        .update(schema.adminAssistantAttachments)
        .set({ status: "deleted" })
        .where(eq(schema.adminAssistantAttachments.id, row.id));
    }
    return expired.length;
  }
}
