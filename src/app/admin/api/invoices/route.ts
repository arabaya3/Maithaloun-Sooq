import { extractionService } from "@/features/admin/application/admin-services";
import {
  jsonNoStore,
  unauthorizedJson,
} from "@/features/admin/auth/admin-api-response";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { mapExtractionError } from "@/features/inventory/application/inventory-action-errors";
import { ExtractionError } from "@/features/purchasing/application/extraction-service";
import {
  MAX_INVOICE_UPLOAD_BYTES,
  UPLOAD_TOO_LARGE_MESSAGE,
} from "@/features/purchasing/domain/invoice-upload";
import { getInvoiceExtractor } from "@/server/ai/invoice-extractor";
import { errorCode, logEvent } from "@/server/log/ops-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BODY_LIMIT = MAX_INVOICE_UPLOAD_BYTES + 500_000;

function failureStatus(error: unknown): number {
  if (!(error instanceof ExtractionError)) return 500;
  if (error.code === "ai_failed") return 502;
  if (error.code === "ai_not_configured") return 503;
  if (error.code === "file_too_large") return 413;
  return 400;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const actor = await authorizeAdminApi(request, true);
  if (!actor) {
    logEvent("warn", "invoice_analysis.rejected", {
      requestId,
      reason: "unauthorized",
    });
    return unauthorizedJson();
  }
  if (!(await allowAdminRequest(actor, "admin_invoice_ai", 30))) {
    logEvent("warn", "invoice_analysis.rejected", {
      requestId,
      reason: "rate_limited",
    });
    return jsonNoStore(
      { ok: false, message: "عدد الفواتير المقروءة كبير. حاولي بعد قليل." },
      429,
    );
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > BODY_LIMIT) {
    logEvent("warn", "invoice_analysis.rejected", {
      requestId,
      reason: "body_too_large",
      declaredBytes: declared,
    });
    return jsonNoStore({ ok: false, message: UPLOAD_TOO_LARGE_MESSAGE }, 413);
  }

  let stage = "parse";
  try {
    const formData = await request.formData();
    const entries = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);
    const files = await Promise.all(
      entries.map(async (file) => ({
        bytes: Buffer.from(await file.arrayBuffer()),
        name: file.name,
      })),
    );
    // Sizes and declared types only: never names, bytes or extracted text.
    logEvent("info", "invoice_analysis.received", {
      requestId,
      pages: files.length,
      bytes: files.map((file) => file.bytes.byteLength),
      declaredTypes: entries.map((file) =>
        /^[a-z]+\/[a-z0-9.+-]+$/.test(file.type) ? file.type : "other",
      ),
    });
    stage = "analyse";
    const job = await extractionService.createInvoiceJob(
      actor,
      { files, idempotencyKey: String(formData.get("idempotencyKey") ?? "") },
      getInvoiceExtractor(),
    );
    logEvent("info", "invoice_analysis.completed", {
      requestId,
      jobId: job.jobId,
      durationMs: Date.now() - startedAt,
    });
    return jsonNoStore({ ok: true, jobId: job.jobId });
  } catch (error) {
    const status = failureStatus(error);
    logEvent(status >= 500 ? "error" : "warn", "invoice_analysis.failed", {
      requestId,
      stage,
      code: errorCode(error),
      detail: error instanceof ExtractionError ? (error.detail ?? null) : null,
      status,
      durationMs: Date.now() - startedAt,
    });
    return jsonNoStore(
      { ok: false, message: mapExtractionError(error), requestId },
      status,
    );
  }
}
