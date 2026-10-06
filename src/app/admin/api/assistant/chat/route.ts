import { randomUUID } from "node:crypto";

import {
  createAgentUIStreamResponse,
  createUIMessageStream,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type StreamTextTransform,
  type ToolSet,
} from "ai";

import {
  assistantAttachments,
  assistantConfirmations,
  assistantConversations,
} from "@/features/admin/application/admin-services";
import { jsonNoStore } from "@/features/admin/auth/admin-api-response";
import {
  assistantToolContext,
  authorizeAssistant,
} from "@/features/assistant/application/assistant-access";
import {
  confirmationButtonHint,
  isBareAffirmation,
} from "@/features/assistant/domain/affirmation";
import {
  assistantRequestSchema,
  toModelUserText,
} from "@/features/assistant/domain/user-message";
import {
  assistantModelId,
  createAssistantAgent,
  type AssistantAgent,
  type AssistantUIMessage,
} from "@/server/ai/assistant-agent";
import { groundingTransform } from "@/features/assistant/application/grounding-transform";
import { conflictingAmountQuestion } from "@/features/assistant/domain/amount-guard";
import {
  chatFailureMessages,
  classifyChatFailure,
} from "@/features/assistant/domain/result-state";
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

  // A fixed server reply that never reaches the model.
  const fixedReply = async (
    text: string,
    event: string,
    clarification?: { code: string; values: string[] },
  ) => {
    const replyId = `a-${randomUUID()}`;
    await assistantConversations.save(conversationId, [
      userMessage,
      {
        id: replyId,
        role: "assistant" as const,
        parts: [{ type: "text" as const, text }],
        metadata: {
          status: "completed",
          conversationId,
          ...(clarification ? { clarification } : {}),
        },
      },
    ]);
    logEvent("info", event, { durationMs: Date.now() - started });
    return createUIMessageStreamResponse({
      headers: { "Cache-Control": "no-store, max-age=0" },
      stream: createUIMessageStream({
        execute({ writer }) {
          writer.write({
            type: "start",
            messageId: replyId,
            messageMetadata: { conversationId },
          });
          writer.write({ type: "text-start", id: "hint" });
          writer.write({ type: "text-delta", id: "hint", delta: text });
          writer.write({ type: "text-end", id: "hint" });
          writer.write({ type: "finish" });
        },
      }),
    });
  };

  // "نعم" while a card is open: point at the button instead of letting the model improvise.
  const typed = message.parts.map((part) => part.text).join("\n");
  if (!attachments.length && isBareAffirmation(typed)) {
    const pending = await assistantConfirmations.pendingInConversation(
      actor,
      conversationId,
    );
    if (pending) {
      return fixedReply(
        confirmationButtonHint(pending.confirmLabel),
        "assistant.chat.affirmation_redirected",
      );
    }
  }

  // Alternative amounts or a negative or zero price: ask, whatever the model would have done.
  const conflict = conflictingAmountQuestion(typed);
  if (conflict) {
    return fixedReply(conflict.question, `assistant.chat.${conflict.code}`, {
      code: conflict.code,
      values: conflict.values,
    });
  }

  let agent;
  try {
    agent = createAssistantAgent(
      assistantToolContext(actor, conversationId, mode, typed),
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

  const requestId = randomUUID();
  const usage = { steps: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
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
    experimental_transform: [
      groundingTransform<AssistantAgent["tools"]>(
        message.parts.map((part) => part.text).join("\n"),
        (violation) =>
          logEvent("warn", "assistant.grounding.blocked", {
            requestId,
            violation,
          }),
      ),
      measureFirstToken,
    ],
    onStepEnd: ({ usage: step }) => {
      usage.steps += 1;
      usage.inputTokens += step.inputTokens ?? 0;
      usage.outputTokens += step.outputTokens ?? 0;
      usage.cachedTokens += step.inputTokenDetails?.cacheReadTokens ?? 0;
    },
    messageMetadata: ({ part }) =>
      part.type === "start" ? { conversationId } : undefined,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Request-Id": requestId,
    },
    onError: (error) => {
      const failure = classifyChatFailure(error);
      logEvent("error", "assistant.chat.failed", {
        requestId,
        code: errorCode(error),
        failure,
        durationMs: Date.now() - started,
      });
      return `${chatFailureMessages[failure]} (المرجع ${requestId.slice(0, 8)})`;
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
          metadata: {
            ...((item.metadata as Record<string, unknown> | undefined) ?? {}),
            status: isAborted ? "interrupted" : "completed",
          },
        })),
      );
      logEvent("info", "assistant.chat.completed", {
        requestId,
        model: assistantModelId(),
        durationMs: Date.now() - started,
        steps: usage.steps,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        firstTokenMs,
        aborted: Boolean(isAborted),
        history: uiMessages.length,
      });
    },
  });
}
