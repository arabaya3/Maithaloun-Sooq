import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { reportService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { Money, PageHeader, Quantity } from "@/features/admin/ui/kit";
import { InsightPanel } from "@/features/reminders/ui/insight-panel";
import {
  reportPresetLabels,
  reportPresets,
  resolvePeriod,
  type ProductPerformance,
  type ReportPreset,
} from "@/features/reports/domain/report-calculation";
import { formatBasisPoints } from "@/shared/lib/money-math";
import { todayInStoreZone } from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "التقارير" };

const channelLabels = { storefront: "طلبات المتجر", manual: "بيع مباشر" };

function Figure({
  label,
  children,
  note,
}: {
  label: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {children}
        {note ? <small className="admin-muted"> {note}</small> : null}
      </dd>
    </div>
  );
}

function Ranking({
  title,
  items,
  value,
}: {
  title: string;
  items: ProductPerformance[];
  value: (item: ProductPerformance) => React.ReactNode;
}) {
  return (
    <section className="admin-panel" aria-label={title}>
      <h2>{title}</h2>
      {items.length ? (
        <ol className="admin-line-list">
          {items.map((item, index) => (
            <li key={item.productKey} className="admin-line">
              <span className="admin-line-main">
                <strong>
                  <bdi dir="ltr">{index + 1}</bdi>. {item.name}
                </strong>
              </span>
              <span className="admin-line-side">{value(item)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="admin-empty">لا توجد بيانات كافية في هذه الفترة.</p>
      )}
    </section>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  if (!can(actor, "reports.view")) redirect("/admin");
  const params = await searchParams;
  const preset: ReportPreset =
    reportPresets.find((item) => item === params.preset) ?? "week";
  const period = resolvePeriod(preset, todayInStoreZone(), params);
  const report = await reportService.getReport(actor, period);
  const { metrics } = report;
  const maxSales = Math.max(
    1,
    ...report.profitSeries.map((point) => point.netSalesAgorot),
  );

  return (
    <main className="admin-page">
      <PageHeader
        title="التقارير"
        lede={
          <>
            من <bdi dir="ltr">{period.from}</bdi> إلى{" "}
            <bdi dir="ltr">{period.to}</bdi>
          </>
        }
        actions={
          <Link
            className="admin-btn admin-btn-secondary admin-btn-sm"
            href="/admin/reports/archive"
            prefetch={false}
          >
            أرشيف الملخصات
          </Link>
        }
      />

      <nav className="admin-tabs" aria-label="الفترة">
        {reportPresets.map((item) => (
          <Link
            key={item}
            href={`/admin/reports?preset=${item}`}
            prefetch={false}
            className={item === preset ? "admin-tab is-active" : "admin-tab"}
            aria-current={item === preset ? "page" : undefined}
          >
            {reportPresetLabels[item]}
          </Link>
        ))}
      </nav>

      {preset === "custom" ? (
        <form className="admin-form admin-inline-form" action="/admin/reports">
          <input type="hidden" name="preset" value="custom" />
          <label>
            من تاريخ
            <input type="date" name="from" defaultValue={period.from} />
          </label>
          <label>
            إلى تاريخ
            <input type="date" name="to" defaultValue={period.to} />
          </label>
          <button type="submit" className="admin-btn admin-btn-primary">
            عرض
          </button>
        </form>
      ) : null}

      {metrics.costComplete ? null : (
        <p className="admin-form-warning" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            الربح غير مكتمل: مبيعات بقيمة{" "}
            <Money agorot={metrics.uncostedSalesAgorot} /> بلا تكلفة مسجّلة
            (أصناف غير متتبَّعة أو طلبات قبل بدء المخزون)، ولم تدخل في حساب
            الربح.
          </span>
        </p>
      )}

      <section className="admin-panel" aria-labelledby="sales-figures">
        <h2 id="sales-figures">المبيعات والربح</h2>
        <dl className="admin-figures">
          <Figure label="إجمالي المبيعات">
            <Money agorot={metrics.grossSalesAgorot} />
          </Figure>
          <Figure label="الخصومات">
            <Money agorot={metrics.discountsAgorot} />
          </Figure>
          <Figure label="المرتجعات">
            <Money agorot={metrics.returnsAgorot} />
          </Figure>
          <Figure label="صافي المبيعات">
            <Money agorot={metrics.netSalesAgorot} />
          </Figure>
          <Figure label="تكلفة البضاعة المباعة">
            <Money agorot={metrics.cogsAgorot} />
          </Figure>
          <Figure
            label="الربح الإجمالي"
            note={
              metrics.grossMarginBasisPoints === null
                ? undefined
                : `هامش ${formatBasisPoints(metrics.grossMarginBasisPoints)}`
            }
          >
            <Money agorot={metrics.grossProfitAgorot} />
          </Figure>
          <Figure label="عدد العمليات">
            <bdi dir="ltr">{metrics.orderCount}</bdi>
          </Figure>
          <Figure label="متوسط قيمة العملية">
            {metrics.averageOrderValueAgorot === null ? (
              "—"
            ) : (
              <Money agorot={metrics.averageOrderValueAgorot} />
            )}
          </Figure>
          <Figure label="الوحدات المباعة" note="قطع فعلية من المخزون">
            <Quantity milli={metrics.unitsSoldMilli} />
          </Figure>
          <Figure label="الباكيجات المباعة" note="كل باكيج أو كرتونة مرة واحدة">
            <bdi dir="ltr">{metrics.packsSold}</bdi>
          </Figure>
        </dl>
      </section>

      <InsightPanel period={period} />

      <section className="admin-panel" aria-labelledby="cash-figures">
        <h2 id="cash-figures">النقد والديون والمخزون</h2>
        <dl className="admin-figures">
          <Figure label="النقد المحصَّل">
            <Money agorot={metrics.cashCollectedAgorot} />
          </Figure>
          <Figure label="مبيعات على الحساب">
            <Money agorot={metrics.creditSalesAgorot} />
          </Figure>
          <Figure label="ديون الزبائن" note="حالياً">
            <Money agorot={metrics.outstandingBalancesAgorot} />
          </Figure>
          <Figure label="المشتريات">
            <Money agorot={metrics.purchasesAgorot} />
          </Figure>
          <Figure label="قيمة المخزون" note="حالياً">
            <Money agorot={metrics.inventoryValueAgorot} />
          </Figure>
          <Figure label="تالف وتسويات جرد">
            <Money agorot={metrics.shrinkageAgorot} />
          </Figure>
          <Figure
            label="دوران المخزون"
            note="تكلفة المباع ÷ قيمة المخزون الحالية"
          >
            {metrics.stockTurnoverBasisPoints === null ? (
              "—"
            ) : (
              <bdi dir="ltr">
                {formatBasisPoints(metrics.stockTurnoverBasisPoints)}
              </bdi>
            )}
          </Figure>
          <Figure label="رسوم التوصيل المحصَّلة">
            <Money agorot={report.deliveryFeesAgorot} />
          </Figure>
        </dl>
      </section>

      <section className="admin-panel" aria-labelledby="channels-title">
        <h2 id="channels-title">البيع المباشر مقابل طلبات المتجر</h2>
        <ul className="admin-line-list">
          {report.channels.map((channel) => (
            <li key={channel.channel} className="admin-line">
              <span className="admin-line-main">
                <strong>{channelLabels[channel.channel]}</strong>
                <small>
                  <bdi dir="ltr">{channel.orderCount}</bdi> عملية · ربح{" "}
                  <Money agorot={channel.grossProfitAgorot} />
                </small>
              </span>
              <span className="admin-line-side">
                <Money agorot={channel.netSalesAgorot} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-panel" aria-labelledby="series-title">
        <h2 id="series-title">المبيعات والربح حسب الفترة</h2>
        <ul className="admin-bar-list">
          {report.profitSeries
            .filter((point) => point.netSalesAgorot !== 0)
            .map((point) => (
              <li key={point.from}>
                <span className="admin-bar-label">
                  <bdi dir="ltr">{point.label}</bdi>
                </span>
                <span
                  className="admin-bar"
                  style={{
                    inlineSize: `${Math.max(4, Math.round((point.netSalesAgorot / maxSales) * 100))}%`,
                  }}
                  aria-hidden="true"
                />
                <span className="admin-bar-value">
                  <Money agorot={point.netSalesAgorot} /> · ربح{" "}
                  <Money agorot={point.grossProfitAgorot} />
                </span>
              </li>
            ))}
        </ul>
        {report.profitSeries.every((point) => point.netSalesAgorot === 0) ? (
          <p className="admin-empty">لا توجد مبيعات في هذه الفترة.</p>
        ) : null}
      </section>

      <div className="admin-two-column">
        <Ranking
          title="الأكثر مبيعاً بالكمية"
          items={report.byQuantity}
          value={(item) => <Quantity milli={item.quantityMilli} />}
        />
        <Ranking
          title="الأكثر مبيعاً بالقيمة"
          items={report.byRevenue}
          value={(item) => <Money agorot={item.netSalesAgorot} />}
        />
        <Ranking
          title="الأكثر ربحاً"
          items={report.byProfit}
          value={(item) => <Money agorot={item.profitAgorot ?? 0} />}
        />
        <Ranking
          title="الأعلى هامشاً"
          items={report.byMargin}
          value={(item) => (
            <bdi dir="ltr">
              {formatBasisPoints(item.marginBasisPoints ?? 0)}
            </bdi>
          )}
        />
      </div>

      <div className="admin-two-column">
        <Ranking
          title="المبيعات حسب المنتج"
          items={report.byProduct}
          value={(item) => (
            <>
              <Money agorot={item.netSalesAgorot} /> ·{" "}
              <Quantity milli={item.quantityMilli} /> قطعة
            </>
          )}
        />
        <section className="admin-panel" aria-labelledby="selling-units-title">
          <h2 id="selling-units-title">المبيعات حسب طريقة البيع</h2>
          {report.bySellingUnit.length ? (
            <ul className="admin-line-list">
              {report.bySellingUnit.map((row) => (
                <li key={row.key} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{row.name}</strong>
                    <small>
                      {row.sellingUnitLabel ?? "بالوحدة"} ·{" "}
                      <Quantity milli={row.saleQuantityMilli} /> مرة ·{" "}
                      <Quantity milli={row.quantityMilli} /> قطعة
                      {row.profitAgorot === null ? (
                        " · التكلفة غير مسجلة"
                      ) : (
                        <>
                          {" "}
                          · تكلفة <Money agorot={row.cogsAgorot ?? 0} /> · ربح{" "}
                          <Money agorot={row.profitAgorot} />
                        </>
                      )}
                    </small>
                  </span>
                  <span className="admin-line-side">
                    <Money agorot={row.netSalesAgorot} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">
              لا توجد مبيعات حسب طرق البيع في هذه الفترة.
            </p>
          )}
        </section>
      </div>

      <div className="admin-two-column">
        <section className="admin-panel" aria-labelledby="stock-alerts-title">
          <h2 id="stock-alerts-title">نواقص المخزون</h2>
          {report.outOfStock.length + report.lowStock.length ? (
            <ul className="admin-line-list">
              {report.outOfStock.map((item) => (
                <li key={`out-${item.name}`} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{item.name}</strong>
                  </span>
                  <span className="admin-line-side">نفد</span>
                </li>
              ))}
              {report.lowStock.map((item) => (
                <li key={`low-${item.name}`} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{item.name}</strong>
                  </span>
                  <span className="admin-line-side">
                    <Quantity milli={item.availableMilli} unit={item.unit} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">لا توجد نواقص.</p>
          )}
        </section>

        <section className="admin-panel" aria-labelledby="slow-title">
          <h2 id="slow-title">بضاعة راكدة</h2>
          {report.slowMoving.length ? (
            <ul className="admin-line-list">
              {report.slowMoving.map((item) => (
                <li key={item.name} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{item.name}</strong>
                    <small>
                      {item.daysSinceSale === null
                        ? "لم يُبع منذ بدء التتبّع"
                        : `آخر بيع قبل ${item.daysSinceSale} يوم`}
                    </small>
                  </span>
                  <span className="admin-line-side">
                    <Quantity milli={item.onHandMilli} unit={item.unit} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">لا توجد بضاعة راكدة.</p>
          )}
        </section>

        <section className="admin-panel" aria-labelledby="overdue-title">
          <h2 id="overdue-title">ديون متأخرة</h2>
          {report.overdueCustomers.length ? (
            <ul className="admin-line-list">
              {report.overdueCustomers.map((customer) => (
                <li key={customer.id}>
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    prefetch={false}
                    className="admin-line"
                  >
                    <span className="admin-line-main">
                      <strong>{customer.name}</strong>
                      <small>
                        منذ <bdi dir="ltr">{customer.ageDays}</bdi> يوم
                      </small>
                    </span>
                    <span className="admin-line-side">
                      <Money agorot={customer.balanceAgorot} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">لا توجد ديون متأخرة.</p>
          )}
        </section>

        <section className="admin-panel" aria-labelledby="cost-changes-title">
          <h2 id="cost-changes-title">تغيّر تكلفة الشراء</h2>
          {report.costChanges.length ? (
            <ul className="admin-line-list">
              {report.costChanges.map((change, index) => (
                <li key={`${change.name}-${index}`} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{change.name}</strong>
                  </span>
                  <span className="admin-line-side">
                    <span>
                      <Money agorot={change.previousCostAgorot ?? 0} /> ←{" "}
                      <Money agorot={change.newCostAgorot} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">لم تتغيّر تكاليف الشراء.</p>
          )}
        </section>
      </div>
    </main>
  );
}
