import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import {
  ExtractionError,
  ExtractionService,
} from "@/features/purchasing/application/extraction-service";
import {
  PurchaseService,
  type PurchaseInput,
} from "@/features/purchasing/application/purchase-service";
import { draftFromExtraction } from "@/features/purchasing/domain/purchase-draft";
import {
  documentUploads,
  extractionJobLines,
  extractionJobs,
  inventoryItems,
  productVariants,
  purchaseInvoices,
  stockMovements,
  supplierProductAliases,
} from "@/server/db/schema";
import type {
  PrivateDocumentStore,
  StoredDocumentLocation,
} from "@/server/storage/private-documents";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import {
  OPERATIONS_TABLES,
  createOperatorActor,
  createOwnerActor,
} from "./support";

const { db, client } = testDatabaseConnection;

function memoryStore(): PrivateDocumentStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(objectPath, bytes): Promise<StoredDocumentLocation> {
      files.set(objectPath, bytes);
      return { provider: "local", bucket: "memory", path: objectPath };
    },
    async read(location) {
      const file = files.get(location.path);
      if (!file) throw new Error("missing");
      return file;
    },
    signedUrl: async () => null,
    remove: async (location) => {
      files.delete(location.path);
    },
  };
}

const store = memoryStore();
const purchaseService = new PurchaseService(db);
const extractionService = new ExtractionService(
  db,
  purchaseService,
  () => store,
);

let owner: AdminActor;
let operator: AdminActor;

