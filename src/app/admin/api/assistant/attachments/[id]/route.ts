import { assistantAttachments } from "@/features/admin/application/admin-services";
import { authorizeAssistant } from "@/features/assistant/application/assistant-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await authorizeAssistant(request, { mutation: false });
  if (access instanceof Response) return access;
  const { id } = await context.params;
  const file = await assistantAttachments.read(access.actor, id);
  if (!file || file.mimeType !== "image/jpeg") {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
