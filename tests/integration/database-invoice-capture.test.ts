import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { ExtractionService } from "@/features/purchasing/application/extraction-service";
import { PurchaseService } from "@/features/purchasing/application/purchase-service";
import {
  documentUploads,
  extractionJobLines,
  extractionJobs,
  inventoryItems,
  productVariants,
  purchaseInvoices,
  stockMovements,
} from "@/server/db/schema";
import type { InvoiceExtractor } from "@/server/ai/invoice-extractor";
import type { PrivateDocumentStore } from "@/server/storage/private-documents";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { OPERATIONS_TABLES, createOperatorActor } from "./support";

const { db, client } = testDatabaseConnection;
const files = new Map<string, Buffer>();
const store: PrivateDocumentStore = {
  async put(objectPath, bytes) {
    files.set(objectPath, bytes);
    return { provider: "local", bucket: "memory", path: objectPath };
  },
  async read(location) {
    return files.get(location.path)!;
  },
  signedUrl: async () => null,
  remove: async (location) => {
    files.delete(location.path);
  },
};
const purchaseService = new PurchaseService(db);
const extractionService = new ExtractionService(
  db,
  purchaseService,
  () => store,
);

let operator: AdminActor;

const line = (description: string, confidence: number, quantity = "2") => ({
  description,
  barcode: null,
  sku: null,
  size: null,
  quantity,
  unit: null,
  unitPrice: "5.00",
  lineTotal: null,
  confidence,
});

function extractor(result: unknown): InvoiceExtractor {
  return { model: "test-model", extract: async () => result };
}

const invoice = (lines: unknown[]) => ({
  supplierName: "مورد التصوير",
  invoiceNumber: "AI-1",
  invoiceDate: "2026-09-20",
  currency: "₪",
  printedTotal: "20.00",
  discount: null,
  tax: null,
  paidAmount: null,
  paymentStatus: "paid",
  headerConfidence: 0.9,
  lines,
  warnings: [],
});

async function photo(): Promise<Buffer> {
  return sharp({
    create: { width: 60, height: 40, channels: 3, background: "#ffffff" },
  })
    .withExif({ IFD0: { Copyright: "private-location-data" } })
    .jpeg()
    .toBuffer();
}

async function capture(result: unknown) {
  return extractionService.createInvoiceJob(
    operator,
    {
      files: [{ bytes: await photo(), name: "IMG_0001.jpg" }],
      idempotencyKey: crypto.randomUUID(),
    },
    extractor(result),
  );
}

beforeAll(async () => {
  await resetTestDatabase();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
  files.clear();
});

describe("AI purchase-invoice capture", () => {
  it("stores a metadata-free original and a review job without touching stock", async () => {
    const { jobId } = await capture(
      invoice([
        line("سائل جلي Arar", 0.95),
        line("منظف عام Secrat", 0.9),
        line("صنف لا نعرفه أبداً", 0.9),
      ]),
    );

    const [document] = await db.select().from(documentUploads);
    expect(document).toMatchObject({
      kind: "invoice_image",
      mimeType: "image/jpeg",
    });
    const stored = [...files.values()][0]!;
    expect(stored.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(stored.includes("private-location-data")).toBe(false);

    const [job] = await db.select().from(extractionJobs);
    expect(job).toMatchObject({
      kind: "purchase_invoice_ai",
      status: "needs_review",
      aiModel: "test-model",
      extractionVersion: "invoice-v1",
    });
    expect(job?.promptVersion).toMatch(/^purchase-invoice-/);

    const view = await extractionService.getJob(operator, jobId);
    expect(view?.header).toMatchObject({
      supplierName: "مورد التصوير",
      reference: "AI-1",
      printedTotalAgorot: 2_000,
    });
    expect(view?.lines.map((item) => item.status)).toEqual([
      "matched",
      "suggested",
      "unmatched",
    ]);
    expect(view?.lines[1]?.variantId).toBeNull();
    expect(await db.select().from(stockMovements)).toHaveLength(0);
    expect(await db.select().from(purchaseInvoices)).toHaveLength(0);
  });

  it("does not auto-select a product the model could barely read", async () => {
    const { jobId } = await capture(invoice([line("سائل جلي Arar", 0.4)]));
    const view = await extractionService.getJob(operator, jobId);
    expect(view?.lines[0]).toMatchObject({
      status: "suggested",
      variantId: null,
      confidence: 40,
    });
    expect(view?.lines[0]?.candidates[0]?.variantId).toBe(
      "arar-dish-liquid--default",
    );
  });

  it("marks the job failed when the model output breaks the schema", async () => {
    await expect(
      capture({ ...invoice([line("سائل جلي Arar", 0.9)]), approved: true }),
    ).rejects.toMatchObject({ code: "ai_failed" });
    const [job] = await db.select().from(extractionJobs);
    expect(job).toMatchObject({
      status: "failed",
      errorCode: "AI_RESPONSE_INVALID",
    });
    expect(await db.select().from(extractionJobLines)).toHaveLength(0);
    // The original stays on record even though the reading failed.
    expect(await db.select().from(documentUploads)).toHaveLength(1);
  });

  it("rejects files that are not real images or PDFs", async () => {
    await expect(
      extractionService.createInvoiceJob(
        operator,
        {
          files: [
            { bytes: Buffer.from("<svg onload=alert(1)>"), name: "a.jpg" },
          ],
          idempotencyKey: crypto.randomUUID(),
        },
        extractor(invoice([])),
      ),
    ).rejects.toMatchObject({ code: "unsupported_file" });
    expect(await db.select().from(documentUploads)).toHaveLength(0);
  });

  it("posts the purchase only after the operator confirms the review", async () => {
    const { jobId } = await capture(invoice([line("سائل جلي Arar", 0.95)]));
    const view = (await extractionService.getJob(operator, jobId))!;
    const result = await extractionService.confirm(operator, jobId, {
      idempotencyKey: crypto.randomUUID(),
      supplierName: "مورد التصوير",
      reference: "AI-1",
      invoiceDate: "2026-09-20",
      source: "ai_capture",
      lines: [
        {
          variantId: view.lines[0]!.variantId!,
          unit: "piece",
          quantityMilli: 3_000,
          packQuantity: 1,
          unitCostAgorot: 500,
          lineDiscountAgorot: 0,
          sourceLineNo: 1,
        },
      ],
      discountAgorot: 0,
      taxAgorot: null,
      printedTotalAgorot: 2_000,
      paidAgorot: 1_500,
      acknowledgeDuplicate: false,
    });
    expect(result.totalAgorot).toBe(1_500);

    const [item] = await db
      .select({ onHandMilli: inventoryItems.onHandMilli })
      .from(inventoryItems)
      .innerJoin(
        productVariants,
        eq(productVariants.id, inventoryItems.variantId),
      )
      .where(eq(productVariants.domainId, "arar-dish-liquid--default"));
    expect(item?.onHandMilli).toBe(3_000);

    const [stored] = await db.select().from(purchaseInvoices);
    expect(stored).toMatchObject({
      source: "ai_capture",
      extractionJobId: jobId,
      printedTotalAgorot: 2_000,
    });
    const [storedLine] = await db.select().from(extractionJobLines);
    // The human correction of the extracted quantity is kept for audit.
    expect(storedLine?.corrections).toMatchObject({
      quantityMilli: { from: 2_000, to: 3_000 },
    });
  });
});
