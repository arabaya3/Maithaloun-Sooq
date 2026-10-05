import { assistantConversations } from "@/features/admin/application/admin-services";
import {
  jsonNoStore,
  unauthorizedJson,
} from "@/features/admin/auth/admin-api-response";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { assistantToolContext } from "@/features/assistant/application/assistant-access";
import { runAssistantSmokeTest } from "@/features/assistant/application/smoke-test-service";
import {
  SMOKE_RATE_LIMIT,
  smokeTestEnabled,
} from "@/features/assistant/domain/smoke-test";
import { db } from "@/server/db/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Owner-only, same-origin, rate-limited and off unless ASSISTANT_SMOKE_TEST=on.
export async function POST(request: Request) {
  if (!smokeTestEnabled(process.env)) {
    return jsonNoStore({ ok: false, message: "فحص المساعد غير مفعّل." }, 404);
  }
  const actor = await authorizeAdminApi(request, true);
  if (!actor) return unauthorizedJson();
  if (actor.role !== "owner") {
    return jsonNoStore({ ok: false, message: "هذا الفحص للمالك فقط." }, 403);
  }
  if (!process.env.OPENAI_API_KEY && process.env.AI_FAKE_MODE !== "1") {
    return jsonNoStore(
      { ok: false, message: "المساعد غير مهيأ على الخادم بعد." },
      503,
    );
  }
  if (
    !(await allowAdminRequest(
      actor,
      SMOKE_RATE_LIMIT.scope,
      SMOKE_RATE_LIMIT.perHour,
    ))
  ) {
    return jsonNoStore(
      { ok: false, message: "تم تشغيل الفحص كثيراً. حاولي بعد قليل." },
      429,
    );
  }
  const result = await runAssistantSmokeTest(
    db,
    actor,
    (conversationId) => assistantToolContext(actor, conversationId, "read"),
    assistantConversations,
  );
  return jsonNoStore({ ok: true, ...result });
}
