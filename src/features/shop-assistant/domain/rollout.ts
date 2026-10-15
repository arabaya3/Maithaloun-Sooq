// Who the live assistant may answer. It fails closed: with no valid configuration it answers
// nobody, and customers keep being answered by people in the WhatsApp Business app, which works
// alongside the API (Coexistence).
//
// - SHOP_ASSISTANT_ALLOWLIST: comma-separated E.164 numbers the assistant answers (e.g. the owner's
//   test phone during activation). Missing, blank or invalid entries add nobody.
// - SHOP_ASSISTANT_OPEN_TO_ALL=true: the separate, explicit switch for the full customer rollout.

const E164 = /^\+[1-9]\d{7,14}$/;

export interface AssistantAudience {
  openToAll: boolean;
  allowlist: ReadonlySet<string>;
}

export function assistantAudience(environment: {
  SHOP_ASSISTANT_ALLOWLIST?: string;
  SHOP_ASSISTANT_OPEN_TO_ALL?: string;
}): AssistantAudience {
  const allowlist = new Set(
    (environment.SHOP_ASSISTANT_ALLOWLIST ?? "")
      .split(",")
      .map((item) => item.replace(/[\s-]/g, ""))
      .filter((item) => E164.test(item)),
  );
  // Only the exact word "true" opens the assistant to everyone; anything else keeps it closed.
  return {
    openToAll: environment.SHOP_ASSISTANT_OPEN_TO_ALL?.trim() === "true",
    allowlist,
  };
}

export function assistantAnswers(
  fromE164: string,
  audience: AssistantAudience,
): boolean {
  return audience.openToAll || audience.allowlist.has(fromE164);
}
