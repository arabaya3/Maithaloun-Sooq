import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Package,
  Truck,
  CircleCheck,
  MessageCircle,
  MapPin,
} from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { adminOrderService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { AdminStatusBadge } from "@/features/admin/ui/admin-status-badge";
import { OrderItemStockNote } from "@/features/admin/ui/order-item-stock-note";
import { AdminDisclosure } from "@/features/admin/ui/admin-disclosure";
import { OrderStatusForm } from "@/features/admin/ui/order-status-form";
import { sellingLineText } from "@/features/catalog/domain/selling-unit";
import {
  getAllowedTransitions,
  orderStatusLabels,
} from "@/features/orders/domain/order-status";
import { statusImpact } from "@/features/orders/domain/status-impact";
import { formatIls } from "@/shared/lib/format-currency";
import styles from "./order-detail.module.css";

export const metadata: Metadata = { title: "تفاصيل الطلب" };

const stages = [
  { status: "pending", label: "جديد", Icon: ClipboardCheck },
  { status: "confirmed", label: "تأكيد", Icon: Check },
  { status: "preparing", label: "تجهيز", Icon: Package },
  { status: "out_for_delivery", label: "توصيل", Icon: Truck },
  { status: "delivered", label: "تسليم", Icon: CircleCheck },
] as const;

export default async function AdminOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ qa?: string | string[] }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  const order = await adminOrderService.getByPublicReference(
    actor,
    (await params).id,
  );
  if (!order) notFound();
  const currentStage =
    order.status === "awaiting_whatsapp"
      ? 0
      : stages.findIndex((stage) => stage.status === order.status);
  const reached = new Set([
    "pending",
    ...order.history.map((entry) => entry.newStatus),
    order.status,
  ]);
  const qaCreated = (await searchParams).qa === "created";

  return (
    <main className={`admin-page admin-order-detail ${styles.page}`}>
      <header className={styles.header}>
        <Link
          href="/admin/orders"
          prefetch={false}
          className="admin-icon-link"
          aria-label="العودة إلى الطلبات"
        >
          <ArrowRight size={21} />
        </Link>
        <div>
          <h1>طلب {order.customerName}</h1>
          <p className="admin-muted">{formatAdminDateTime(order.createdAt)}</p>
        </div>
        <AdminStatusBadge status={order.status} />
      </header>

      {order.isTest ? (
        <p className="admin-note" role="status" data-testid="qa-order-banner">
          {qaCreated ? "تم إنشاء طلب الاختبار. " : ""}طلب اختبار داخلي، لا يحجز
          مخزوناً ولا يدخل التقارير أو التوصيل.
        </p>
      ) : null}

      <section aria-label="متابعة الطلب" className={styles.tracking}>
        <ol className={styles.progress} aria-label="مراحل الطلب">
          {stages.map(({ status, label, Icon }, index) => {
            const current = index === currentStage;
            const done =
              order.status === "cancelled"
                ? reached.has(status)
                : index < currentStage;
            return (
              <li
                key={status}
                data-done={done || undefined}
                aria-current={current ? "step" : undefined}
              >
                <span className={styles.dot}>
                  {done ? <Check size={17} /> : <Icon size={17} />}
                </span>
                <span>{label}</span>
              </li>
            );
          })}
        </ol>
        {order.status === "cancelled" ||
        order.status === "awaiting_whatsapp" ? (
          <p className="admin-muted">{orderStatusLabels[order.status]}</p>
        ) : null}
        <OrderStatusForm
          publicReference={order.publicReference}
          status={order.status}
          version={order.version}
          cancelOnly={order.isTest}
          totalAgorot={order.finalTotalAgorot}
          impacts={Object.fromEntries(
            getAllowedTransitions(order.status).map((next) => [
              next,
              statusImpact(
                next,
                order.items.map((item) => ({
                  name: item.variantLabel
                    ? `${item.productName} — ${item.variantLabel}`
                    : item.productName,
                  pieces: item.baseUnits,
                  tracked: item.stock.tracked,
                  reservation: item.stock.reservation,
                  availableMilli: item.stock.availableMilli,
                })),
                order.finalTotalAgorot,
              ),
            ]),
          )}
        />
      </section>

      <section className={styles.customer} aria-label="الزبون والتوصيل">
        <div>
          <strong>{order.customerName}</strong>
          <p>
            <MapPin size={15} aria-hidden="true" />
            {order.serviceAreaName} ·{" "}
            {order.address ?? "العنوان يُحدّد عبر واتساب"}
          </p>
          {order.customerNote ? (
            <p className="admin-note">{order.customerNote}</p>
          ) : null}
        </div>
        {order.whatsappContactUrl ? (
          <a
            className={styles.whatsapp}
            href={order.whatsappContactUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`التواصل مع ${order.customerName} عبر واتساب`}
          >
            <MessageCircle size={23} />
          </a>
        ) : null}
      </section>

      <AdminDisclosure title={`المنتجات (${order.items.length})`}>
        <div className="admin-fold-body">
          <ul className={styles.items}>
            {order.items.map((item) => (
              <li
                key={`${item.productId}-${item.variantLabel ?? "default"}-${item.sellingUnitLabel ?? "single"}`}
              >
                <div>
                  <strong>{item.productName}</strong>
                  <p className="admin-muted">
                    {item.variantLabel ?? "حبة واحدة"} ·{" "}
                    {item.sellingUnitLabel
                      ? sellingLineText(item.sellingUnitLabel, item.quantity)
                      : `العدد ${item.quantity}`}
                  </p>
                  <OrderItemStockNote
                    stock={item.stock}
                    baseUnits={item.baseUnits}
                  />
                  {item.unitsPerSale > 1 ? (
                    <p className="admin-muted">إجمالي القطع {item.baseUnits}</p>
                  ) : null}
                </div>
                <div className={styles.itemPrice}>
                  <strong>{formatIls(item.lineSubtotalAgorot)}</strong>
                  <small className="admin-muted">
                    الوحدة {formatIls(item.unitPriceAgorot)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </AdminDisclosure>

      <AdminDisclosure title={"تفاصيل الدفع"}>
        <dl className={`admin-fold-body ${styles.totals}`}>
          <div>
            <dt>طريقة الدفع</dt>
            <dd>نقداً عند الاستلام</dd>
          </div>
          <div>
            <dt>مجموع المنتجات</dt>
            <dd>{formatIls(order.itemsSubtotalAgorot)}</dd>
          </div>
          <div>
            <dt>التوصيل</dt>
            <dd>
              {order.deliveryFeeAgorot === null
                ? "غير معروف"
                : order.deliveryFeeAgorot === 0
                  ? "مجاني"
                  : formatIls(order.deliveryFeeAgorot)}
            </dd>
          </div>
          <div>
            <dt>الإجمالي</dt>
            <dd>
              {order.finalTotalAgorot === null
                ? "غير معروف"
                : formatIls(order.finalTotalAgorot)}
            </dd>
          </div>
        </dl>
      </AdminDisclosure>

      <AdminDisclosure title={`سجل الطلب (${order.history.length})`}>
        <div className="admin-fold-body">
          {order.history.length ? (
            <ol className="admin-timeline">
              {order.history.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`}>
                  <span className="admin-timeline-dot" aria-hidden="true" />
                  <div>
                    <strong>{orderStatusLabels[entry.newStatus]}</strong>
                    <p className="admin-muted">
                      {entry.actorName} · {formatAdminDateTime(entry.createdAt)}
                    </p>
                    {entry.reason ? <p>{entry.reason}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="admin-muted">لم تتغير حالة الطلب بعد.</p>
          )}
        </div>
      </AdminDisclosure>

      <AdminDisclosure title={"بيانات التواصل ومرجع الطلب"}>
        <dl className={`admin-fold-body ${styles.totals}`}>
          <div>
            <dt>رقم الواتساب</dt>
            <dd>
              {order.whatsappPhoneE164 ? (
                <bdi dir="ltr">{order.phone}</bdi>
              ) : (
                "غير متوفر"
              )}
            </dd>
          </div>
          {order.landmark ? (
            <div>
              <dt>أقرب معلم</dt>
              <dd>{order.landmark}</dd>
            </div>
          ) : null}
          <div>
            <dt>المرجع</dt>
            <dd>
              <bdi dir="ltr">{order.publicReference}</bdi>
            </dd>
          </div>
        </dl>
      </AdminDisclosure>
    </main>
  );
}
