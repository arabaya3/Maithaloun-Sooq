import { assistantAttachments } from "@/features/admin/application/admin-services";
import { jsonNoStore } from "@/features/admin/auth/admin-api-response";
import { authorizeAssistant } from "@/features/assistant/application/assistant-access";
import {
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
} from "@/features/assistant/application/attachment-service";
import { errorCode, logEvent } from "@/server/log/ops-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const messages: Record<AttachmentError["code"], string> = {
  unsupported_file:
    "نوع الملف غير مدعوم. المسموح: صور JPG أو PNG أو WebP، أو ملف PDF.",
  file_too_large: "الملف كبير جداً.",
  not_found: "المرفق غير موجود.",
};

export async function POST(request: Request) {
  const started = Date.now();
  const access = await authorizeAssistant(request, {
    mutation: true,
    limit: "upload",
  });
  if (access instanceof Response) return access;
  if (
    Number(request.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES
  ) {
    return jsonNoStore({ ok: false, message: messages.file_too_large }, 413);
  }
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    const attachment = await assistantAttachments.upload(access.actor, bytes);
    logEvent("info", "assistant.attachment.uploaded", {
      kind: attachment.kind,
      bytes: bytes.byteLength,
      durationMs: Date.now() - started,
    });
    return jsonNoStore({ ok: true, attachment });
  } catch (error) {
    logEvent("warn", "assistant.attachment.failed", {
      code: errorCode(error),
      durationMs: Date.now() - started,
    });
    if (error instanceof AttachmentError) {
      return jsonNoStore({ ok: false, message: messages[error.code] }, 400);
    }
    return jsonNoStore(
      { ok: false, message: "تعذّر حفظ المرفق. أعيدي المحاولة." },
      500,
    );
  }
}
