import { unauthorizedJson } from "@/features/admin/auth/admin-api-response";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { can } from "@/features/admin/domain/permissions";
import { buildImportTemplate } from "@/features/purchasing/infrastructure/workbook-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ARABIC_FILENAME = encodeURIComponent("قالب-فاتورة-شراء.xlsx");

export async function GET(request: Request) {
  const actor = await authorizeAdminApi(request);
  if (!actor || !can(actor, "purchase.import")) return unauthorizedJson();
  const template = await buildImportTemplate();
  return new Response(new Uint8Array(template), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="purchase-template.xlsx"; filename*=UTF-8''${ARABIC_FILENAME}`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
