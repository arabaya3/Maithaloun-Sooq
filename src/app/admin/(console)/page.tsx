import type { Metadata } from "next";
import { connection } from "next/server";

import { adminDashboardService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import {
  orderStatusLabels,
  orderStatuses,
} from "@/features/orders/domain/order-status";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "لوحة المتابعة",
};

export default async function AdminDashboardPage() {
  await connection();
  const actor = await requireAdminSession();
  const summary = await adminDashboardService.getSummary(actor);

  return (
    <main className="admin-page">
      <h1>لوحة المتابعة</h1>
      <section aria-labelledby="orders-summary-title">
        <h2 id="orders-summary-title">الطلبات حسب الحالة</h2>
        <ul className="admin-stat-grid">
          {orderStatuses.map((status) => (
            <li key={status}>
              <span>{orderStatusLabels[status]}</span>
              <strong>{summary.orders[status]}</strong>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="catalog-summary-title">
        <h2 id="catalog-summary-title">المنتجات</h2>
        <ul className="admin-stat-grid">
          <li>
            <span>منتجات متاحة</span>
            <strong>{summary.availableProducts}</strong>
          </li>
          <li>
            <span>منتجات غير متاحة</span>
            <strong>{summary.unavailableProducts}</strong>
          </li>
        </ul>
      </section>
      <section aria-labelledby="revenue-summary-title">
        <h2 id="revenue-summary-title">الإيرادات المعروفة للطلبات المسلّمة</h2>
        <p>
          يشمل فقط الطلبات المسلّمة ذات الإجمالي النهائي المعروف.
          <strong>
            <bdi dir="ltr">
              {formatIls(summary.deliveredKnownRevenueAgorot)}
            </bdi>
          </strong>
        </p>
      </section>
    </main>
  );
}
