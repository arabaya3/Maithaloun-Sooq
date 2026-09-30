import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission, can } from "@/features/admin/domain/permissions";
import type { Database } from "@/features/inventory/application/stock-ledger";
import type { StockUnit } from "@/features/inventory/domain/stock-constants";
import {
  PurchaseError,
  purchaseInputSchema,
  type PurchaseInput,
  type PurchasePostResult,
  type PurchaseService,
} from "@/features/purchasing/application/purchase-service";
import {
  INVOICE_EXTRACTION_VERSION,
  INVOICE_PROMPT_VERSION,
  MIN_AUTO_MATCH_CONFIDENCE,
  invoiceExtractionSchema,
  normalizeInvoiceExtraction,
} from "@/features/purchasing/domain/invoice-extraction";
import {
  matchLine,
  type CatalogVariant,
  type MatchCandidate,
} from "@/features/purchasing/domain/line-matching";
import type {
  DocumentKind,
  ExtractionJobKind,
  ExtractionJobStatus,
  ExtractionLineStatus,
  ExtractionMatchMethod,
  PurchasePaymentStatus,
} from "@/features/purchasing/domain/purchase-constants";
import {
  SpreadsheetError,
  detectHeaderRow,
  importFields,
  normalizeRows,
  sanitizeFilename,
  suggestMapping,
  toCsv,
  type ColumnMapping,
} from "@/features/purchasing/domain/spreadsheet";
import {
  InvoiceFileError,
  prepareInvoiceFiles,
  type InvoiceFileErrorCode,
} from "@/features/purchasing/infrastructure/invoice-files";
import { readSpreadsheet } from "@/features/purchasing/infrastructure/workbook-reader";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import * as schema from "@/server/db/schema";
import { AiError } from "@/server/ai/openai-client";
import type { InvoiceExtractor } from "@/server/ai/invoice-extractor";
import type { PrivateDocumentStore } from "@/server/storage/private-documents";

export const SPREADSHEET_EXTRACTION_VERSION = "spreadsheet-v1";

export type ExtractionErrorCode =
  | "invalid_input"
  | "not_found"
  | "not_reviewable"
  | "multiple_invoices"
  | "no_valid_rows"
  | "ai_failed"
  | "ai_not_configured"
  | InvoiceFileErrorCode
  | SpreadsheetError["code"];

export class ExtractionError extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "ExtractionError";
  }
}

export interface ExtractionHeader {
  supplierName: string | null;
  supplierId: string | null;
  reference: string | null;
  invoiceDate: string | null;
  paymentStatus: PurchasePaymentStatus | null;
  paidAgorot: number | null;
  discountAgorot: number | null;
  taxAgorot: number | null;
  printedTotalAgorot: number | null;
  currency: string | null;
  confidence: number | null;
  warnings: string[];
}

export interface ExtractionLineValues {
  name: string;
  barcode: string;
  sku: string;
  size: string;
  unit: StockUnit;
  quantityMilli: number | null;
  unitCostAgorot: number | null;
  totalAgorot: number | null;
  extractionConfidence?: number;
}

export interface ExtractionLineView {
  id: string;
  lineNo: number;
  status: ExtractionLineStatus;
  matchMethod: ExtractionMatchMethod | null;
  variantId: string | null;
  confidence: number | null;
  candidates: MatchCandidate[];
  errors: string[];
  values: ExtractionLineValues;
}

export interface ExtractionJobView {
  id: string;
  kind: ExtractionJobKind;
  status: ExtractionJobStatus;
  idempotencyKey: string;
  createdAt: string;
  header: ExtractionHeader;
  documents: Array<{ id: string; kind: DocumentKind; pageNo: number }>;
  lines: ExtractionLineView[];
  purchaseInvoiceId: string | null;
}

export interface SpreadsheetSheetSummary {
  name: string;
  rowCount: number;
  headerRow: number;
  mapping: ColumnMapping;
  preview: string[][];
}

const mappingSchema = z
  .object(
    Object.fromEntries(
      importFields.map((field) => [
        field,
        z.number().int().min(0).max(39).optional(),
      ]),
    ),
  )
  .strict();

const spreadsheetJobSchema = z
  .object({
    documentId: z.uuid(),
    sheetName: z.string().min(1).max(300),
    headerRow: z.number().int().min(0).max(200),
    mapping: mappingSchema,
    idempotencyKey: z.uuid(),
  })
  .strict();

