import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { adminOrderService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  AdminNextActionLabel,
  AdminStatusBadge,
} from "@/features/admin/ui/admin-status-badge";
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
    sort?: string;
    page?: string;
  }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const publicReference = query.startsWith("MS-") ? query : undefined;
  const phoneLike =
    query && !publicReference && /[\d+]/.test(query) ? query : undefined;
  const customerName =
    query && !publicReference && !phoneLike ? query : undefined;
  const statusFilter =
    params.status && isOrderStatus(params.status) ? params.status : undefined;
  const sort = params.sort === "oldest" ? "oldest" : "newest";
  const [result, statusCounts] = await Promise.all([
    adminOrderService.list(actor, {
      status: statusFilter,
      createdFrom: parseDayStart(params.from),
      createdTo: parseDayEnd(params.to),
      publicReference,
      phone: phoneLike,
      customerName,
      sort,
      page: Number(params.page ?? "1"),
    }),
    adminOrderService.countByStatus(actor),
  ]);

  const hasFilters = Boolean(
    statusFilter ||
    params.from ||
    params.to ||
    query ||
    params.sort === "oldest",
  );

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>الطلبات</h1>
          <p className="admin-lede">ابحث، صفِّ، وحدّث حالات الطلبات بسرعة.</p>
        </div>
      </header>

      <div
        className="admin-status-chips"
        role="navigation"
        aria-label="تصفية الحالة"
      >
        <Link
          href="/admin/orders"
          className={!statusFilter ? "is-active" : undefined}
          prefetch={false}
        >
          الكل
        </Link>
        {orderStatuses.map((status) => (
          <Link
            key={status}
            href={`/admin/orders?status=${status}`}
            className={statusFilter === status ? "is-active" : undefined}
            prefetch={false}
          >
            {orderStatusLabels[status]}
            <span className="admin-chip-count">{statusCounts[status]}</span>
          </Link>
        ))}
      </div>

      <form className="admin-filters" method="get">
        {statusFilter ? (
          <input type="hidden" name="status" value={statusFilter} />
        ) : null}
        <label htmlFor="order-search">رقم الطلب أو الاسم أو الواتساب</label>
        <input
          id="order-search"
          name="q"
          defaultValue={query}
          dir="auto"
          placeholder="MS-… أو اسم أو رقم"
        />
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
        <label htmlFor="order-sort">الترتيب</label>
        <select id="order-sort" name="sort" defaultValue={sort}>
          <option value="newest">الأحدث أولاً</option>
          <option value="oldest">الأقدم أولاً</option>
        </select>
        <div className="admin-filter-actions">
          <button type="submit">تطبيق</button>
          {hasFilters ? (
            <Link href="/admin/orders" prefetch={false}>
              مسح التصفية
            </Link>
          ) : null}
        </div>
      </form>

      {result.items.length === 0 ? (
        <p className="admin-empty">لا توجد طلبات مطابقة.</p>
      ) : (
        <>
          <div className="admin-table-wrap admin-table-desktop">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>الزبون</th>
                  <th>الحالة</th>
                  <th>الإجمالي</th>
                  <th>الإجراء التالي</th>
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
                      <div className="admin-muted">
                        {formatAdminDateTime(order.createdAt)}
                      </div>
                    </td>
                    <td>{order.customerName}</td>
                    <td>
                      <AdminStatusBadge status={order.status} />
                    </td>
                    <td>
                      {order.finalTotalAgorot === null
                        ? "غير معروف"
                        : formatIls(order.finalTotalAgorot)}
                    </td>
                    <td>
                      <AdminNextActionLabel status={order.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="admin-order-cards">
            {result.items.map((order) => (
              <li key={order.publicReference}>
                <Link
                  href={`/admin/orders/${order.publicReference}`}
                  prefetch={false}
                  className="admin-order-card"
                >
                  <div className="admin-order-card-top">
                    <bdi dir="ltr">{order.publicReference}</bdi>
                    <AdminStatusBadge status={order.status} />
                  </div>
                  <p>{order.customerName}</p>
                  <div className="admin-order-card-bottom">
                    <time dateTime={order.createdAt}>
                      {formatAdminDateTime(order.createdAt)}
                    </time>
                    <strong>
                      {order.finalTotalAgorot === null
                        ? "—"
                        : formatIls(order.finalTotalAgorot)}
                    </strong>
                  </div>
                  <p className="admin-order-row-action">
                    <AdminNextActionLabel status={order.status} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
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
    sort?: string;
  },
  page: number,
): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.q) search.set("q", params.q);
  if (params.sort === "oldest") search.set("sort", "oldest");
  search.set("page", String(page));
  return `/admin/orders?${search.toString()}`;
}
