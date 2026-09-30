import {
  jsonNoStore,
  unauthorizedJson,
} from "@/features/admin/auth/admin-api-response";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { can } from "@/features/admin/domain/permissions";
import { detectAudioType } from "@/features/voice/domain/audio-type";
import {
  MAX_AUDIO_BYTES,
  MAX_TRANSCRIPT_LENGTH,
} from "@/features/voice/domain/voice-constants";
import { AiError } from "@/server/ai/openai-client";
import { getSpeechTranscriber } from "@/server/ai/voice-interpreter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(request: Request) {
  const actor = await authorizeAdminApi(request, true);
  if (!actor || !can(actor, "sales.record")) return unauthorizedJson();
  if (!(await allowAdminRequest(actor, "admin_voice_stt", 120))) {
    return jsonNoStore(
      { ok: false, message: "عدد التسجيلات كبير. حاولي بعد قليل." },
      429,
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) {
    return jsonNoStore({ ok: false, message: "التسجيل طويل جداً." }, 413);
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  const type = detectAudioType(bytes);
  if (!type || bytes.byteLength > MAX_AUDIO_BYTES) {
    return jsonNoStore(
      {
        ok: false,
        message: "تعذّر قراءة التسجيل. اكتبي العملية بدلاً من ذلك.",
      },
      400,
    );
  }
  try {
    // The audio lives only in this request; nothing is stored.
    const transcript = await getSpeechTranscriber().transcribe({
      bytes,
      ...type,
    });
    return jsonNoStore({
      ok: true,
      transcript: transcript.trim().slice(0, MAX_TRANSCRIPT_LENGTH),
    });
  } catch (error) {
    return jsonNoStore(
      {
        ok: false,
        message:
          error instanceof AiError && error.code === "AI_NOT_CONFIGURED"
            ? "تحويل الصوت إلى نص غير مهيأ بعد. اكتبي العملية."
            : "تعذّر تحويل التسجيل إلى نص. أعيدي المحاولة أو اكتبي العملية.",
      },
      502,
    );
  }
}
