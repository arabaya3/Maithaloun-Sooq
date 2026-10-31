import { readFile } from "node:fs/promises";

import { unauthorizedJson } from "@/features/admin/auth/admin-api-response";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import { can } from "@/features/admin/domain/permissions";
import {
  mascotPoseIds,
  type MascotPose,
} from "@/features/social/domain/mascot";
import { mascotFile } from "@/features/social/infrastructure/render/campaign-templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One Meetho artwork file for the brand library, by its pose name only. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ pose: string }> },
) {
  const actor = await authorizeAdminApi(request);
  if (!actor || !can(actor, "social.view")) return unauthorizedJson();
  const { pose } = await params;
  if (!mascotPoseIds.includes(pose as MascotPose)) {
    return Response.json({ ok: false }, { status: 404 });
  }
  try {
    const bytes = await readFile(mascotFile(pose as MascotPose));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    // No artwork yet for this pose.
    return Response.json({ ok: false }, { status: 404 });
  }
}
