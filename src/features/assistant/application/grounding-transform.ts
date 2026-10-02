import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai";

import {
  checkGrounding,
  GROUNDING_REPLIES,
  type GroundingViolation,
} from "../domain/grounding";

// Each text part is held until it ends, checked against this request's evidence, then released or replaced.
export function groundingTransform<TOOLS extends ToolSet>(
  userText: string,
  onBlocked: (violation: GroundingViolation) => void,
): StreamTextTransform<TOOLS> {
  return () => {
    const evidence: string[] = [userText];
    const buffers = new Map<string, string>();
    let preparedCard = false;
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type === "tool-result") {
          const output = chunk.output as { status?: unknown } | null;
          evidence.push(JSON.stringify(output ?? null));
          if (output?.status === "awaiting_confirmation") preparedCard = true;
          controller.enqueue(chunk);
          return;
        }
        if (chunk.type === "text-delta") {
          buffers.set(chunk.id, (buffers.get(chunk.id) ?? "") + chunk.text);
          return;
        }
        if (chunk.type === "text-end") {
          const text = buffers.get(chunk.id) ?? "";
          buffers.delete(chunk.id);
          const violation = checkGrounding({ text, evidence });
          if (violation) onBlocked(violation);
          const released = !violation
            ? text
            : violation === "premature_success" && preparedCard
              ? GROUNDING_REPLIES.premature_success_with_card
              : GROUNDING_REPLIES[violation];
          if (released) {
            controller.enqueue({
              type: "text-delta",
              id: chunk.id,
              text: released,
            } as TextStreamPart<TOOLS>);
          }
          controller.enqueue(chunk);
          return;
        }
        controller.enqueue(chunk);
      },
    });
  };
}
