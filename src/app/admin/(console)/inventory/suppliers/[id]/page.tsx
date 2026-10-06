import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  supplierMaintenanceService,
  supplierService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { Money, PageHeader, StickyAction } from "@/features/admin/ui/kit";
import { WorkspaceNav } from "@/features/admin/ui/workspace-nav";
import { SupplierPaymentForm } from "@/features/purchasing/ui/supplier-forms";
import {
  SupplierArchiveForm,
  SupplierCreditNoteForm,
  SupplierEditForm,
} from "@/features/purchasing/ui/supplier-management-forms";
import { addDays, todayInStoreZone } from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "المورد" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LABEL = "الافتراضي";

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const { id } = await params;
  const supplier = (await supplierService.list(actor)).find(
    (row) => row.id === id,
  );
  if (!supplier) notFound();
  const showBalances = can(actor, "suppliers.balances");
  const canArchive = can(actor, "settings.manage");
  const query = await searchParams;
  const to = query.to && DATE.test(query.to) ? query.to : todayInStoreZone();
  const from =
    query.from && DATE.test(query.from) && query.from <= to
      ? query.from
      : addDays(to, -89);
  const [statement, invoices, aliases] = await Promise.all([
    showBalances
      ? supplierMaintenanceService.statement(supplier.id, from, to)
      : null,
    supplierMaintenanceService.purchaseHistory(supplier.id),
    supplierMaintenanceService.aliases(supplier.id),
  ]);
  const owed = (supplier.balanceAgorot ?? 0) > 0;
  const sections = [
    ...(statement
      ? [
          { id: "account", label: "الحساب" },
          { id: "statement", label: "كشف الحساب" },
        ]
      : []),
    { id: "invoices", label: "الفواتير" },
    { id: "aliases", label: "أسماء الأصناف" },
    { id: "profile", label: "البيانات" },
  ];

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title={supplier.nameAr}
        lede={
          supplier.spendAgorot === null ? (
            `${supplier.invoiceCount} فاتورة شراء`
          ) : (
            <>
              {supplier.invoiceCount} فاتورة · مشتريات{" "}
              <Money agorot={supplier.spendAgorot} />
            </>
          )
        }
        back={{ href: "/admin/inventory/suppliers", label: "الموردون" }}
      />
      {!supplier.active ? (
        <p className="admin-note" role="note">
          هذا المورد مؤرشف ولا يظهر في اختيار الموردين.
        </p>
      ) : null}

      <WorkspaceNav label="أقسام ملف المورد" sections={sections} />

      {statement ? (
        <>
          <section
            id="account"
            className="admin-panel admin-workspace-anchor"
            aria-labelledby="supplier-balance-title"
          >
            <h2 id="supplier-balance-title">
              المستحق للمورد: <Money agorot={supplier.balanceAgorot ?? 0} />
            </h2>
            {owed ? (
              <div id="payment" className="admin-workspace-anchor">
                <SupplierPaymentForm supplierId={supplier.id} />
                <SupplierCreditNoteForm supplierId={supplier.id} />
              </div>
            ) : (
              <p className="admin-muted">لا مستحقات لهذا المورد الآن.</p>
            )}
          </section>

          <section
            id="statement"
            className="admin-panel admin-workspace-anchor"
            aria-labelledby="supplier-statement-title"
          >
            <h2 id="supplier-statement-title">كشف الحساب</h2>
            <form className="admin-form admin-inline-form" method="get">
              <label>
                من
                <input type="date" name="from" defaultValue={from} />
              </label>
              <label>
                إلى
                <input type="date" name="to" defaultValue={to} />
              </label>
              <button type="submit" className="admin-btn admin-btn-secondary">
                عرض
              </button>
            </form>
            <p>
              الرصيد الافتتاحي <Money agorot={statement.openingAgorot} /> ·
              الختامي <Money agorot={statement.closingAgorot} />
            </p>
            {statement.lines.length ? (
              <div className="admin-table-wrap">
                <table
                  className="admin-data-table"
                  aria-label="حركات حساب المورد"
                >
                  <thead>
                    <tr>
                      <th scope="col">التاريخ</th>
                      <th scope="col">الحركة</th>
                      <th scope="col">المبلغ</th>
                      <th scope="col">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.lines.map((line, index) => (
                      <tr key={`${line.date}-${index}`}>
                        <td>{formatAdminDateTime(line.date)}</td>
                        <td>
                          {line.label}
                          {line.note ? (
                            <small className="admin-muted">
                              {" "}
                              · {line.note}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <Money agorot={line.amountAgorot} />
                        </td>
                        <td>
                          <Money agorot={line.balanceAgorot} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="admin-muted">لا توجد حركات في هذه الفترة.</p>
            )}
            {statement.truncated ? (
              <p className="admin-muted">
                تظهر أول 200 حركة فقط؛ ضيّقي الفترة لرؤية الباقي.
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      <section
        id="invoices"
        className="admin-panel admin-workspace-anchor"
        aria-labelledby="supplier-invoices-title"
      >
        <h2 id="supplier-invoices-title">فواتير الشراء</h2>
        {invoices.length ? (
          <ul className="admin-line-list">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/admin/inventory/purchases/${invoice.id}`}
                  prefetch={false}
                  className="admin-line"
                >
                  <span className="admin-line-main">
                    <strong>
                      <bdi dir="ltr">{invoice.invoiceDate}</bdi>
                    </strong>
                    {invoice.reference ? (
                      <small>
                        رقم <bdi dir="ltr">{invoice.reference}</bdi>
                      </small>
                    ) : null}
                  </span>
                  {showBalances ? (
                    <span className="admin-line-side">
                      <Money agorot={invoice.totalAgorot} />
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">لا توجد فواتير شراء من هذا المورد بعد.</p>
        )}
      </section>

      <section
        id="aliases"
        className="admin-panel admin-workspace-anchor"
        aria-labelledby="supplier-aliases-title"
      >
        <h2 id="supplier-aliases-title">أسماء الأصناف عند المورد</h2>
        {aliases.length ? (
          <ul className="admin-line-list">
            {aliases.map((alias) => (
              <li key={alias.id}>
                <Link
                  href={`/admin/inventory/stock/${alias.variantId}`}
                  prefetch={false}
                  className="admin-line"
                >
                  <span className="admin-line-main">
                    <strong>{alias.aliasText}</strong>
                    <small>
                      يُقرأ كـ {alias.productName}
                      {alias.variantLabel === DEFAULT_LABEL
                        ? ""
                        : ` — ${alias.variantLabel}`}
                    </small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">
            يُحفظ الاسم هنا عندما تصحّحين ربطه بمنتج أثناء مراجعة فاتورة من هذا
            المورد، ليُقرأ صحيحاً في المرة القادمة.
          </p>
        )}
      </section>

      <section
        id="profile"
        className="admin-panel admin-workspace-anchor"
        aria-labelledby="supplier-edit-title"
      >
        <h2 id="supplier-edit-title">بيانات المورد</h2>
        <SupplierEditForm supplier={supplier} />
        {canArchive ? (
          <SupplierArchiveForm
            supplierId={supplier.id}
            active={supplier.active}
          />
        ) : null}
      </section>

      {statement && owed ? (
        <StickyAction>
          <a
            className="admin-btn admin-btn-primary admin-btn-block"
            href="#payment"
          >
            تسجيل دفعة للمورد
          </a>
        </StickyAction>
      ) : null}
    </main>
  );
}
