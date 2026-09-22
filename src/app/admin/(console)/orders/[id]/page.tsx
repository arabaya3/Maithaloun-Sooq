import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { adminOrderService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
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

  return (
    <main className="admin-page">
      <p>
        <Link href="/admin/orders" prefetch={false}>
          العودة إلى الطلبات
        </Link>
      </p>
      <h1>طلب {order.publicReference}</h1>
      <dl className="admin-definition-list">
        <div>
          <dt>الحالة</dt>
          <dd>{orderStatusLabels[order.status]}</dd>
        </div>
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
        <div>
          <dt>العنوان بالتفصيل أو أقرب نقطة دالة</dt>
          <dd>{order.address}</dd>
        </div>
        {order.landmark ? (
          <div>
            <dt>أقرب معلم (قديم)</dt>
            <dd>{order.landmark}</dd>
          </div>
        ) : null}
        <div>
          <dt>ملاحظة الزبون</dt>
          <dd>{order.customerNote ?? "لا توجد ملاحظة"}</dd>
        </div>
        <div>
          <dt>منطقة التوصيل</dt>
          <dd>
            {order.serviceAreaName} ({order.serviceAreaCode})
          </dd>
        </div>
        <div>
          <dt>طريقة الدفع</dt>
          <dd>نقداً عند الاستلام</dd>
        </div>
        <div>
          <dt>تاريخ الإنشاء</dt>
          <dd>{formatAdminDateTime(order.createdAt)}</dd>
        </div>
      </dl>
      {order.whatsappContactUrl ? (
        <p className="admin-whatsapp-action">
          <a
            className="admin-whatsapp-button"
            href={order.whatsappContactUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            تواصل عبر واتساب
          </a>
        </p>
      ) : (
        <p className="admin-muted">لا يتوفر رابط واتساب لهذا الطلب.</p>
      )}
      <section aria-labelledby="order-items-title">
        <h2 id="order-items-title">المنتجات</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>المجموع</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.productId}>
                  <td>{item.productName}</td>
                  <td>{item.quantity}</td>
                  <td>{formatIls(item.unitPriceAgorot)}</td>
                  <td>{formatIls(item.lineSubtotalAgorot)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <dl className="admin-definition-list">
        <div>
          <dt>مجموع المنتجات</dt>
          <dd>{formatIls(order.itemsSubtotalAgorot)}</dd>
        </div>
        <div>
          <dt>تكلفة التوصيل</dt>
          <dd>
            {order.deliveryFeeAgorot === null
              ? "غير معروفة"
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
      <OrderStatusForm
        publicReference={order.publicReference}
        status={order.status}
        version={order.version}
      />
      <section aria-labelledby="order-history-title">
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
