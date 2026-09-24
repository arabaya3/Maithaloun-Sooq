import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { adminOrderService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { AdminStatusBadge } from "@/features/admin/ui/admin-status-badge";
import { OrderStatusForm } from "@/features/admin/ui/order-status-form";
import { orderStatusLabels } from "@/features/orders/domain/order-status";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "تفاصيل الطلب",
};

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const order = await adminOrderService.getByPublicReference(
    actor,
    (await params).id,
  );
  if (!order) notFound();

  const isFreeDelivery = order.deliveryFeeAgorot === 0;

  return (
    <main className="admin-page admin-order-detail">
      <p className="admin-breadcrumb">
        <Link href="/admin/orders" prefetch={false}>
          الطلبات
        </Link>
        <span aria-hidden="true"> / </span>
        <bdi dir="ltr">{order.publicReference}</bdi>
      </p>

      <header className="admin-order-detail-header">
        <div>
          <h1>
            طلب <bdi dir="ltr">{order.publicReference}</bdi>
          </h1>
          <p className="admin-muted">
            {formatAdminDateTime(order.createdAt)} · نقداً عند الاستلام
          </p>
        </div>
        <div className="admin-order-detail-header-actions">
          <AdminStatusBadge status={order.status} />
          {order.whatsappContactUrl ? (
            <a
              className="admin-whatsapp-button"
              href={order.whatsappContactUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              تواصل عبر واتساب
            </a>
          ) : null}
        </div>
      </header>

      <div className="admin-detail-grid">
        <section className="admin-panel" aria-labelledby="customer-title">
          <h2 id="customer-title">الزبون</h2>
          <dl className="admin-definition-list">
            <div>
              <dt>الاسم الكامل</dt>
              <dd>{order.customerName}</dd>
            </div>
            <div>
              <dt>رقم الواتساب</dt>
              <dd>
                {order.whatsappPhoneE164 ? (
                  <bdi dir="ltr">{order.phone}</bdi>
                ) : (
                  <span>غير متوفر لهذا الطلب</span>
                )}
              </dd>
            </div>
          </dl>
          {!order.whatsappContactUrl ? (
            <p className="admin-muted">لا يتوفر رابط واتساب لهذا الطلب.</p>
          ) : null}
        </section>

        <section className="admin-panel" aria-labelledby="delivery-title">
          <h2 id="delivery-title">التوصيل</h2>
          <dl className="admin-definition-list">
            <div>
              <dt>العنوان</dt>
              <dd>{order.address}</dd>
            </div>
            {order.landmark ? (
              <div>
                <dt>أقرب معلم (قديم)</dt>
                <dd>{order.landmark}</dd>
              </div>
            ) : null}
            <div>
              <dt>المنطقة</dt>
              <dd>{order.serviceAreaName}</dd>
            </div>
            <div>
              <dt>ملاحظة الزبون</dt>
              <dd>{order.customerNote ?? "لا توجد ملاحظة"}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="admin-panel" aria-labelledby="order-items-title">
        <h2 id="order-items-title">المنتجات</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>الخيار</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>المجموع</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={`${item.productId}-${item.variantLabel ?? "default"}`}>
                  <td>{item.productName}</td>
                  <td>{item.variantLabel ?? "—"}</td>
                  <td>{item.quantity}</td>
                  <td>{formatIls(item.unitPriceAgorot)}</td>
                  <td>{formatIls(item.lineSubtotalAgorot)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel" aria-labelledby="totals-title">
        <h2 id="totals-title">ملخص السعر</h2>
        <dl className="admin-definition-list admin-totals">
          <div>
            <dt>مجموع المنتجات</dt>
            <dd>{formatIls(order.itemsSubtotalAgorot)}</dd>
          </div>
          <div>
            <dt>تكلفة التوصيل</dt>
            <dd>
              {order.deliveryFeeAgorot === null
                ? "غير معروفة"
                : isFreeDelivery
                  ? "مجاني"
                  : formatIls(order.deliveryFeeAgorot)}
            </dd>
          </div>
          <div>
            <dt>الإجمالي النهائي</dt>
            <dd>
              {order.finalTotalAgorot === null
                ? "غير معروف حتى تحديد تكلفة التوصيل"
                : formatIls(order.finalTotalAgorot)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="admin-panel admin-actions-panel"
        aria-labelledby="status-actions-title"
      >
        <h2 id="status-actions-title">الإجراءات المتاحة</h2>
        <OrderStatusForm
          publicReference={order.publicReference}
          status={order.status}
          version={order.version}
        />
      </section>

      <section className="admin-panel" aria-labelledby="order-history-title">
        <h2 id="order-history-title">سجل الحالات</h2>
        {order.history.length === 0 ? (
          <p className="admin-muted">لا يوجد تغيير حالة بعد.</p>
        ) : (
          <ol className="admin-history">
            {order.history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`}>
                <span>
                  {orderStatusLabels[entry.previousStatus]} →{" "}
                  {orderStatusLabels[entry.newStatus]}
                </span>
                <span>{entry.actorName}</span>
                <span>{formatAdminDateTime(entry.createdAt)}</span>
                {entry.reason ? <span>{entry.reason}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
