import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  MousePointerClick,
  ShoppingBag,
  Wallet,
  Clapperboard,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  Share2,
} from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { MetricCard, PageHeader, StatusPill } from "@/features/admin/ui/kit";
import { socialService } from "@/features/social/application/social-instance";
import {
  postTitle,
  SocialNav,
  StoreTime,
} from "@/features/social/ui/social-ui";
import { MIN_VISITS_FOR_RATE } from "@/features/social/application/campaign-attribution";
import { angleCreative } from "@/features/social/domain/campaign-creative";
import { formatIls } from "@/shared/lib/format-currency";
import { todayInStoreZone } from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "فيسبوك — التحليلات" };

const jobLabels: Record<string, string> = {
  discover: "اكتشاف المنتجات",
  draft: "تحضير المسودات",
  render: "تجهيز الصور والفيديو",
  publish: "النشر",
  reconcile: "مطابقة النشر المعلّق",
  engagement: "جمع التفاعل",
  comments: "قراءة التعليقات",
  connection: "فحص ربط فيسبوك",
  report: "التقرير الأسبوعي",
};

export default async function SocialAnalyticsPage() {
  const actor = await requireAdminSession();
  const [report, rows, runs, results] = await Promise.all([
    socialService.weeklyReport(todayInStoreZone()),
    socialService.listPosts(actor, { statuses: ["published"] }),
    socialService.jobRuns(actor, 30),
    socialService.campaignResults(actor),
  ]);
  const campaigns = results.rows;
  const totals = campaigns.reduce(
    (sum, row) => ({
      visits: sum.visits + row.visits,
      orders: sum.orders + row.orders,
      sales: sum.sales + row.verifiedSalesAgorot,
    }),
    { visits: 0, orders: 0, sales: 0 },
  );
  const overallRate =
    totals.visits >= MIN_VISITS_FOR_RATE ? totals.orders / totals.visits : null;
  const rateText = (rate: number | null) =>
    rate === null ? "بيانات غير كافية" : `${(rate * 100).toFixed(1)}٪`;
  const ranked = rows
    .filter((row) => row.engagement)
    .sort(
      (a, b) =>
        b.engagement!.reactions +
        b.engagement!.comments +
        b.engagement!.shares -
        (a.engagement!.reactions +
          a.engagement!.comments +
          a.engagement!.shares),
    )
    .slice(0, 10);

  return (
    <main className="admin-page">
      <PageHeader
        title="التحليلات"
        lede={
          <>
            آخر ٧ أيام (
            <bdi dir="ltr">
              {report.startDate} → {report.endDate}
            </bdi>
            ). الأرقام من فيسبوك نفسه؛ ما لم يرجعه فيسبوك يبقى فارغاً.
          </>
        }
      />
      <SocialNav current="/admin/social/analytics" />
      <section className="admin-metric-grid" aria-label="الأسبوع">
        <MetricCard label="منشورات" value={report.posts} Icon={ImageIcon} />
        <MetricCard label="ريلز" value={report.reels} Icon={Clapperboard} />
        <MetricCard label="تفاعلات" value={report.reactions} Icon={Heart} />
        <MetricCard
          label="تعليقات"
          value={report.comments}
          Icon={MessageCircle}
        />
        <MetricCard label="مشاركات" value={report.shares} Icon={Share2} />
        <MetricCard
          label="الوصول"
          value={report.reach ?? "—"}
          support={
            report.reach === null ? "يحتاج صلاحية read_insights" : undefined
          }
        />
        <MetricCard
          label="فشل النشر"
          value={report.failed}
          tone={report.failed ? "danger" : "neutral"}
          href="/admin/social/queue?status=failed"
        />
        <MetricCard
          label="تعليقات تنتظرك"
          value={report.openEscalations}
          tone={report.openEscalations ? "warning" : "neutral"}
          href="/admin/social/inbox"
        />
      </section>

      <section className="admin-panel" aria-labelledby="campaigns-title">
        <h2 id="campaigns-title">نتائج الحملات من الروابط المتتبَّعة</h2>
        <p className="admin-muted">
          زيارة واحدة لكل جلسة متصفح من رابط حملة، وطلب يُنسب للحملة إذا وصل
          الزبون من رابطها خلال ٣٠ يوماً. المبيعات المؤكدة هي الطلبات التي
          سُلّمت فقط. لا تُخزَّن بيانات شخصية ولا تُستخدم أدوات تتبع خارجية.
        </p>
        <div className="admin-metric-grid">
          <MetricCard
            label="زيارات متتبَّعة"
            value={totals.visits}
            Icon={MousePointerClick}
          />
          <MetricCard
            label="طلبات منسوبة"
            value={totals.orders}
            Icon={ShoppingBag}
          />
          <MetricCard
            label="مبيعات مؤكدة"
            value={
              results.salesVisible
                ? totals.sales
                  ? formatIls(totals.sales)
                  : "بيانات غير كافية"
                : "—"
            }
            support={results.salesVisible ? "طلبات مسلّمة فقط" : "للمالكة فقط"}
            Icon={Wallet}
          />
          <MetricCard
            label="نسبة التحويل"
            value={rateText(overallRate)}
            support={
              overallRate === null
                ? `تظهر بعد ${MIN_VISITS_FOR_RATE} زيارة على الأقل`
                : undefined
            }
          />
        </div>
        {campaigns.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">الحملة</th>
                  <th scope="col">الرمز</th>
                  <th scope="col">زيارات</th>
                  <th scope="col">طلبات</th>
                  <th scope="col">مسلّمة</th>
                  {results.salesVisible ? (
                    <th scope="col">مبيعات مؤكدة</th>
                  ) : null}
                  <th scope="col">تحويل</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((row) => (
                  <tr key={row.postId}>
                    <td>
                      <Link
                        href={`/admin/social/posts/${row.postId}`}
                        prefetch={false}
                      >
                        {(row.angleId && angleCreative[row.angleId]?.nameAr) ||
                          "حملة"}
                      </Link>
                    </td>
                    <td>
                      <bdi dir="ltr">{row.code}</bdi>
                    </td>
                    <td className="admin-num">{row.visits}</td>
                    <td className="admin-num">{row.orders}</td>
                    <td className="admin-num">{row.deliveredOrders}</td>
                    {results.salesVisible ? (
                      <td className="admin-num">
                        {formatIls(row.verifiedSalesAgorot)}
                      </td>
                    ) : null}
                    <td>{rateText(row.conversionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-empty">
            بيانات غير كافية: لم تصل بعد زيارات أو طلبات من روابط الحملات.
          </p>
        )}
      </section>

      <section className="admin-panel" aria-labelledby="top-title">
        <h2 id="top-title">أكثر المنشورات تفاعلاً</h2>
        {ranked.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">المنشور</th>
                  <th scope="col">نُشر</th>
                  <th scope="col">تفاعل</th>
                  <th scope="col">تعليقات</th>
                  <th scope="col">مشاركات</th>
                  <th scope="col">وصول</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ post, engagement }) => (
                  <tr key={post.id}>
                    <td>
                      <Link
                        href={`/admin/social/posts/${post.id}`}
                        prefetch={false}
                      >
                        {postTitle(post)}
                      </Link>
                    </td>
                    <td>
                      <StoreTime value={post.publishedAt} />
                    </td>
                    <td className="admin-num">{engagement!.reactions}</td>
                    <td className="admin-num">{engagement!.comments}</td>
                    <td className="admin-num">{engagement!.shares}</td>
                    <td className="admin-num">{engagement!.reach ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-empty">لا أرقام بعد. تُجمع يومياً بعد النشر.</p>
        )}
      </section>

      <section className="admin-panel" aria-labelledby="jobs-title">
        <h2 id="jobs-title">
          <Activity size={18} aria-hidden="true" /> سجل المهام المجدولة
        </h2>
        <ol className="admin-line-list">
          {runs.map((run) => (
            <li key={run.id} className="admin-line">
              <span className="admin-line-main">
                <strong>{jobLabels[run.job] ?? run.job}</strong>{" "}
                <StatusPill
                  tone={
                    run.status === "ok"
                      ? "ok"
                      : run.status === "failed"
                        ? "danger"
                        : run.status === "skipped"
                          ? "neutral"
                          : "info"
                  }
                  Icon={Activity}
                >
                  {run.status === "ok"
                    ? "تم"
                    : run.status === "failed"
                      ? `فشل ${run.errorCode ?? ""}`
                      : run.status === "skipped"
                        ? "تخطّي"
                        : "يعمل"}
                </StatusPill>
                <small className="admin-muted">
                  {" "}
                  <bdi dir="ltr">
                    {Object.entries(run.summary)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(" ")}
                  </bdi>
                </small>
              </span>
              <span className="admin-line-side">
                <StoreTime value={run.startedAt} />
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
