import "server-only";

import {
  INVOICE_INSTRUCTIONS,
  invoiceJsonSchema,
} from "@/features/purchasing/domain/invoice-extraction";
import type { PreparedInvoiceFile } from "@/features/purchasing/infrastructure/invoice-files";

import { isFakeAiEnabled } from "./fake-mode";
import { requestStructuredJson, type AiContentPart } from "./openai-client";

export interface InvoiceExtractor {
  readonly model: string;
  extract(files: readonly PreparedInvoiceFile[]): Promise<unknown>;
}

function openAiExtractor(): InvoiceExtractor {
  const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";
  return {
    model,
    // Only the invoice pages are sent: no catalog, customers or history.
    extract(files) {
      const pages = files.map((file, index): AiContentPart => {
        const data = `data:${file.mimeType};base64,${file.bytes.toString("base64")}`;
        return file.kind === "invoice_pdf"
          ? {
              type: "input_file",
              filename: `invoice-${index + 1}.pdf`,
              file_data: data,
            }
          : { type: "input_image", image_url: data, detail: "high" };
      });
      return requestStructuredJson({
        model,
        schemaName: "purchase_invoice",
        schema: invoiceJsonSchema,
        instructions: INVOICE_INSTRUCTIONS,
        content: [
          {
            type: "input_text",
            text: "Extract this purchase invoice. The pages are in order.",
          },
          ...pages,
        ],
        timeoutMs: 50_000,
      });
    },
  };
}

// Deterministic stand-in for development and browser tests; never active in production.
const fakeExtractor: InvoiceExtractor = {
  model: "fake-invoice-model",
  async extract() {
    return {
      supplierName: "مورد النظافة",
      invoiceNumber: "F-2041",
      invoiceDate: "2026-09-28",
      currency: "₪",
      printedTotal: "170.00",
      discount: null,
      tax: null,
      paidAmount: null,
      paymentStatus: "unpaid",
      headerConfidence: 0.92,
      lines: [
        {
          description: "سائل جلي Arar",
          barcode: null,
          sku: null,
          size: null,
          quantity: "12",
          unit: "حبة",
          unitPrice: "8.50",
          lineTotal: "102.00",
          confidence: 0.96,
        },
        {
          description: "منظف ارضيات سمارت",
          barcode: null,
          sku: null,
          size: null,
          quantity: "6",
          unit: null,
          unitPrice: "7.00",
          lineTotal: "42.00",
          confidence: 0.81,
        },
        {
          description: "كلور ٤ لتر",
          barcode: null,
          sku: null,
          size: "4 لتر",
          quantity: "4",
          unit: null,
          unitPrice: "6.00",
          lineTotal: "24.00",
          confidence: 0.55,
        },
      ],
      warnings: [],
    };
  },
};

export function getInvoiceExtractor(): InvoiceExtractor {
  return isFakeAiEnabled() ? fakeExtractor : openAiExtractor();
}
