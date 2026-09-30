import "server-only";

type LogValue = string | number | boolean | null | readonly (string | number)[];

const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;

// Reduces any thrown value to a short code, so messages and payloads never reach the log.
export function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_CODE.test(code)) return code;
    if (error instanceof Error) {
      if (SAFE_CODE.test(error.message)) return error.message;
      return SAFE_CODE.test(error.name) ? error.name : "Error";
    }
  }
  return "UNKNOWN";
}

// One JSON line per event. Callers pass counts, sizes, codes and ids only.
export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, LogValue> = {},
): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