const emptyHeader: ExtractionHeader = {
  supplierName: null,
  supplierId: null,
  reference: null,
  invoiceDate: null,
  paymentStatus: null,
  paidAgorot: null,
  discountAgorot: null,
  taxAgorot: null,
  printedTotalAgorot: null,
  currency: null,
  confidence: null,
  warnings: [],
};

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export class ExtractionService {
  constructor(
    private readonly database: Database,
    private readonly purchases: PurchaseService,
    private readonly store: () => PrivateDocumentStore,
  ) {}

  async uploadSpreadsheet(
    actor: AdminActor,
    input: { bytes: Buffer; filename: string },
  ): Promise<{ documentId: string; sheets: SpreadsheetSheetSummary[] }> {
    assertPermission(actor, "purchase.import");
    const { kind, sheets } = await this.parse(input.bytes);
    const document = await this.saveDocument(actor, {
      kind: "spreadsheet",
      bytes: input.bytes,
      extension: kind,
      mimeType:
        kind === "csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      originalName: input.filename,
    });
    return {
      documentId: document.id,
      sheets: sheets.map((sheet) => {
        const headerRow = detectHeaderRow(sheet.rows);
        return {
          name: sheet.name,
          rowCount: sheet.rows.length,
          headerRow,
          mapping: suggestMapping(sheet.rows[headerRow] ?? []),
          preview: sheet.rows.slice(0, 12).map((row) => row.slice(0, 20)),
        };
      }),
    };
  }

  async createSpreadsheetJob(
    actor: AdminActor,
    input: z.input<typeof spreadsheetJobSchema>,
  ): Promise<{ jobId: string }> {
    assertPermission(actor, "purchase.import");
    const parsed = spreadsheetJobSchema.safeParse(input);
    if (!parsed.success) throw new ExtractionError("invalid_input");
    const data = parsed.data;
    const mapping = data.mapping as ColumnMapping;
    if (mapping.quantity === undefined)
      throw new ExtractionError("invalid_input");

    const [existing] = await this.database
      .select({ id: schema.extractionJobs.id })
      .from(schema.extractionJobs)
      .where(eq(schema.extractionJobs.idempotencyKey, data.idempotencyKey))
      .limit(1);
    if (existing) return { jobId: existing.id };

    const [document] = await this.database
      .select()
      .from(schema.documentUploads)
      .where(
        and(
          eq(schema.documentUploads.id, data.documentId),
          eq(schema.documentUploads.kind, "spreadsheet"),
        ),
      )
      .limit(1);
    if (!document) throw new ExtractionError("not_found");

    const bytes = await this.store().read({
      provider: document.storageProvider as "supabase" | "local",
      bucket: document.bucket,
      path: document.path,
    });
    const { sheets } = await this.parse(bytes);
    const sheet = sheets.find((item) => item.name === data.sheetName);
    if (!sheet) throw new ExtractionError("not_found");

    let rows;
    try {
      rows = normalizeRows(sheet.rows, data.headerRow, mapping);
    } catch (error) {
      if (error instanceof SpreadsheetError) {
        throw new ExtractionError(error.code);
      }
      throw error;
    }
    if (!rows.length) throw new ExtractionError("no_valid_rows");

    const suppliers = distinct(
      rows.map((row) => normalizeArabicText(row.supplier)),
    );
    const references = distinct(rows.map((row) => row.invoiceNumber));
    if (suppliers.length > 1 || references.length > 1) {
      throw new ExtractionError("multiple_invoices");
    }

    const supplierName = rows.find((row) => row.supplier)?.supplier ?? null;
    const supplierId = supplierName
      ? await this.findSupplierId(supplierName)
      : null;
    const header: ExtractionHeader = {
      ...emptyHeader,
      supplierName,
      supplierId,
      reference: references[0] ?? null,
      invoiceDate: rows.find((row) => row.invoiceDate)?.invoiceDate ?? null,
      paymentStatus:
        rows.find((row) => row.paymentStatus)?.paymentStatus ?? null,
    };

    const catalog = await this.loadCatalog();
    const aliases = await this.loadAliases(supplierId);
    const variantUuid = new Map(
      catalog.map((item) => [item.variantId, item.id]),
    );

    return this.database.transaction(async (transaction) => {
      const [job] = await transaction
        .insert(schema.extractionJobs)
        .values({
          kind: "purchase_excel",
          status: "needs_review",
          idempotencyKey: data.idempotencyKey,
          extractionVersion: SPREADSHEET_EXTRACTION_VERSION,
          header: { ...header },
          mapping: {
            sheetName: data.sheetName,
            headerRow: data.headerRow,
            columns: mapping,
          },
          createdBy: actor.id,
        })
        .returning({ id: schema.extractionJobs.id });
      if (!job) throw new ExtractionError("invalid_input");

      await transaction.insert(schema.extractionJobDocuments).values({
        jobId: job.id,
        documentId: document.id,
        pageNo: 1,
      });
      await transaction.insert(schema.extractionJobLines).values(
        rows.map((row) => {
          const values: ExtractionLineValues = {
            name: row.name,
            barcode: row.barcode,
            sku: row.sku,
            size: row.size,
            unit: row.unit,
            quantityMilli: row.quantityMilli,
            unitCostAgorot: row.unitCostAgorot,
            totalAgorot: row.totalAgorot,
          };
          if (row.errors.length) {
            return {
              jobId: job.id,
              lineNo: row.rowNumber,
              raw: { cells: sheet.rows[row.rowNumber - 1] ?? [] },
              normalized: { ...values },
              status: "error" as const,
              errors: row.errors,
            };
          }
          const match = matchLine(row, catalog, aliases);
          return {
            jobId: job.id,
            lineNo: row.rowNumber,
            raw: { cells: sheet.rows[row.rowNumber - 1] ?? [] },
            normalized: { ...values },
            status: match.status,
            matchMethod: match.method,
            matchedVariantId: match.variantId
              ? (variantUuid.get(match.variantId) ?? null)
              : null,
            confidence: match.confidence,
            candidates: match.candidates,
            errors: [],
          };
        }),
      );
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "extraction_create",
        entityType: "extraction_job",
        entityId: job.id,
        beforeState: null,
        afterState: { kind: "purchase_excel", rowCount: rows.length },
      });
      return { jobId: job.id };
    });
  }

  async createInvoiceJob(
    actor: AdminActor,
    input: {
      files: ReadonlyArray<{ bytes: Buffer; name: string }>;
      idempotencyKey: string;
    },
    extractor: InvoiceExtractor,
  ): Promise<{ jobId: string }> {
    assertPermission(actor, "purchase.record");
    if (!z.uuid().safeParse(input.idempotencyKey).success) {
      throw new ExtractionError("invalid_input");
    }
    const [existing] = await this.database
      .select({
        id: schema.extractionJobs.id,
        status: schema.extractionJobs.status,
      })
      .from(schema.extractionJobs)
      .where(eq(schema.extractionJobs.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing && existing.status !== "failed") return { jobId: existing.id };
    if (existing) throw new ExtractionError("ai_failed");

    let prepared;
    try {
      prepared = await prepareInvoiceFiles(input.files);
    } catch (error) {
      if (error instanceof InvoiceFileError) {
        throw new ExtractionError(error.code);
      }
      throw error;
    }

    // Originals are stored first, so a failed reading still leaves the invoice on record.
    const documents = [];
    for (const file of prepared) {
      documents.push(
        await this.saveDocument(actor, {
          kind: file.kind,
          bytes: file.bytes,
          extension: file.extension,
          mimeType: file.mimeType,
          originalName: file.originalName,
        }),
      );
    }
    const [job] = await this.database
      .insert(schema.extractionJobs)
      .values({
        kind: "purchase_invoice_ai",
        status: "processing",
        idempotencyKey: input.idempotencyKey,
        aiModel: extractor.model,
        promptVersion: INVOICE_PROMPT_VERSION,
        extractionVersion: INVOICE_EXTRACTION_VERSION,
        createdBy: actor.id,
      })
      .returning({ id: schema.extractionJobs.id });
    if (!job) throw new ExtractionError("invalid_input");
    await this.database.insert(schema.extractionJobDocuments).values(
      documents.map((document, index) => ({
        jobId: job.id,
        documentId: document.id,
        pageNo: index + 1,
      })),
    );

    const fail = async (
      errorCode: string,
      code: ExtractionErrorCode,
    ): Promise<never> => {
      await this.database
        .update(schema.extractionJobs)
        .set({ status: "failed", errorCode, updatedAt: new Date() })
        .where(eq(schema.extractionJobs.id, job.id));
      throw new ExtractionError(code, errorCode);
    };

    let raw: unknown;
    try {
      raw = await extractor.extract(prepared);
    } catch (error) {
      const code = error instanceof AiError ? error.code : "AI_REQUEST_FAILED";
      return fail(
        code,
        code === "AI_NOT_CONFIGURED" ? "ai_not_configured" : "ai_failed",
      );
    }
    // The model's output is untrusted input: it must satisfy the schema before anything is stored.
    const parsed = invoiceExtractionSchema.safeParse(raw);
    if (!parsed.success) return fail("AI_RESPONSE_INVALID", "ai_failed");
    const invoice = normalizeInvoiceExtraction(parsed.data);
    if (!invoice.lines.length) return fail("NO_LINES", "no_valid_rows");

    const supplierId = invoice.supplierName
      ? await this.findSupplierId(invoice.supplierName)
      : null;
    const catalog = await this.loadCatalog();
    const aliases = await this.loadAliases(supplierId);
    const variantUuid = new Map(
      catalog.map((item) => [item.variantId, item.id]),
    );
    const header: ExtractionHeader = {
      supplierName: invoice.supplierName,
      supplierId,
      reference: invoice.reference,
      invoiceDate: invoice.invoiceDate,
      paymentStatus: invoice.paymentStatus,
      paidAgorot: invoice.paidAgorot,
      discountAgorot: invoice.discountAgorot,
      taxAgorot: invoice.taxAgorot,
      printedTotalAgorot: invoice.printedTotalAgorot,
      currency: invoice.currency,
      confidence: invoice.confidence,
      warnings: invoice.warnings,
    };

    await this.database.transaction(async (transaction) => {
      await transaction
        .update(schema.extractionJobs)
        .set({
          status: "needs_review",
          header: { ...header },
          updatedAt: new Date(),
        })
        .where(eq(schema.extractionJobs.id, job.id));
      await transaction.insert(schema.extractionJobLines).values(
        invoice.lines.map((line) => {
          const values: ExtractionLineValues = {
            name: line.name,
            barcode: line.barcode,
            sku: line.sku,
            size: line.size,
            unit: line.unit,
            quantityMilli: line.quantityMilli,
            unitCostAgorot: line.unitCostAgorot,
            totalAgorot: line.totalAgorot,
            extractionConfidence: line.extractionConfidence,
          };
          const base = {
            jobId: job.id,
            lineNo: line.lineNo,
            raw: { ...parsed.data.lines[line.lineNo - 1] },
            normalized: { ...values },
          };
          if (line.errors.length) {
            return { ...base, status: "error" as const, errors: line.errors };
          }
          const match = matchLine(line, catalog, aliases);
          // A line the model could barely read is never matched automatically.
          const trusted =
            line.extractionConfidence >= MIN_AUTO_MATCH_CONFIDENCE;
          const status =
            match.status === "matched" && !trusted ? "suggested" : match.status;
          return {
            ...base,
            status,
            matchMethod: match.method,
            matchedVariantId:
              status === "matched" && match.variantId
                ? (variantUuid.get(match.variantId) ?? null)
                : null,
            confidence: Math.min(
              match.confidence ?? line.extractionConfidence,
              line.extractionConfidence,
            ),
            candidates: match.candidates,
            errors: [],
          };
        }),
      );
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "extraction_create",
        entityType: "extraction_job",
        entityId: job.id,
        beforeState: null,
        afterState: {
          kind: "purchase_invoice_ai",
          rowCount: invoice.lines.length,
          model: extractor.model,
          promptVersion: INVOICE_PROMPT_VERSION,
        },
      });
    });
    return { jobId: job.id };
  }

  async getJob(
    actor: AdminActor,
    jobId: string,
  ): Promise<ExtractionJobView | null> {
    if (!z.uuid().safeParse(jobId).success) return null;
    const [job] = await this.database
      .select()
      .from(schema.extractionJobs)
      .where(eq(schema.extractionJobs.id, jobId))
      .limit(1);
    if (!job) return null;
    this.authorize(actor, job.kind);

    const [lines, documents] = await Promise.all([
      this.database
        .select({
          line: schema.extractionJobLines,
          variantDomainId: schema.productVariants.domainId,
        })
        .from(schema.extractionJobLines)
        .leftJoin(
          schema.productVariants,
          eq(
            schema.productVariants.id,
            schema.extractionJobLines.matchedVariantId,
          ),
        )
        .where(eq(schema.extractionJobLines.jobId, jobId))
        .orderBy(asc(schema.extractionJobLines.lineNo)),
      this.database
        .select({
          id: schema.documentUploads.id,
          kind: schema.documentUploads.kind,
          pageNo: schema.extractionJobDocuments.pageNo,
        })
        .from(schema.extractionJobDocuments)
        .innerJoin(
          schema.documentUploads,
          eq(
            schema.documentUploads.id,
            schema.extractionJobDocuments.documentId,
          ),
        )
        .where(eq(schema.extractionJobDocuments.jobId, jobId))
        .orderBy(asc(schema.extractionJobDocuments.pageNo)),
    ]);

    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      idempotencyKey: job.idempotencyKey,
      createdAt: job.createdAt.toISOString(),
      header: {
        ...emptyHeader,
        ...((job.reviewedHeader ??
          job.header ??
          {}) as Partial<ExtractionHeader>),
      },
      documents,
      purchaseInvoiceId: job.purchaseInvoiceId,
      lines: lines.map(({ line, variantDomainId }) => ({
        id: line.id,
        lineNo: line.lineNo,
        status: line.status,
        matchMethod: line.matchMethod,
        variantId: variantDomainId,
        confidence: line.confidence,
        candidates: line.candidates as MatchCandidate[],
        errors: line.errors,
        values: line.normalized as unknown as ExtractionLineValues,
      })),
    };
  }

  async listAwaitingReview(actor: AdminActor) {
    assertPermission(actor, "purchase.record");
    const kinds: ExtractionJobKind[] = can(actor, "purchase.import")
      ? ["purchase_invoice_ai", "purchase_excel"]
      : ["purchase_invoice_ai"];
    const rows = await this.database
      .select({
        id: schema.extractionJobs.id,
        kind: schema.extractionJobs.kind,
        createdAt: schema.extractionJobs.createdAt,
      })
      .from(schema.extractionJobs)
      .where(
        and(
          eq(schema.extractionJobs.status, "needs_review"),
          inArray(schema.extractionJobs.kind, kinds),
        ),
      )
      .orderBy(desc(schema.extractionJobs.createdAt))
      .limit(10);
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // The human-reviewed purchase is posted and the job closed in one transaction.
  async confirm(
    actor: AdminActor,
    jobId: string,
    input: PurchaseInput,
  ): Promise<PurchasePostResult> {
    const parsed = purchaseInputSchema.safeParse(input);
    if (!parsed.success || !z.uuid().safeParse(jobId).success) {
      throw new PurchaseError("invalid_input");
    }

    return this.database.transaction(async (transaction) => {
      const [job] = await transaction
        .select()
        .from(schema.extractionJobs)
        .where(eq(schema.extractionJobs.id, jobId))
        .for("update");
      if (!job) throw new ExtractionError("not_found");
      this.authorize(actor, job.kind);
      if (job.status === "confirmed" && job.purchaseInvoiceId) {
        const [invoice] = await transaction
          .select({ totalAgorot: schema.purchaseInvoices.totalAgorot })
          .from(schema.purchaseInvoices)
          .where(eq(schema.purchaseInvoices.id, job.purchaseInvoiceId));
        return {
          invoiceId: job.purchaseInvoiceId,
          totalAgorot: invoice?.totalAgorot ?? 0,
          replayed: true,
          lines: [],
        };
      }
      if (job.status !== "needs_review") {
        throw new ExtractionError("not_reviewable");
      }

      const jobLines = await transaction
        .select({
          line: schema.extractionJobLines,
          variantDomainId: schema.productVariants.domainId,
        })
        .from(schema.extractionJobLines)
        .leftJoin(
          schema.productVariants,
          eq(
            schema.productVariants.id,
            schema.extractionJobLines.matchedVariantId,
          ),
        )
        .where(eq(schema.extractionJobLines.jobId, jobId));
      const [firstDocument] = await transaction
        .select({ documentId: schema.extractionJobDocuments.documentId })
        .from(schema.extractionJobDocuments)
        .where(eq(schema.extractionJobDocuments.jobId, jobId))
        .orderBy(asc(schema.extractionJobDocuments.pageNo))
        .limit(1);

      const data: PurchaseInput = {
        ...parsed.data,
        // The job owns these values; the client cannot redirect the posting elsewhere.
        idempotencyKey: job.idempotencyKey,
        source: job.kind === "purchase_excel" ? "excel" : "ai_capture",
        extractionJobId: job.id,
        documentId: firstDocument?.documentId,
      };
      const result = await this.purchases.postInTransaction(
        transaction,
        actor,
        data,
      );

      const [invoice] = await transaction
        .select({ supplierId: schema.purchaseInvoices.supplierId })
        .from(schema.purchaseInvoices)
        .where(eq(schema.purchaseInvoices.id, result.invoiceId));
      const variantRows = await transaction
        .select({
          id: schema.productVariants.id,
          domainId: schema.productVariants.domainId,
        })
        .from(schema.productVariants)
        .where(
          inArray(
            schema.productVariants.domainId,
            data.lines.map((line) => line.variantId),
          ),
        );
      const variantUuid = new Map(
        variantRows.map((row) => [row.domainId, row.id]),
      );
      const reviewed = new Map(
        data.lines
          .filter((line) => line.sourceLineNo !== undefined)
          .map((line) => [line.sourceLineNo!, line]),
      );
      const now = new Date();

      for (const { line, variantDomainId } of jobLines) {
        const final = reviewed.get(line.lineNo);
        if (!final) {
          if (line.status !== "error") {
            await transaction
              .update(schema.extractionJobLines)
              .set({ status: "ignored", updatedAt: now })
              .where(eq(schema.extractionJobLines.id, line.id));
          }
          continue;
        }
        const values = line.normalized as unknown as ExtractionLineValues;
        const corrections: Record<string, unknown> = {};
        if (final.variantId !== variantDomainId) {
          corrections.variantId = {
            from: variantDomainId,
            to: final.variantId,
          };
        }
        if (final.quantityMilli !== values.quantityMilli) {
          corrections.quantityMilli = {
            from: values.quantityMilli,
            to: final.quantityMilli,
          };
        }
        if (final.unitCostAgorot !== values.unitCostAgorot) {
          corrections.unitCostAgorot = {
            from: values.unitCostAgorot,
            to: final.unitCostAgorot,
          };
        }
        const variantChanged = "variantId" in corrections;
        const finalVariantId = variantUuid.get(final.variantId) ?? null;
        await transaction
          .update(schema.extractionJobLines)
          .set({
            status: "matched",
            matchMethod: variantChanged ? "manual" : line.matchMethod,
            matchedVariantId: finalVariantId,
            corrections: Object.keys(corrections).length ? corrections : null,
            updatedAt: now,
          })
          .where(eq(schema.extractionJobLines.id, line.id));

        // A manual choice teaches the matcher this supplier's wording for next time.
        const alias = normalizeArabicText(values.name);
        if (variantChanged && finalVariantId && invoice && alias.length >= 2) {
          await transaction
            .insert(schema.supplierProductAliases)
            .values({
              supplierId: invoice.supplierId,
              variantId: finalVariantId,
              aliasText: values.name.slice(0, 280),
              normalizedAlias: alias.slice(0, 280),
            })
            .onConflictDoUpdate({
              target: [
                schema.supplierProductAliases.supplierId,
                schema.supplierProductAliases.normalizedAlias,
              ],
              set: { variantId: finalVariantId },
            });
        }
      }

      await transaction
        .update(schema.extractionJobs)
        .set({
          status: "confirmed",
          reviewedHeader: {
            ...emptyHeader,
            supplierName: data.supplierName ?? null,
            supplierId: invoice?.supplierId ?? null,
            reference: data.reference ?? null,
            invoiceDate: data.invoiceDate,
            paidAgorot: data.paidAgorot,
            discountAgorot: data.discountAgorot,
            taxAgorot: data.taxAgorot,
            printedTotalAgorot: data.printedTotalAgorot,
          },
          purchaseInvoiceId: result.invoiceId,
          confirmedBy: actor.id,
          confirmedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.extractionJobs.id, job.id));
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "extraction_confirm",
        entityType: "extraction_job",
        entityId: job.id,
        beforeState: { status: job.status },
        afterState: { status: "confirmed", lineCount: data.lines.length },
        createdAt: now,
      });
      return result;
    });
  }

  async discard(actor: AdminActor, jobId: string): Promise<void> {
    if (!z.uuid().safeParse(jobId).success) {
      throw new ExtractionError("invalid_input");
    }
    await this.database.transaction(async (transaction) => {
      const [job] = await transaction
        .select()
        .from(schema.extractionJobs)
        .where(eq(schema.extractionJobs.id, jobId))
        .for("update");
      if (!job) throw new ExtractionError("not_found");
      this.authorize(actor, job.kind);
      if (job.status !== "needs_review") {
        throw new ExtractionError("not_reviewable");
      }
      await transaction
        .update(schema.extractionJobs)
        .set({ status: "discarded", updatedAt: new Date() })
        .where(eq(schema.extractionJobs.id, job.id));
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "extraction_discard",
        entityType: "extraction_job",
        entityId: job.id,
        beforeState: { status: job.status },
        afterState: { status: "discarded" },
      });
    });
  }

  async errorRowsCsv(actor: AdminActor, jobId: string): Promise<string | null> {
    const job = await this.getJob(actor, jobId);
    if (!job) return null;
    const rows = job.lines
      .filter((line) => line.status === "error")
      .map((line) => [
        String(line.lineNo),
        line.values.name,
        line.values.barcode,
        line.errors.join(" "),
      ]);
    return toCsv([["رقم الصف", "اسم المنتج", "الباركود", "الخطأ"], ...rows]);
  }

  async saveDocument(
    actor: AdminActor,
    input: {
      kind: DocumentKind;
      bytes: Buffer;
      extension: string;
      mimeType: string;
      originalName: string;
    },
  ): Promise<{ id: string }> {
    const now = new Date();
    const objectPath = `${input.kind}/${now.getUTCFullYear()}/${randomUUID()}.${input.extension}`;
    const location = await this.store().put(
      objectPath,
      input.bytes,
      input.mimeType,
    );
    const [document] = await this.database
      .insert(schema.documentUploads)
      .values({
        kind: input.kind,
        storageProvider: location.provider,
        bucket: location.bucket,
        path: location.path,
        originalName: sanitizeFilename(input.originalName),
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        uploadedBy: actor.id,
        createdAt: now,
      })
      .returning({ id: schema.documentUploads.id });
    if (!document) throw new ExtractionError("invalid_input");
    return document;
  }

  async getDocument(actor: AdminActor, documentId: string) {
    assertPermission(actor, "purchase.record");
    if (!z.uuid().safeParse(documentId).success) return null;
    const [document] = await this.database
      .select()
      .from(schema.documentUploads)
      .where(eq(schema.documentUploads.id, documentId))
      .limit(1);
    if (!document) return null;
    if (document.kind === "spreadsheet") {
      assertPermission(actor, "purchase.import");
    }
    return document;
  }

  async loadCatalog(): Promise<Array<CatalogVariant & { id: string }>> {
    const rows = await this.database
      .select({
        id: schema.productVariants.id,
        variantId: schema.productVariants.domainId,
        labelAr: schema.productVariants.labelAr,
        sku: schema.productVariants.sku,
        barcode: schema.productVariants.barcode,
        nameAr: schema.products.nameAr,
        latinName: schema.products.latinName,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      );
    return rows.map((row) => ({
      id: row.id,
      variantId: row.variantId,
      productName: row.latinName
        ? `${row.nameAr} ${row.latinName}`
        : row.nameAr,
      variantLabel: row.labelAr === "الافتراضي" ? null : row.labelAr,
      sku: row.sku,
      barcode: row.barcode,
    }));
  }

  async loadAliases(supplierId: string | null): Promise<Map<string, string>> {
    const rows = await this.database
      .select({
        normalizedAlias: schema.supplierProductAliases.normalizedAlias,
        variantId: schema.productVariants.domainId,
      })
      .from(schema.supplierProductAliases)
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.id, schema.supplierProductAliases.variantId),
      )
      .where(
        supplierId
          ? eq(schema.supplierProductAliases.supplierId, supplierId)
          : undefined,
      );
    return new Map(rows.map((row) => [row.normalizedAlias, row.variantId]));
  }

  async findSupplierId(name: string): Promise<string | null> {
    const [supplier] = await this.database
      .select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.normalizedName, normalizeArabicText(name)))
      .limit(1);
    return supplier?.id ?? null;
  }

  private authorize(actor: AdminActor, kind: ExtractionJobKind) {
    assertPermission(
      actor,
      kind === "purchase_excel" ? "purchase.import" : "purchase.record",
    );
  }

  private async parse(bytes: Buffer) {
    try {
      return await readSpreadsheet(bytes);
    } catch (error) {
      if (error instanceof SpreadsheetError) {
        throw new ExtractionError(error.code);
      }
      throw error;
    }
  }
}
