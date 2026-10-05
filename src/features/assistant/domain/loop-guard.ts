interface StepLike {
  toolCalls: ReadonlyArray<{ toolName: string; input: unknown }>;
  toolResults: ReadonlyArray<{ output: unknown }>;
}

const callKey = (call: { toolName: string; input: unknown }) =>
  `${call.toolName}:${JSON.stringify(call.input ?? null)}`;

const failed = (output: unknown) => {
  const status = (output as { status?: unknown } | null)?.status;
  return status === "error" || status === "forbidden";
};

// Stops the agent when it repeats an identical tool call or when tools fail twice in a row.
export function shouldStopLoop(steps: readonly StepLike[]): boolean {
  const keys = steps.flatMap((step) => step.toolCalls.map(callKey));
  if (new Set(keys).size !== keys.length) return true;
  const recent = steps.slice(-2);
  return (
    recent.length === 2 &&
    recent.every(
      (step) =>
        step.toolResults.length > 0 &&
        step.toolResults.every((result) => failed(result.output)),
    )
  );
}

// The step that must answer in text: after a repeated or twice-failed call, or the last step allowed.
export function mustAnswerNow(
  steps: readonly StepLike[],
  stepNumber: number,
  maxSteps: number,
): boolean {
  return shouldStopLoop(steps) || stepNumber >= maxSteps - 1;
}
