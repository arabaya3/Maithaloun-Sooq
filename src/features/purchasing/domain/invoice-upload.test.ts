import { describe, expect, it } from "vitest";

import {
  MAX_INVOICE_UPLOAD_BYTES,
  UPLOAD_TOO_LARGE_MESSAGE,
  describeUploadFailure,
  fitsInvoiceUpload,
  invoicePageBudget,
} from "./invoice-upload";

describe("invoice upload budget", () => {
  it("keeps any page count under the platform body limit", () => {
    for (const count of [1, 2, 6]) {
      expect(invoicePageBudget(count) * count).toBeLessThan(
        MAX_INVOICE_UPLOAD_BYTES,
      );
    }
    expect(MAX_INVOICE_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("flags two ordinary PNG pages that together exceed the limit", () => {
    expect(fitsInvoiceUpload([2_600_000, 2_400_000])).toBe(false);
    expect(fitsInvoiceUpload([1_200_000, 900_000])).toBe(true);
  });
});

describe("describeUploadFailure", () => {
  it("only blames the connection when the device is offline", () => {
    expect(
      describeUploadFailure({ kind: "network", online: false }).message,
    ).toContain("لا يوجد اتصال");
    const reachable = describeUploadFailure({ kind: "network", online: true });
    expect(reachable.message).toContain("تعذّر الوصول إلى الخادم");
    expect(reachable.retrySameKey).toBe(true);
  });

  it("explains a rejected oversized body", () => {
    expect(
      describeUploadFailure({
        kind: "response",
        status: 413,
        body: "Request Entity Too Large",
      }),
    ).toEqual({ message: UPLOAD_TOO_LARGE_MESSAGE, retrySameKey: false });
  });

  it("shows the server's own message when there is one", () => {
    expect(
      describeUploadFailure({
        kind: "response",
        status: 400,
        body: JSON.stringify({ ok: false, message: "نوع الملف غير مدعوم." }),
      }),
    ).toEqual({ message: "نوع الملف غير مدعوم.", retrySameKey: false });
  });

  it("treats a login page or 401 as an expired session", () => {
    for (const failure of [
      { kind: "response", status: 200, body: "<!doctype html>" },
      { kind: "response", status: 401, body: "" },
    ] as const) {
      expect(describeUploadFailure(failure).message).toContain("انتهت الجلسة");
    }
  });

  it("distinguishes timeouts and unknown server errors", () => {
    expect(describeUploadFailure({ kind: "timeout" }).message).toContain(
      "وقتاً أطول",
    );
    expect(
      describeUploadFailure({ kind: "response", status: 504, body: "" })
        .message,
    ).toContain("وقتاً أطول");
    const unknown = describeUploadFailure({
      kind: "response",
      status: 500,
      body: "Internal Server Error",
    });
    expect(unknown.message).toContain("(500)");
    expect(unknown.retrySameKey).toBe(true);
  });
});
