import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Download,
  HelpCircle,
} from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import {
  extractionService,
  inventoryService,
  supplierService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { PageHeader, StatusPill } from "@/features/admin/ui/kit";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import type { ExtractionJobView } from "@/features/purchasing/application/extraction-service";
import { draftFromExtraction } from "@/features/purchasing/domain/purchase-draft";
import {
  DiscardExtractionForm,
  ExtractionReviewForm,
} from "@/features/purchasing/ui/extraction-review-form";
import { InvoiceDocuments } from "@/features/purchasing/ui/invoice-documents";
import { formatIls } from "@/shared/lib/format-currency";
import { todayInStoreZone } from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "مراجعة قبل الحفظ" };

async function loadJob(
  actor: Awaited<ReturnType<typeof requireAdminSession>>,
  jobId: string,
): Promise<ExtractionJobView | null> {
  try {
    return await extractionService.getJob(actor, jobId);
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/admin/inventory");
    throw error;
  }
}

export default async function ExtractionReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const job = await loadJob(actor, (await params).jobId);
  if (!job) notFound();

  const isSpreadsheet = job.kind === "purchase_excel";
  const counts = {
    matched: job.lines.filter((line) => line.status === "matched").length,
    undecided: job.lines.filter(
      (line) => line.status === "suggested" || line.status === "unmatched",
    ).length,
    ignored: job.lines.filter((line) => line.status === "ignored").length,
    errors: job.lines.filter((line) => line.status === "error").length,
  };
  const errorLines = job.lines.filter((line) => line.status === "error");

  const summary = (
    <div className="admin-summary-counts" aria-label="ملخص الأسطر">
      <StatusPill tone="ok" Icon={CheckCircle2}>
        {counts.matched} {job.status === "confirmed" ? "أُدخل" : "مطابق"}
      </StatusPill>
      {counts.undecided ? (
        <StatusPill tone="warn" Icon={HelpCircle}>
          {counts.undecided} يحتاج اختيارك
        </StatusPill>
      ) : null}
      {counts.ignored ? (
        <StatusPill tone="neutral" Icon={CircleSlash}>
          {counts.ignored} تم تجاهله
        </StatusPill>
      ) : null}
      {counts.errors ? (
        <StatusPill tone="danger" Icon={AlertTriangle}>
          {counts.errors} فيه خطأ
        </StatusPill>
      ) : null}
    </div>
  );

  const errorsPanel = errorLines.length ? (
    <section className="admin-panel" aria-labelledby="error-rows-title">
      <div className="admin-panel-header">
        <h2 id="error-rows-title">صفوف لن تُدخل بسبب أخطاء</h2>
        {isSpreadsheet ? (
          <a href={`/admin/api/imports/${job.id}/errors`} download>
            <Download size={16} aria-hidden="true" /> تنزيل الصفوف
          </a>
        ) : null}
      </div>
      <ul className="admin-line-list">
        {errorLines.map((line) => (
          <li key={line.id} className="admin-line">
            <span className="admin-line-main">
              <strong>
                {isSpreadsheet ? "الصف" : "السطر"}{" "}
                <bdi dir="ltr">{line.lineNo}</bdi>
                {line.values.name ? ` — ${line.values.name}` : ""}
              </strong>
              <small>{line.errors.join(" ")}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  if (job.status !== "needs_review") {
    return (
      <main className="admin-page admin-page--narrow">
        <PageHeader
          title={
            job.status === "confirmed"
              ? "تقرير الإدخال"
              : job.status === "discarded"
                ? "مراجعة تم تجاهلها"
                : "تعذّرت القراءة"
          }
          back={{ href: "/admin/inventory", label: "المخزون والمشتريات" }}
        />
        <section className="admin-panel">
          {summary}
          {job.status === "confirmed" && job.purchaseInvoiceId ? (
            <>
              <p>
                أُضيفت الكميات إلى المخزون في فاتورة شراء واحدة، وحُفظ الملف
                الأصلي مع سجل التعديلات.
              </p>
              <ul className="admin-line-list">
                {job.lines
                  .filter((line) => line.status === "matched")
                  .map((line) => (
                    <li key={line.id} className="admin-line">
                      <span className="admin-line-main">
                        <strong>{line.values.name || "—"}</strong>
                      </span>
                      <span className="admin-line-side">
                        <bdi dir="ltr">
                          {line.values.quantityMilli === null
                            ? "—"
                            : formatQuantity(line.values.quantityMilli)}
                        </bdi>
                      </span>
                    </li>
                  ))}
              </ul>
              <Link
                className="admin-btn admin-btn-primary"
                href={`/admin/inventory/purchases/${job.purchaseInvoiceId}`}
                prefetch={false}
              >
                عرض فاتورة الشراء
              </Link>
            </>
          ) : (
            <p className="admin-muted">لم يتغيّر المخزون من هذه المراجعة.</p>
          )}
        </section>
        {errorsPanel}
      </main>
    );
  }

  const [stock, suppliers] = await Promise.all([
    inventoryService.listStock(actor),
    supplierService.list(actor),
  ]);

  return (
    <main className="admin-page admin-page--review">
      <PageHeader
        title="مراجعة قبل الحفظ"
        lede="هذه قراءة آلية. صحّحي ما يلزم ثم أكّدي — لن يُحفظ شيء قبل تأكيدك."
        back={{ href: "/admin/inventory", label: "المخزون والمشتريات" }}
      />
      <div className="admin-review-layout">
        <div className="admin-review-side">
          <section className="admin-panel" aria-label="ملخص القراءة">
            {summary}
          </section>
          <InvoiceDocuments documents={job.documents} />
          {errorsPanel}
        </div>
        <div className="admin-review-main">
          <ExtractionReviewForm
            jobId={job.id}
            source={isSpreadsheet ? "excel" : "ai_capture"}
            variants={stock.map((item) => ({
              variantId: item.variantId,
              name: item.name,
              variantLabel: item.variantLabel,
              sku: item.sku,
              barcode: item.barcode,
              unit: item.unit,
              hint: `${item.tracked ? `المتوفر ${formatQuantity(item.availableMilli)}` : "غير متتبَّع بعد"} · البيع ${formatIls(item.salePriceAgorot)}`,
            }))}
            suppliers={suppliers
              .filter((supplier) => supplier.active)
              .map((supplier) => ({
                id: supplier.id,
                nameAr: supplier.nameAr,
              }))}
            initialDraft={draftFromExtraction(job, todayInStoreZone())}
          />
          <DiscardExtractionForm jobId={job.id} />
        </div>
      </div>
    </main>
  );
}
