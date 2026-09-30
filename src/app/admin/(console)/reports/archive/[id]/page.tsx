import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { summaryService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { Money, PageHeader, Quantity } from "@/features/admin/ui/kit";
import { InsightView } from "@/features/reminders/ui/insight-panel";
import { formatBasisPoints } from "@/shared/lib/money-math";

export const metadata: Metadata = { title: "ملخص محفوظ" };

export default async function ArchivedSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  if (!can(actor, "reports.view")) redirect("/admin");
  const summary = await summaryService.get(actor, (await params).id);
  if (!summary) notFound();
  const { metrics } = summary.report;

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title={summary.kind === "fortnightly" ? "ملخص 14 يوماً" : "ملخص شهري"}
        lede={
          <>
            من <bdi dir="ltr">{summary.periodFrom}</bdi> إلى{" "}
            <bdi dir="ltr">{summary.periodTo}</bdi> · أُعدّ{" "}
            {formatAdminDateTime(summary.createdAt)}
          </>
        }
        back={{ href: "/admin/reports/archive", label: "أرشيف الملخصات" }}
      />

      <section className="admin-panel" aria-labelledby="archived-figures">
        <h2 id="archived-figures">الأرقام المحفوظة</h2>
        <p>{summary.headline}</p>
        <dl className="admin-figures">
          <div>
            <dt>صافي المبيعات</dt>
            <dd>
              <Money agorot={metrics.netSalesAgorot} />
            </dd>
          </div>
          <div>
            <dt>تكلفة البضاعة المباعة</dt>
            <dd>
              <Money agorot={metrics.cogsAgorot} />
            </dd>
          </div>
          <div>
            <dt>الربح الإجمالي</dt>
            <dd>
              <Money agorot={metrics.grossProfitAgorot} />
              {metrics.grossMarginBasisPoints === null ? null : (
                <small className="admin-muted">
                  {" "}
                  <bdi dir="ltr">
                    {formatBasisPoints(metrics.grossMarginBasisPoints)}
                  </bdi>
                </small>
              )}
            </dd>
          </div>
          <div>
            <dt>النقد المحصَّل</dt>
            <dd>
              <Money agorot={metrics.cashCollectedAgorot} />
            </dd>
          </div>
          <div>
            <dt>المشتريات</dt>
            <dd>
              <Money agorot={metrics.purchasesAgorot} />
            </dd>
          </div>
          <div>
            <dt>عدد العمليات</dt>
            <dd>
              <bdi dir="ltr">{metrics.orderCount}</bdi>
            </dd>
          </div>
        </dl>
        {metrics.costComplete ? null : (
          <p className="admin-form-warning">
            الربح غير مكتمل: بعض المبيعات بلا تكلفة مسجّلة.
          </p>
        )}
      </section>

      {summary.report.byQuantity.length ? (
        <section className="admin-panel" aria-labelledby="archived-top">
          <h2 id="archived-top">الأكثر مبيعاً</h2>
          <ol className="admin-line-list">
            {summary.report.byQuantity.map((item) => (
              <li key={item.productKey} className="admin-line">
                <span className="admin-line-main">
                  <strong>{item.name}</strong>
                </span>
                <span className="admin-line-side">
                  <Quantity milli={item.quantityMilli} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {summary.insight ? (
        <section className="admin-panel" aria-label="ملخص ذكي">
          <InsightView insight={summary.insight} />
        </section>
      ) : null}
    </main>
  );
}
