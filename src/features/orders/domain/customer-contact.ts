const CONTROL_OR_FORMAT_CHARS =
  /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/u;

export function normalizeContactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidCustomerFullName(value: string): boolean {
  if (CONTROL_OR_FORMAT_CHARS.test(value)) return false;
  if (!/^[\p{L}\p{M}\p{Nd} .'\u060C\u0640-]+$/u.test(value)) return false;
  if (!/\p{L}/u.test(value)) return false;
  return true;
}

export function isPlainDeliveryAddress(value: string): boolean {
  if (CONTROL_OR_FORMAT_CHARS.test(value)) return false;
  if (/[<>]/.test(value)) return false;
  return true;
}
