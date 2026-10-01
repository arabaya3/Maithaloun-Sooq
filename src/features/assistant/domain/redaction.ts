const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const SENSITIVE_KEY =
  /phone|address|note|password|token|secret|email|landmark|transcript|text|description|reason/i;
const ID_LIKE = /^[a-z0-9-]{1,100}$/;

// Keeps identifiers, numbers and flags for the audit trail; free text is reduced to its length.
export function summarizeToolInput(
  input: unknown,
  depth = 0,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || depth > 2) return {};
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!SAFE_KEY.test(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      summary[key] = value;
    } else if (typeof value === "string") {
      summary[key] =
        !SENSITIVE_KEY.test(key) && ID_LIKE.test(value)
          ? value
          : { chars: value.length };
    } else if (Array.isArray(value)) {
      summary[key] = { items: value.length };
    } else if (value && typeof value === "object") {
      summary[key] = summarizeToolInput(value, depth + 1);
    }
  }
  return summary;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••${digits.slice(-3)}`;
}
