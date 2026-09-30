// The hosting platform rejects request bodies above 4.5MB before the app runs, so uploads stay below it.
export const MAX_INVOICE_UPLOAD_BYTES = 4_000_000;
const FORM_OVERHEAD_BYTES = 40_000;

export const INVOICE_ENCODE_STEPS = [
  { maxEdge: 2_200, quality: 0.86 },
  { maxEdge: 1_800, quality: 0.8 },
  { maxEdge: 1_500, quality: 0.72 },
  { maxEdge: 1_200, quality: 0.62 },
] as const;

export function invoicePageBudget(pageCount: number): number {
  return Math.floor(
    (MAX_INVOICE_UPLOAD_BYTES - FORM_OVERHEAD_BYTES) / Math.max(pageCount, 1),
  );
}

export function fitsInvoiceUpload(sizes: readonly number[]): boolean {
  return (
    sizes.reduce((total, size) => total + size, 0) <=
    MAX_INVOICE_UPLOAD_BYTES - FORM_OVERHEAD_BYTES
  );
}

export const UPLOAD_TOO_LARGE_MESSAGE =
  "حجم الصور أكبر من المسموح (4MB للفاتورة كلها). احذفي صفحة أو صوّريها من جديد، والصور ما زالت هنا.";

export type UploadFailure =
  | { kind: "network"; online: boolean }
  | { kind: "timeout" }
  | { kind: "response"; status: number; body: string };

export interface UploadFailureView {
  message: string;
  // True when the server may have already started the job, so the retry must reuse the key.
  retrySameKey: boolean;
}

function serverMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message
      ? parsed.message
      : null;
  } catch {
    return null;
  }
}

export function describeUploadFailure(
  failure: UploadFailure,
): UploadFailureView {
  if (failure.kind === "timeout") {
    return {
      message:
        "استغرقت قراءة الفاتورة وقتاً أطول من المتوقع. الصور ما زالت هنا — أعيدي المحاولة.",
      retrySameKey: true,
    };
  }
  if (failure.kind === "network") {
    return {
      message: failure.online
        ? "تعذّر الوصول إلى الخادم. الصور ما زالت هنا — أعيدي المحاولة بعد قليل."
        : "لا يوجد اتصال بالإنترنت. الصور ما زالت هنا — أعيدي المحاولة عند عودة الاتصال.",
      retrySameKey: true,
    };
  }
  const { status, body } = failure;
  if (status === 413) {
    return { message: UPLOAD_TOO_LARGE_MESSAGE, retrySameKey: false };
  }
  const message = serverMessage(body);
  if (message) return { message, retrySameKey: status >= 500 };
  if (status === 401 || status === 403 || (status >= 200 && status < 400)) {
    return {
      message:
        "انتهت الجلسة. سجّلي الدخول من جديد في نافذة أخرى ثم أعيدي المحاولة؛ الصور ما زالت هنا.",
      retrySameKey: false,
    };
  }
  if (status === 429) {
    return {
      message: "عدد الفواتير المقروءة كبير. حاولي بعد قليل.",
      retrySameKey: false,
    };
  }
  if (status === 504 || status === 408) {
    return {
      message:
        "استغرقت قراءة الفاتورة وقتاً أطول من المتوقع. الصور ما زالت هنا — أعيدي المحاولة.",
      retrySameKey: true,
    };
  }
  return {
    message: `حدث خطأ في الخادم (${status}). الصور ما زالت هنا — أعيدي المحاولة أو أدخلي الفاتورة يدوياً.`,
    retrySameKey: true,
  };
}
