import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import {
  adminCatalogService,
  adminOrderService,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { AdminStatusBadge } from "@/features/admin/ui/admin-status-badge";
import { PageHeader } from "@/features/admin/ui/kit";
import { QaOrderForm } from "@/features/admin/ui/qa-order-form";
import { getProductDisplayName } from "@/features/catalog/domain/product";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = { title: "طلبات الاختبار" };

export default async function QaOrdersPage() {
  await connection();
  const actor = await requireAdminSession();
  const header = (
    <PageHeader
      title="طلبات الاختبار"
      back={{ href: "/admin/orders", label: "الطلبات" }}
    />
  );
  if (actor.role !== "owner") {
    return (
      <main className="admin-page admin-page--narrow">
        {header}
        <p className="admin-note" role="note">
          طلبات الاختبار للمالك فقط.
        </p>
      </main>
    );
  }
  const [products, existing] = await Promise.all([
    adminCatalogService.list(actor),
    adminOrderService.list(actor, { page: 1, test: true }),
  ]);
  const options = products
    .filter(
      (product) =>
        product.publication === "published" &&
        product.availability === "available",
    )
    .flatMap((product) =>
      product.variants
        .filter((variant) => variant.availability === "available")
        .map((variant) => ({
          value: `${product.id}|${variant.id}`,
          label: `${getProductDisplayName(product)} — ${variant.labelAr}`,
        })),
    );

  return (
    <main className="admin-page admin-page--narrow">
      {header}
      <p className="admin-note" role="note">
        طلب الاختبار يمر بنفس تسعير المتجر والعروض، لكنه لا يحتاج رقم هاتف، ولا
        يرسل أي إشعار، ولا يظهر في قائمة الطلبات أو التوصيل أو الرئيسية، ولا
        يدخل في التقارير، ولا يحجز المخزون. يمكن إلغاؤه فقط.
      </p>
      {options.length ? (
        <QaOrderForm options={options} />
      ) : (
        <p className="admin-muted">لا توجد أصناف منشورة ومتوفرة للاختبار.</p>
      )}
      <h2>طلبات الاختبار السابقة ({existing.total})</h2>
      {existing.items.length ? (
        <ul className="admin-supplier-list" aria-label="طلبات الاختبار">
          {existing.items.map((order) => (
            <li key={order.publicReference} className="admin-panel">
              <Link
                href={`/admin/orders/${order.publicReference}`}
                prefetch={false}
              >
                <bdi dir="ltr">{order.publicReference}</bdi>
              </Link>{" "}
              <AdminStatusBadge status={order.status} />{" "}
              <small className="admin-muted">
                {formatAdminDateTime(order.createdAt)} ·{" "}
                {formatIls(order.finalTotalAgorot ?? order.itemsSubtotalAgorot)}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-muted">لا توجد طلبات اختبار بعد.</p>
      )}
    </main>
  );
}
