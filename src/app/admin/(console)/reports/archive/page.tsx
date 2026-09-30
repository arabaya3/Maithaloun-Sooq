import type { Metadata } from "next";
import Link from "next/link";
import { Archive } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { summaryService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { EmptyState, PageHeader } from "@/features/admin/ui/kit";
import { summaryFrequencyLabels } from "@/features/reminders/domain/schedule-constants";

export const metadata: Metadata = { title: "أرشيف الملخصات" };

export default async function SummaryArchivePage() {
  await connection();
  const actor = await requireAdminSession();
  if (!can(actor, "reports.view")) redirect("/admin");
  const [summaries, frequency] = await Promise.all([
    summaryService.list(actor),
    summaryService.getFrequency(),
  ]);

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title="أرشيف الملخصات"
        lede={`الموعد الحالي: ${summaryFrequencyLabels[frequency]}. يتغيّر من إعدادات المتجر.`}
        back={{ href: "/admin/reports", label: "التقارير" }}
      />
      {summaries.length ? (
        <section className="admin-panel" aria-label="الملخصات المحفوظة">
          <ul className="admin-line-list">
            {summaries.map((summary) => (
              <li key={summary.id}>
                <Link
                  href={`/admin/reports/archive/${summary.id}`}
                  prefetch={false}
                  className="admin-line"
                >
                  <span className="admin-line-main">
                    <strong>
                      {summary.kind === "fortnightly"
                        ? "ملخص 14 يوماً"
                        : "ملخص شهري"}{" "}
                      — <bdi dir="ltr">{summary.periodFrom}</bdi> إلى{" "}
                      <bdi dir="ltr">{summary.periodTo}</bdi>
                    </strong>
                    <small>{summary.headline}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState Icon={Archive} title="لا توجد ملخصات محفوظة بعد">
          <p className="admin-muted">
            يُحفظ هنا ملخص تلقائي في الموعد المحدد ويصل إشعار عند جاهزيته.
          </p>
        </EmptyState>
      )}
    </main>
  );
}
