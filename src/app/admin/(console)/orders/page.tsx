import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { connection } from "next/server";

import { adminOrderService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import {
  AdminNextActionLabel,
  AdminStatusBadge,
  formatAdminRelativeTime,
  shortenOrderReference,
} from "@/features/admin/ui/admin-status-badge";
import {
  getPrimaryNextActionLabel,
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

  const totalAll = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
  const hasFilters = Boolean(
    statusFilter ||
    params.from ||
    params.to ||
    query ||
    params.sort === "oldest",
  );
  const pageCount = Math.max(1, Math.ceil(result.total / 20));

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>الطلبات</h1>
          <p className="admin-lede">
            {result.total} نتيجة
            {statusFilter
              ? ` · ${orderStatusLabels[statusFilter]}`
              : ` · ${totalAll} إجمالي`}
          </p>
        </div>
      </header>

      <nav className="admin-status-tabs" aria-label="تصفية الحالة">
        <Link
          href="/admin/orders"
          className={!statusFilter ? "is-active" : undefined}
          aria-current={!statusFilter ? "page" : undefined}
          prefetch={false}
        >
          الكل
          <span className="admin-tab-count">{totalAll}</span>
        </Link>
        {orderStatuses.map((status) => (
          <Link
            key={status}
            href={`/admin/orders?status=${status}`}
            className={statusFilter === status ? "is-active" : undefined}
            aria-current={statusFilter === status ? "page" : undefined}
            prefetch={false}
          >
            {orderStatusLabels[status]}
            <span className="admin-tab-count">{statusCounts[status]}</span>
          </Link>
        ))}
      </nav>

      <form className="admin-toolbar" method="get">
        {statusFilter ? (
          <input type="hidden" name="status" value={statusFilter} />
        ) : null}
        <div className="admin-toolbar-search">
          <label className="sr-only" htmlFor="order-search">
            بحث
          </label>
          <input
            id="order-search"
            name="q"
            defaultValue={query}
            dir="auto"
            placeholder="ابحث برقم الطلب أو اسم الزبون أو رقم الواتساب"
          />
        </div>
        <label className="admin-toolbar-field" htmlFor="order-from">
          <span>من</span>
          <input
            id="order-from"
            name="from"
            type="date"
            defaultValue={params.from ?? ""}
          />
        </label>
        <label className="admin-toolbar-field" htmlFor="order-to">
          <span>إلى</span>
          <input
            id="order-to"
            name="to"
            type="date"
            defaultValue={params.to ?? ""}
          />
        </label>
        <label className="admin-toolbar-field" htmlFor="order-sort">
          <span>ترتيب</span>
          <select id="order-sort" name="sort" defaultValue={sort}>
            <option value="newest">الأحدث</option>
            <option value="oldest">الأقدم</option>
          </select>
        </label>
        <div className="admin-toolbar-actions">
          <button type="submit" className="admin-btn admin-btn-secondary">
            تطبيق
          </button>
          {hasFilters ? (
            <Link
              href="/admin/orders"
              className="admin-btn admin-btn-ghost"
              prefetch={false}
            >
              مسح
            </Link>
          ) : null}
        </div>
      </form>

      {hasFilters ? (
        <ul className="admin-filter-tokens" aria-label="الفلاتر النشطة">
          {query ? <li>بحث: {query}</li> : null}
          {params.from ? <li>من {params.from}</li> : null}
          {params.to ? <li>إلى {params.to}</li> : null}
          {params.sort === "oldest" ? <li>الأقدم أولاً</li> : null}
        </ul>
      ) : null}

      {result.items.length === 0 ? (
        <div className="admin-empty">
          <p>لا توجد طلبات مطابقة للفلاتر الحالية.</p>
          {hasFilters ? (
            <Link href="/admin/orders" prefetch={false}>
              مسح التصفية
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div className="admin-table-wrap admin-table-desktop">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>الزبون</th>
                  <th>التواصل</th>
                  <th>الإجمالي</th>
                  <th>الحالة</th>
                  <th>وقت الطلب</th>
                  <th>الإجراء التالي</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((order) => {
                  const actionLabel = getPrimaryNextActionLabel(order.status);
                  return (
                    <tr key={order.publicReference}>
                      <td>
                        <Link
                          href={`/admin/orders/${order.publicReference}`}
                          prefetch={false}
                          title={order.publicReference}
                        >
                          <bdi dir="ltr">
                            {shortenOrderReference(order.publicReference)}
                          </bdi>
                        </Link>
                      </td>
                      <td>{order.customerName}</td>
                      <td>
                        {order.whatsappContactUrl ? (
                          <a
                            className="admin-icon-link"
                            href={order.whatsappContactUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`واتساب لطلب ${order.publicReference}`}
                          >
                            <MessageCircle size={18} aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="admin-muted">—</span>
                        )}
                      </td>
                      <td className="admin-num">
                        {order.finalTotalAgorot === null
                          ? order.status === "cancelled"
                            ? "ملغي"
                            : "غير مكتمل"
                          : formatIls(order.finalTotalAgorot)}
                      </td>
                      <td>
                        <AdminStatusBadge status={order.status} />
                      </td>
                      <td>
                        <time dateTime={order.createdAt}>
                          {formatAdminRelativeTime(order.createdAt)}
                        </time>
                        <div className="admin-muted admin-tiny">
                          {formatAdminDateTime(order.createdAt)}
                        </div>
                      </td>
                      <td>
                        {actionLabel ? (
                          <Link
                            className="admin-btn admin-btn-primary admin-btn-sm"
                            href={`/admin/orders/${order.publicReference}`}
                            prefetch={false}
                          >
                            {actionLabel}
                          </Link>
                        ) : (
                          <span className="admin-muted admin-next-idle">
                            مكتمل
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="admin-order-cards">
            {result.items.map((order) => {
              const actionLabel = getPrimaryNextActionLabel(order.status);
              return (
                <li key={order.publicReference}>
                  <article className="admin-order-card">
                    <div className="admin-order-card-top">
                      <Link
                        href={`/admin/orders/${order.publicReference}`}
                        prefetch={false}
                        title={order.publicReference}
                      >
                        <bdi dir="ltr">
                          {shortenOrderReference(order.publicReference)}
                        </bdi>
                      </Link>
                      <AdminStatusBadge status={order.status} />
                    </div>
                    <p className="admin-order-card-customer">
                      {order.customerName}
                    </p>
                    <div className="admin-order-card-bottom">
                      <time dateTime={order.createdAt}>
                        {formatAdminDateTime(order.createdAt)}
                      </time>
                      <strong className="admin-num">
                        {order.finalTotalAgorot === null
                          ? "—"
                          : formatIls(order.finalTotalAgorot)}
                      </strong>
                    </div>
                    <div className="admin-order-card-actions">
                      {order.whatsappContactUrl ? (
                        <a
                          className="admin-btn admin-btn-secondary admin-btn-sm"
                          href={order.whatsappContactUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MessageCircle size={16} aria-hidden="true" />
                          واتساب
                        </a>
                      ) : null}
                      {actionLabel ? (
                        <Link
                          className="admin-btn admin-btn-primary admin-btn-sm"
                          href={`/admin/orders/${order.publicReference}`}
                          prefetch={false}
                        >
                          {actionLabel}
                        </Link>
                      ) : (
                        <AdminNextActionLabel status={order.status} />
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {result.total > 20 ? (
        <nav className="admin-pagination" aria-label="صفحات الطلبات">
          {result.page > 1 ? (
            <Link
              href={buildPageHref(params, result.page - 1)}
              prefetch={false}
              className="admin-btn admin-btn-ghost admin-btn-sm"
            >
              السابق
            </Link>
          ) : (
            <span />
          )}
          <span>
            صفحة {result.page} من {pageCount}
          </span>
          {result.page * 20 < result.total ? (
            <Link
              href={buildPageHref(params, result.page + 1)}
              prefetch={false}
              className="admin-btn admin-btn-ghost admin-btn-sm"
            >
              التالي
            </Link>
          ) : (
            <span />
          )}
        </nav>
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
