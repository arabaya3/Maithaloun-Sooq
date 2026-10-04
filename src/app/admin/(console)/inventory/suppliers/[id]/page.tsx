import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  supplierMaintenanceService,
  supplierService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { Money, PageHeader } from "@/features/admin/ui/kit";
import { SupplierPaymentForm } from "@/features/purchasing/ui/supplier-forms";
import {
  SupplierArchiveForm,
  SupplierCreditNoteForm,
  SupplierEditForm,
} from "@/features/purchasing/ui/supplier-management-forms";
import { addDays, todayInStoreZone } from "@/shared/lib/store-time";

export const metadata: Metadata = { title: "المورد" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const statement = showBalances
    ? await supplierMaintenanceService.statement(supplier.id, from, to)
    : null;

  return (
    <main className="admin-page admin-page--narrow">
      <PageHeader
        title={supplier.nameAr}
        back={{ href: "/admin/inventory/suppliers", label: "الموردون" }}
      />
      {!supplier.active ? (
        <p className="admin-note" role="note">
          هذا المورد مؤرشف ولا يظهر في اختيار الموردين.
        </p>
      ) : null}

      <section className="admin-panel" aria-labelledby="supplier-edit-title">
        <h2 id="supplier-edit-title">بيانات المورد</h2>
        <SupplierEditForm supplier={supplier} />
        {canArchive ? (
          <SupplierArchiveForm
            supplierId={supplier.id}
            active={supplier.active}
          />
        ) : null}
      </section>

      {statement ? (
        <>
          <section
            className="admin-panel"
            aria-labelledby="supplier-balance-title"
          >
            <h2 id="supplier-balance-title">
              المستحق للمورد: <Money agorot={supplier.balanceAgorot ?? 0} />
            </h2>
            {(supplier.balanceAgorot ?? 0) > 0 ? (
              <>
                <SupplierPaymentForm supplierId={supplier.id} />
                <SupplierCreditNoteForm supplierId={supplier.id} />
              </>
            ) : null}
          </section>

          <section
            className="admin-panel"
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
    </main>
  );
}
