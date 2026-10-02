export type StoredMessageStatus = "completed" | "interrupted";

export const INTERRUPTED_TOOL_ERROR = "interrupted_before_result";
const MAX_STORED_TEXT = 8_000;

type Part = Record<string, unknown> & { type?: unknown; state?: unknown };

// A tool call without a result would break every later request, so it is closed as an explicit error.
export function settleMessageParts(parts: readonly unknown[]): {
  parts: unknown[];
  interrupted: boolean;
} {
  let interrupted = false;
  const settled = parts.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const part = raw as Part;
    const type = typeof part.type === "string" ? part.type : "";
    if (type === "text") {
      const text = typeof part.text === "string" ? part.text : "";
      if (part.state === "streaming") interrupted = true;
      return {
        ...part,
        text: text.slice(0, MAX_STORED_TEXT),
        state: "done",
      };
    }
    if (
      type.startsWith("tool-") &&
      part.state !== "output-available" &&
      part.state !== "output-error"
    ) {
      interrupted = true;
      return {
        type,
        toolCallId: part.toolCallId,
        state: "output-error",
        input: part.input ?? {},
        errorText: INTERRUPTED_TOOL_ERROR,
      };
    }
    return part;
  });
  return { parts: settled, interrupted };
}

export function messageStatus(metadata: unknown): StoredMessageStatus {
  return (metadata as { status?: unknown } | null)?.status === "interrupted"
    ? "interrupted"
    : "completed";
}
