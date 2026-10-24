import { unauthorizedJson } from "@/features/admin/auth/admin-api-response";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { can } from "@/features/admin/domain/permissions";
import { socialEnabled } from "@/features/social/application/social-instance";
import { readLocalMedia } from "@/features/social/infrastructure/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Local development previews of rendered posts; production media is served by Supabase Storage. */
export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
) {
  if (!socialEnabled()) return new Response(null, { status: 404 });
  const actor = await authorizeAdminApi(request);
  if (!actor || !can(actor, "social.view")) return unauthorizedJson();
  const media = await readLocalMedia((await context.params).file);
  if (!media) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Content-Type": media.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
