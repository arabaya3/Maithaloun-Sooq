import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { adminOrderService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  isOrderStatus,
  orderStatusLabels,
  orderStatuses,
} from "@/features/orders/domain/order-status";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "الطلبات",
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: string;
  }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const publicReference = query.startsWith("MS-") ? query : undefined;
  const phone = query && !publicReference ? query : undefined;
  const result = await adminOrderService.list(actor, {
    status:
      params.status && isOrderStatus(params.status) ? params.status : undefined,
    createdFrom: parseDayStart(params.from),
    createdTo: parseDayEnd(params.to),
    publicReference,
    phone,
    page: Number(params.page ?? "1"),
  });

  return (
    <main className="admin-page">
      <h1>الطلبات</h1>
      <form className="admin-filters" method="get">
        <label htmlFor="order-status-filter">الحالة</label>
        <select
          id="order-status-filter"
          name="status"
          defaultValue={params.status ?? ""}
        >
          <option value="">كل الحالات</option>
          {orderStatuses.map((status) => (
            <option key={status} value={status}>
              {orderStatusLabels[status]}
            </option>
          ))}
        </select>
        <label htmlFor="order-from">من تاريخ</label>
        <input
          id="order-from"
          name="from"
          type="date"
          defaultValue={params.from ?? ""}
        />
        <label htmlFor="order-to">إلى تاريخ</label>
        <input
          id="order-to"
          name="to"
          type="date"
          defaultValue={params.to ?? ""}
        />
        <label htmlFor="order-search">رقم الطلب أو الهاتف</label>
        <input id="order-search" name="q" defaultValue={query} dir="ltr" />
        <button type="submit">تصفية</button>
      </form>
      {result.items.length === 0 ? (
        <p className="admin-empty">لا توجد طلبات مطابقة.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>الحالة</th>
                <th>التاريخ</th>
                <th>المجموع</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((order) => (
                <tr key={order.publicReference}>
                  <td>
                    <Link
                      href={`/admin/orders/${order.publicReference}`}
                      prefetch={false}
                    >
                      <bdi dir="ltr">{order.publicReference}</bdi>
                    </Link>
                  </td>
                  <td>{orderStatusLabels[order.status]}</td>
                  <td>{formatAdminDateTime(order.createdAt)}</td>
                  <td>
                    {order.finalTotalAgorot === null
                      ? "غير معروف"
                      : formatIls(order.finalTotalAgorot)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.total > 20 ? (
        <p className="admin-pagination">
          {result.page > 1 ? (
            <Link
              href={buildPageHref(params, result.page - 1)}
              prefetch={false}
            >
              السابق
            </Link>
          ) : null}
          <span>
            صفحة {result.page} من {Math.ceil(result.total / 20)}
          </span>
          {result.page * 20 < result.total ? (
            <Link
              href={buildPageHref(params, result.page + 1)}
              prefetch={false}
            >
              التالي
            </Link>
          ) : null}
        </p>
      ) : null}
    </main>
  );
}

function parseDayStart(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

function parseDayEnd(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T23:59:59.999Z`);
}

function buildPageHref(
  params: {
    status?: string;
    from?: string;
    to?: string;
    q?: string;
  },
  page: number,
): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.q) search.set("q", params.q);
  search.set("page", String(page));
  return `/admin/orders?${search.toString()}`;
}
