import { unauthorizedJson } from "@/features/admin/auth/admin-api-response";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { can } from "@/features/admin/domain/permissions";
import { socialService } from "@/features/social/application/social-instance";
import {
  SocialError,
  type CampaignExportFormat,
} from "@/features/social/application/social-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const formats: readonly CampaignExportFormat[] = [
  "square",
  "story",
  "carousel",
];

/**
 * One campaign file to download: the square or Story version, or one carousel slide. Drawn now
 * from today's catalog; nothing is stored or published.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await authorizeAdminApi(request);
  if (!actor || !can(actor, "social.view")) return unauthorizedJson();
  const { id } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") as CampaignExportFormat;
  const slide = Number(url.searchParams.get("slide") ?? 1);
  if (!formats.includes(format) || !Number.isInteger(slide) || slide < 1) {
    return Response.json({ ok: false }, { status: 400 });
  }
  let files: Buffer[];
  try {
    files = await socialService.campaignExport(actor, id, format);
  } catch (error) {
    if (error instanceof SocialError) {
      return Response.json(
        { ok: false, code: error.code },
        { status: error.code === "not_found" ? 404 : 409 },
      );
    }
    throw error;
  }
  const file = files[slide - 1];
  if (!file) return Response.json({ ok: false }, { status: 404 });
  const name = `maytha-${id.slice(0, 8)}-${format}${format === "carousel" ? `-${slide}` : ""}.jpg`;
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
