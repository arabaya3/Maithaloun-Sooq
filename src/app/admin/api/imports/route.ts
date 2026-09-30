import { extractionService } from "@/features/admin/application/admin-services";
import {
  jsonNoStore,
  unauthorizedJson,
} from "@/features/admin/auth/admin-api-response";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { mapExtractionError } from "@/features/inventory/application/inventory-action-errors";
import { MAX_SPREADSHEET_BYTES } from "@/features/purchasing/domain/spreadsheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const actor = await authorizeAdminApi(request, true);
  if (!actor) return unauthorizedJson();
  if (!(await allowAdminRequest(actor, "admin_import", 30))) {
    return jsonNoStore(
      { ok: false, message: "عدد الملفات المرفوعة كبير. حاولي بعد قليل." },
      429,
    );
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_SPREADSHEET_BYTES + 64 * 1024) {
    return jsonNoStore({ ok: false, message: "حجم الملف أكبر من 5MB." }, 413);
  }

  try {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) {
      return jsonNoStore({ ok: false, message: "اختاري ملفاً أولاً." }, 400);
    }
    const upload = await extractionService.uploadSpreadsheet(actor, {
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
    });
    return jsonNoStore({ ok: true, ...upload });
  } catch (error) {
    return jsonNoStore({ ok: false, message: mapExtractionError(error) }, 400);
  }
}
