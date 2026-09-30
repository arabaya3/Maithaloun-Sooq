import { extractionService } from "@/features/admin/application/admin-services";
import {
  jsonNoStore,
  unauthorizedJson,
} from "@/features/admin/auth/admin-api-response";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { mapExtractionError } from "@/features/inventory/application/inventory-action-errors";
import {
  MAX_INVOICE_IMAGE_BYTES,
  MAX_INVOICE_PAGES,
} from "@/features/purchasing/infrastructure/invoice-files";
import { getInvoiceExtractor } from "@/server/ai/invoice-extractor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const actor = await authorizeAdminApi(request, true);
  if (!actor) return unauthorizedJson();
  if (!(await allowAdminRequest(actor, "admin_invoice_ai", 30))) {
    return jsonNoStore(
      { ok: false, message: "عدد الفواتير المقروءة كبير. حاولي بعد قليل." },
      429,
    );
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_INVOICE_IMAGE_BYTES * MAX_INVOICE_PAGES) {
    return jsonNoStore({ ok: false, message: "حجم الملفات كبير جداً." }, 413);
  }

  try {
    const formData = await request.formData();
    const files = await Promise.all(
      formData
        .getAll("files")
        .filter((entry): entry is File => entry instanceof File)
        .map(async (file) => ({
          bytes: Buffer.from(await file.arrayBuffer()),
          name: file.name,
        })),
    );
    const job = await extractionService.createInvoiceJob(
      actor,
      { files, idempotencyKey: String(formData.get("idempotencyKey") ?? "") },
      getInvoiceExtractor(),
    );
    return jsonNoStore({ ok: true, jobId: job.jobId });
  } catch (error) {
    return jsonNoStore({ ok: false, message: mapExtractionError(error) }, 400);
  }
}
