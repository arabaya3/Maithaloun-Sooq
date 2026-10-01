import { randomUUID } from "node:crypto";

import {
  createAgentUIStreamResponse,
  safeValidateUIMessages,
  type StreamTextTransform,
  type ToolSet,
} from "ai";

import {
  assistantAttachments,
  assistantConversations,
} from "@/features/admin/application/admin-services";
import { jsonNoStore } from "@/features/admin/auth/admin-api-response";
import {
  assistantToolContext,
  authorizeAssistant,
} from "@/features/assistant/application/assistant-access";
import {
  assistantRequestSchema,
  toModelUserText,
} from "@/features/assistant/domain/user-message";
import {
  createAssistantAgent,
  type AssistantAgent,
  type AssistantUIMessage,
} from "@/server/ai/assistant-agent";
import { errorCode, logEvent } from "@/server/log/ops-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 32_000;

export async function POST(request: Request) {
  const started = Date.now();
  const access = await authorizeAssistant(request, {
    mutation: true,
    limit: "chat",
  });
  if (access instanceof Response) return access;
  const { actor, mode } = access;

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return jsonNoStore({ ok: false, message: "الرسالة طويلة جداً." }, 413);
  }
  let parsed;
  try {
    parsed = assistantRequestSchema.safeParse(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed?.success) {
    return jsonNoStore({ ok: false, message: "تعذّر قراءة الرسالة." }, 400);
  }
  const { message } = parsed.data;
  const attachmentIds = message.metadata?.attachmentIds ?? [];
  const attachments = [];
  for (const id of attachmentIds) {
    const row = await assistantAttachments.get(actor, id);
    if (!row) {
      return jsonNoStore(
        { ok: false, message: "أحد المرفقات لم يعد متاحاً. أرفقيه من جديد." },
        400,
      );
    }
    attachments.push({
      id: row.id,
      kind:
        row.mimeType === "application/pdf"
          ? ("pdf" as const)
          : ("image" as const),
    });
  }

  const conversationId = await assistantConversations.ensure(
    actor,
    parsed.data.conversationId ?? null,
  );
  const userMessage = {
    id: message.id,
    role: "user" as const,
    parts: [
      {
        type: "text" as const,
        text: toModelUserText(
          message.parts.map((part) => part.text).join("\n"),
          attachments,
        ),
      },
    ],
    metadata: { attachmentIds },
  };

  let agent;
  try {
    agent = createAssistantAgent(
      assistantToolContext(actor, conversationId, mode),
    );
  } catch (error) {
    logEvent("error", "assistant.chat.unavailable", { code: errorCode(error) });
    return jsonNoStore(
      { ok: false, message: "المساعد غير مهيأ على الخادم بعد." },
      503,
    );
  }

  const history = await assistantConversations.messages(actor, conversationId);
  const validated = await safeValidateUIMessages({
    messages: [...history, userMessage],
    tools: agent.tools as ToolSet,
  });
  const uiMessages = (
    validated.success ? validated.data : [userMessage]
  ) as AssistantUIMessage[];
  await assistantConversations.save(conversationId, [userMessage]);

  let firstTokenMs: number | null = null;
  const measureFirstToken: StreamTextTransform<AssistantAgent["tools"]> = () =>
    new TransformStream({
      transform(chunk, controller) {
        if (firstTokenMs === null && chunk.type === "text-delta") {
          firstTokenMs = Date.now() - started;
        }
        controller.enqueue(chunk);
      },
    });
  const known = new Set(uiMessages.map((item) => item.id));

  return createAgentUIStreamResponse({
    agent,
    uiMessages,
    abortSignal: request.signal,
    timeout: { totalMs: 55_000 },
    originalMessages: uiMessages,
    generateMessageId: () => `a-${randomUUID()}`,
    experimental_transform: measureFirstToken,
    messageMetadata: ({ part }) =>
      part.type === "start" ? { conversationId } : undefined,
    headers: { "Cache-Control": "no-store, max-age=0" },
    onError: (error) => {
      logEvent("error", "assistant.chat.failed", {
        code: errorCode(error),
        durationMs: Date.now() - started,
      });
      return "تعذّر الرد الآن. رسالتك محفوظة، أعيدي المحاولة.";
    },
    onEnd: async ({ messages, isAborted }) => {
      const fresh = messages.filter(
        (item) => !known.has(item.id) && item.role === "assistant",
      );
      await assistantConversations.save(
        conversationId,
        fresh.map((item) => ({
          id: item.id,
          role: "assistant" as const,
          parts: item.parts,
        })),
      );
      logEvent("info", "assistant.chat.completed", {
        durationMs: Date.now() - started,
        firstTokenMs,
        aborted: Boolean(isAborted),
        history: uiMessages.length,
      });
    },
  });
}
