import { assistantConversations } from "@/features/admin/application/admin-services";
import { jsonNoStore } from "@/features/admin/auth/admin-api-response";
import { authorizeAssistant } from "@/features/assistant/application/assistant-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await authorizeAssistant(request, { mutation: false });
  if (access instanceof Response) return access;
  const conversationId = await assistantConversations.latest(access.actor);
  const messages = conversationId
    ? await assistantConversations.messages(access.actor, conversationId)
    : [];
  return jsonNoStore({ ok: true, conversationId, mode: access.mode, messages });
}

export async function DELETE(request: Request) {
  const access = await authorizeAssistant(request, { mutation: true });
  if (access instanceof Response) return access;
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("id");
  if (conversationId) {
    await assistantConversations.clear(access.actor, conversationId);
  }
  return jsonNoStore({ ok: true });
}
