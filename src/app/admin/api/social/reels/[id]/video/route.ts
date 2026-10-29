import { unauthorizedJson } from "@/features/admin/auth/admin-api-response";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { can } from "@/features/admin/domain/permissions";
import { socialService } from "@/features/social/application/social-instance";
import { SocialError } from "@/features/social/application/social-service";
import { readStoredMedia } from "@/features/social/infrastructure/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A finished Reel as a file to save. Refused once a price or product it shows has changed, so an
 * outdated video is never handed out. A same-site attachment also downloads where a link to the
 * storage bucket would only open the video.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await authorizeAdminApi(request);
  if (!actor || !can(actor, "social.view")) return unauthorizedJson();
  const { id } = await params;
  let videoUrl: string;
  try {
    videoUrl = await socialService.reelVideo(actor, id);
  } catch (error) {
    if (error instanceof SocialError) {
      return Response.json(
        { ok: false, code: error.code },
        { status: error.code === "not_found" ? 404 : 409 },
      );
    }
    throw error;
  }
  const media = await readStoredMedia(videoUrl, process.env.SUPABASE_URL);
  if (!media) return Response.json({ ok: false }, { status: 404 });
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Content-Type": media.contentType,
      "Content-Disposition": `attachment; filename="maytha-reel-${id.slice(0, 8)}.mp4"`,
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
