import { readFile } from "node:fs/promises";

import { getMediaRoot, resolvePublicMedia } from "@/server/storage/media-root";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public storefront media (product photos) stored on the server's disk. File names are random
// UUIDs and never rewritten, so they are cached for a year.
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const root = getMediaRoot();
  if (!root) return new Response(null, { status: 404 });
  const target = resolvePublicMedia(
    root,
    (await context.params).path.join("/"),
  );
  if (!target) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(target.file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": target.type,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
