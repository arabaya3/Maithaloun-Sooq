import { extractionService } from "@/features/admin/application/admin-services";
import { unauthorizedJson } from "@/features/admin/auth/admin-api-response";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const actor = await authorizeAdminApi(request);
  if (!actor) return unauthorizedJson();
  try {
    const csv = await extractionService.errorRowsCsv(
      actor,
      (await context.params).jobId,
    );
    if (csv === null) return new Response(null, { status: 404 });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="import-errors.csv"',
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return unauthorizedJson();
    throw error;
  }
}
