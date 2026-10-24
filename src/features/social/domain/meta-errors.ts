/**
 * Graph API failures reduced to what the publisher must do next. Codes from Meta's
 * "Handling Errors" reference: 190 token, 10/200–299 permissions, 4/17/32/613 and 80001–80014 throttling.
 */
export type MetaFailureKind =
  | "auth"
  | "permission"
  | "rate_limit"
  | "transient"
  | "invalid_request"
  | "unknown"
  // A publish request whose answer was lost: Meta may or may not have published it.
  | "unknown_outcome";

export interface MetaFailure {
  kind: MetaFailureKind;
  code: number | null;
  subcode: number | null;
  /** Wait at least this long before calling again, when Meta told us. */
  retryAfterMs?: number;
}

export class MetaApiError extends Error {
  constructor(readonly failure: MetaFailure) {
    super(`META_${failure.kind.toUpperCase()}`);
    this.name = "MetaApiError";
  }
}

const rateLimitCodes = new Set([4, 17, 32, 613]);

export function classifyMetaError(input: {
  httpStatus: number;
  code?: number | null;
  subcode?: number | null;
  isTransient?: boolean;
  retryAfterSeconds?: number | null;
}): MetaFailure {
  const code = input.code ?? null;
  const subcode = input.subcode ?? null;
  const base = { code, subcode };
  if (code === 190 || code === 102 || input.httpStatus === 401) {
    return { kind: "auth", ...base };
  }
  if (
    (code !== null && rateLimitCodes.has(code)) ||
    (code !== null && code >= 80_001 && code <= 80_014) ||
    input.httpStatus === 429
  ) {
    return {
      kind: "rate_limit",
      ...base,
      retryAfterMs: input.retryAfterSeconds
        ? input.retryAfterSeconds * 1_000
        : 60 * 60_000,
    };
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) {
    return { kind: "permission", ...base };
  }
  if (
    input.isTransient ||
    code === 1 ||
    code === 2 ||
    input.httpStatus >= 500
  ) {
    return { kind: "transient", ...base };
  }
  if (code === 100 || input.httpStatus === 400) {
    return { kind: "invalid_request", ...base };
  }
  return { kind: "unknown", ...base };
}

/** Only throttling and Meta-side outages are worth an automatic retry. */
export function isRetryable(failure: MetaFailure): boolean {
  return failure.kind === "rate_limit" || failure.kind === "transient";
}

export const metaFailureLabels: Record<MetaFailureKind, string> = {
  auth: "انتهت صلاحية ربط فيسبوك أو أُلغيت. أعيدي الربط من الإعدادات.",
  permission: "صلاحيات تطبيق فيسبوك لا تكفي لهذه العملية.",
  rate_limit: "فيسبوك طلب التمهّل. ستُعاد المحاولة تلقائياً.",
  transient: "خلل مؤقت عند فيسبوك. ستُعاد المحاولة تلقائياً.",
  invalid_request: "رفض فيسبوك الطلب. راجعي النص والوسائط.",
  unknown: "خطأ غير معروف من فيسبوك.",
  unknown_outcome:
    "لم يصل رد فيسبوك؛ نتحقق من الصفحة قبل أي محاولة جديدة حتى لا يتكرر النشر.",
};