async function workbook(rows: (string | number | object)[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("فاتورة");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

const HEADER = [
  "اسم المنتج",
  "الكمية",
  "سعر الوحدة",
  "الإجمالي",
  "المورد",
  "رقم الفاتورة",
  "تاريخ الفاتورة",
];

async function standardFile() {
  return workbook([
    HEADER,
    [
      "منظف عام Secret",
      10,
      4,
      { formula: "B2*C2", result: 40 },
      "مورد الخير",
      "X-77",
      "2026-09-02",
    ],
    ["مبيض Dolphn", 5, 6, 30, "مورد الخير", "X-77", "2026-09-02"],
    ["منتج غير معروف إطلاقاً", 1, 2, 2, "مورد الخير", "X-77", "2026-09-02"],
    ["فرشاة سجاد", "غلط", 3, "", "مورد الخير", "X-77", "2026-09-02"],
  ]);
}

async function createJob(bytes: Buffer) {
  const upload = await extractionService.uploadSpreadsheet(owner, {
    bytes,
    filename: "فاتورة أيلول.xlsx",
  });
  const sheet = upload.sheets[0]!;
  const { jobId } = await extractionService.createSpreadsheetJob(owner, {
    documentId: upload.documentId,
    sheetName: sheet.name,
    headerRow: sheet.headerRow,
    mapping: sheet.mapping,
    idempotencyKey: crypto.randomUUID(),
  });
  return { jobId, upload };
}

function toPurchaseInput(
  job: NonNullable<Awaited<ReturnType<ExtractionService["getJob"]>>>,
  choose: Record<number, string | null>,
): PurchaseInput {
  const draft = draftFromExtraction(job, "2026-09-30");
  return {
    idempotencyKey: crypto.randomUUID(),
    supplierName: draft.newSupplierName,
    reference: draft.reference,
    invoiceDate: draft.invoiceDate,
    source: "excel",
    lines: job.lines
      .filter((line) => line.status !== "error")
      .map((line) => ({
        lineNo: line.lineNo,
        variantId: line.lineNo in choose ? choose[line.lineNo] : line.variantId,
        values: line.values,
      }))
      .filter((line) => line.variantId)
      .map((line) => ({
        variantId: line.variantId!,
        unit: line.values.unit,
        quantityMilli: line.values.quantityMilli!,
        packQuantity: 1,
        unitCostAgorot: line.values.unitCostAgorot!,
        lineDiscountAgorot: 0,
        sourceLineNo: line.lineNo,
      })),
    discountAgorot: 0,
    taxAgorot: null,
    printedTotalAgorot: null,
    paidAgorot: 0,
    acknowledgeDuplicate: false,
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

beforeEach(async () => {
  await client.unsafe(`TRUNCATE TABLE ${OPERATIONS_TABLES.join(", ")} CASCADE`);
  store.files.clear();
});

describe("Excel import", () => {
  it("stores the original privately and proposes a mapping without touching stock", async () => {
    const upload = await extractionService.uploadSpreadsheet(owner, {
      bytes: await standardFile(),
      filename: "../فاتورة <أيلول>.xlsx",
    });
    expect(upload.sheets[0]).toMatchObject({
      headerRow: 0,
      mapping: { name: 0, quantity: 1, unitCost: 2, totalCost: 3 },
    });
    const [document] = await db.select().from(documentUploads);
    expect(document).toMatchObject({
      kind: "spreadsheet",
      originalName: "فاتورة أيلول.xlsx",
    });
    expect(document?.path).toMatch(/^spreadsheet\/\d{4}\/[0-9a-f-]+\.xlsx$/);
    expect(store.files.size).toBe(1);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it("classifies rows and reads cached formula results only", async () => {
    const { jobId } = await createJob(await standardFile());
    const job = await extractionService.getJob(owner, jobId);
    expect(job?.status).toBe("needs_review");
    expect(job?.header).toMatchObject({
      supplierName: "مورد الخير",
      reference: "X-77",
      invoiceDate: "2026-09-02",
    });
    expect(job?.lines.map((line) => line.status)).toEqual([
      "matched",
      "suggested",
      "unmatched",
      "error",
    ]);
    expect(job?.lines[0]).toMatchObject({
      matchMethod: "exact_name",
      variantId: "general-cleaner--default",
    });
    expect(job?.lines[0]?.values.totalAgorot).toBe(4_000);
    // The fuzzy candidate is only a suggestion; nothing is selected automatically.
    expect(job?.lines[1]?.variantId).toBeNull();
    expect(job?.lines[1]?.candidates[0]?.variantId).toBe(
      "dolphin-bleach--default",
    );
    expect(job?.lines[3]?.errors).toContain("الكمية غير صالحة.");
    expect(await db.select().from(stockMovements)).toHaveLength(0);

    const csv = await extractionService.errorRowsCsv(owner, jobId);
    expect(csv).toContain("الكمية غير صالحة.");
    expect(csv).toContain("فرشاة سجاد");
  });

  it("posts the reviewed rows once, records corrections and learns the alias", async () => {
    const { jobId } = await createJob(await standardFile());
    const job = (await extractionService.getJob(owner, jobId))!;
    const input = toPurchaseInput(job, {
      3: "dolphin-bleach--default",
      4: null,
    });

    const result = await extractionService.confirm(owner, jobId, input);
    expect(result.replayed).toBe(false);
    expect(result.totalAgorot).toBe(7_000);

    const replay = await extractionService.confirm(owner, jobId, input);
    expect(replay).toMatchObject({
      invoiceId: result.invoiceId,
      replayed: true,
    });

    const items = await db
      .select({
        domainId: productVariants.domainId,
        onHandMilli: inventoryItems.onHandMilli,
      })
      .from(inventoryItems)
      .innerJoin(
        productVariants,
        eq(productVariants.id, inventoryItems.variantId),
      );
    expect(items.sort((a, b) => a.domainId.localeCompare(b.domainId))).toEqual([
      { domainId: "dolphin-bleach--default", onHandMilli: 5_000 },
      { domainId: "general-cleaner--default", onHandMilli: 10_000 },
    ]);

    const [invoice] = await db.select().from(purchaseInvoices);
    expect(invoice).toMatchObject({ source: "excel", extractionJobId: jobId });
    expect(invoice?.documentId).not.toBeNull();

    const [stored] = await db.select().from(extractionJobs);
    expect(stored).toMatchObject({
      status: "confirmed",
      purchaseInvoiceId: result.invoiceId,
      confirmedBy: owner.id,
    });
    const lines = await db
      .select()
      .from(extractionJobLines)
      .orderBy(extractionJobLines.lineNo);
    expect(lines.map((line) => line.status)).toEqual([
      "matched",
      "matched",
      "ignored",
      "error",
    ]);
    expect(lines[1]).toMatchObject({ matchMethod: "manual" });
    expect(lines[1]?.corrections).toMatchObject({
      variantId: { from: null, to: "dolphin-bleach--default" },
    });

    const aliases = await db.select().from(supplierProductAliases);
    expect(aliases.map((alias) => alias.aliasText)).toEqual(["مبيض Dolphn"]);

    // The saved alias now matches the same wording automatically.
    const second = await createJob(
      await workbook([
        HEADER,
        ["مبيض Dolphn", 2, 6, 12, "مورد الخير", "X-78", "2026-09-03"],
      ]),
    );
    const next = await extractionService.getJob(owner, second.jobId);
    expect(next?.lines[0]).toMatchObject({
      status: "matched",
      matchMethod: "supplier_alias",
      variantId: "dolphin-bleach--default",
    });
  });

  it("rejects files that mix invoices or exceed limits", async () => {
    const mixed = await workbook([
      HEADER,
      ["منظف عام Secret", 1, 4, 4, "مورد أ", "1", "2026-09-02"],
      ["منظف عام Secret", 1, 4, 4, "مورد ب", "2", "2026-09-02"],
    ]);
    await expect(createJob(mixed)).rejects.toMatchObject({
      code: "multiple_invoices",
    });

    const large = await workbook([
      HEADER,
      ...Array.from({ length: 1_060 }, () => ["منظف عام Secret", 1, 4, 4]),
    ]);
    await expect(
      extractionService.uploadSpreadsheet(owner, {
        bytes: large,
        filename: "big.xlsx",
      }),
    ).rejects.toMatchObject({ code: "too_many_rows" });

    await expect(
      extractionService.uploadSpreadsheet(owner, {
        bytes: Buffer.from("<html><body>=cmd</body></html>"),
        filename: "fake.xlsx",
      }),
    ).rejects.toBeInstanceOf(ExtractionError);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it("keeps imports owner-only and closed jobs closed", async () => {
    await expect(
      extractionService.uploadSpreadsheet(operator, {
        bytes: await standardFile(),
        filename: "a.xlsx",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const { jobId } = await createJob(await standardFile());
    await expect(
      extractionService.getJob(operator, jobId),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await extractionService.discard(owner, jobId);
    const job = (await extractionService.getJob(owner, jobId))!;
    await expect(
      extractionService.confirm(owner, jobId, toPurchaseInput(job, {})),
    ).rejects.toMatchObject({ code: "not_reviewable" });
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });
});
