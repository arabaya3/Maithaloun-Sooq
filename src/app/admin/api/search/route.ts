import { adminSearchService } from "@/features/admin/application/admin-services";
import {
  jsonNoStore,
  unauthorizedJson,
} from "@/features/admin/auth/admin-api-response";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { errorCode, logEvent } from "@/server/log/ops-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Typing is debounced on the client, so an hour of busy searching stays well inside this.
const SEARCHES_PER_HOUR = 1_200;

export async function GET(request: Request) {
  const actor = await authorizeAdminApi(request);
  if (!actor) return unauthorizedJson();
  if (!(await allowAdminRequest(actor, "admin_search", SEARCHES_PER_HOUR))) {
    return jsonNoStore(
      { ok: false, message: "بحثتِ كثيراً خلال وقت قصير. حاولي بعد قليل." },
      429,
    );
  }
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const startedAt = Date.now();
  try {
    const groups = await adminSearchService.search(actor, query);
    // The query itself is never logged: it may be a phone number or a name.
    logEvent("info", "admin.search", {
      durationMs: Date.now() - startedAt,
      groups: groups.length,
    });
    return jsonNoStore({ ok: true, groups });
  } catch (error) {
    logEvent("error", "admin.search.failed", { code: errorCode(error) });
    return jsonNoStore(
      { ok: false, message: "تعذّر البحث الآن. حاولي مرة أخرى." },
      500,
    );
  }
}
