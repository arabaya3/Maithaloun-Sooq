// Staged activation: while SHOP_ASSISTANT_ALLOWLIST lists numbers, the assistant answers only them
// (for example the owner's own test phone). Everyone else is left to the people answering in the
// WhatsApp Business app, which keeps working alongside the API (Coexistence).

const E164 = /^\+[1-9]\d{7,14}$/;

/** Parses "+9725..., +9705..." into valid E.164 numbers; null means no allowlist (everyone). */
export function parseAllowlist(value: string | undefined): Set<string> | null {
  if (!value?.trim()) return null;
  const numbers = value
    .split(",")
    .map((item) => item.replace(/[\s-]/g, ""))
    .filter((item) => E164.test(item));
  // A set but unparseable allowlist must not silently open the assistant to everyone.
  return new Set(numbers);
}

export function assistantAnswers(
  fromE164: string,
  allowlist: Set<string> | null,
): boolean {
  return allowlist === null || allowlist.has(fromE164);
}
