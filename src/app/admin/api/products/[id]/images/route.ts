import { z } from "zod";

import { uploadGalleryImage } from "@/features/admin/application/gallery-upload";
import {
  jsonNoStore,
  unauthorizedJson,
} from "@/features/admin/auth/admin-api-response";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import {
  MAX_GALLERY_UPLOAD_BYTES,
  galleryUploadMessages,
} from "@/features/admin/domain/gallery-upload-limits";
import { errorCode, logEvent } from "@/server/log/ops-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const productId = z.string().regex(/^[a-z0-9-]{1,80}$/);

// Reads at most `limit` bytes so a body without Content-Length cannot exhaust memory.
async function readCapped(
  request: Request,
  limit: number,
): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// One image per request: Server Actions stay at the 1MB default, this route alone accepts up to 8MB.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await authorizeAdminApi(request, true);
  if (!actor) return unauthorizedJson();
  const domainId = productId.safeParse((await context.params).id);
  if (!domainId.success) {
    return jsonNoStore({ ok: false, message: "البيانات غير صالحة." }, 400);
  }
  const tooLarge = () =>
    jsonNoStore({ ok: false, message: galleryUploadMessages.too_large }, 413);
  if (
    Number(request.headers.get("content-length") ?? 0) >
    MAX_GALLERY_UPLOAD_BYTES
  ) {
    return tooLarge();
  }
  const bytes = await readCapped(request, MAX_GALLERY_UPLOAD_BYTES);
  if (!bytes) return tooLarge();
  if (!bytes.byteLength) {
    return jsonNoStore(
      { ok: false, message: "اختر صورة واحدة على الأقل." },
      400,
    );
  }
  const alt = new URL(request.url).searchParams.get("alt") ?? "";
  try {
    const result = await uploadGalleryImage(actor, domainId.data, bytes, alt);
    if (!result.ok) {
      return jsonNoStore({ ok: false, message: result.message }, result.status);
    }
    return jsonNoStore({ ok: true });
  } catch (error) {
    logEvent("warn", "admin.gallery_upload.failed", { code: errorCode(error) });
    return jsonNoStore(
      { ok: false, message: galleryUploadMessages.failed },
      500,
    );
  }
}
