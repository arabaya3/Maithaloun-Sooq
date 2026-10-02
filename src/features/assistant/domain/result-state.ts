export type MutationState =
  | "needs_clarification"
  | "ready_for_confirmation"
  | "confirmed_and_completed"
  | "confirmation_failed"
  | "cancelled"
  | "unsupported";

const UNSUPPORTED_CODES = new Set(["forbidden", "read_mode", "unsupported"]);

// The only states a prepare tool can report; completion is reported by the confirmation endpoint alone.
export function prepareState(output: {
  status: string;
  code?: string;
}): MutationState {
  if (output.status === "awaiting_confirmation")
    return "ready_for_confirmation";
  if (
    output.status === "rejected" &&
    UNSUPPORTED_CODES.has(output.code ?? "")
  ) {
    return "unsupported";
  }
  if (output.status === "forbidden") return "unsupported";
  if (output.status === "error") return "confirmation_failed";
  return "needs_clarification";
}

export type ChatFailureCode =
  "model_unavailable" | "rate_limited" | "timeout" | "unknown";

export const chatFailureMessages: Record<ChatFailureCode, string> = {
  model_unavailable:
    "المساعد غير متاح الآن. جربي بعد قليل أو استخدمي لوحة الإدارة.",
  rate_limited: "طلبات كثيرة خلال وقت قصير. انتظري قليلاً ثم حاولي.",
  timeout: "استغرق الرد وقتاً طويلاً فتوقف. رسالتك محفوظة، أعيدي المحاولة.",
  unknown: "تعذّر الرد الآن. رسالتك محفوظة، أعيدي المحاولة.",
};

export function classifyChatFailure(error: unknown): ChatFailureCode {
  const value = error as {
    name?: unknown;
    code?: unknown;
    statusCode?: unknown;
    message?: unknown;
  } | null;
  const name = typeof value?.name === "string" ? value.name : "";
  const code = typeof value?.code === "string" ? value.code : "";
  const status = typeof value?.statusCode === "number" ? value.statusCode : 0;
  if (status === 429) return "rate_limited";
  if (
    code === "AI_NOT_CONFIGURED" ||
    status === 401 ||
    status === 403 ||
    status >= 500
  ) {
    return "model_unavailable";
  }
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /timeout/i.test(String(value?.message ?? ""))
  ) {
    return "timeout";
  }
  return "unknown";
}
