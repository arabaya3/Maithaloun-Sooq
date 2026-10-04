import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import {
  adminCatalogService,
  adminOrderService,
  qaStockSimulation,
} from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { formatAdminDateTime } from "@/features/admin/ui/format-admin-datetime";
import { AdminStatusBadge } from "@/features/admin/ui/admin-status-badge";
import { PageHeader } from "@/features/admin/ui/kit";
import { QaOrderForm } from "@/features/admin/ui/qa-order-form";
import { QaStockSimulationPanel } from "@/features/admin/ui/qa-stock-simulation-panel";
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
  const simulationEnabled = process.env.QA_STOCK_SIMULATION === "on";
  const [products, existing, probes] = await Promise.all([
    adminCatalogService.list(actor),
    adminOrderService.list(actor, { page: 1, test: true }),
    simulationEnabled ? qaStockSimulation.probes(actor) : Promise.resolve([]),
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
        يدخل في التقارير، ولا يحجز المخزون. يمكن إلغاؤه فقط. لاختبار خصم المخزون
        وإرجاعه استخدمي محاكاة مسار المخزون أدناه.
      </p>
      {options.length ? (
        <QaOrderForm options={options} />
      ) : (
        <p className="admin-muted">لا توجد أصناف منشورة ومتوفرة للاختبار.</p>
      )}
      <section className="admin-panel" aria-labelledby="qa-stock-title">
        <h2 id="qa-stock-title">محاكاة مسار المخزون</h2>
        <p className="admin-note" role="note">
          تنفّذ الطلب والتأكيد والإلغاء والتسليم عبر خدمات المتجر الحقيقية على
          صنف فحص مخصص، داخل معاملة واحدة يُتراجع عنها كاملة. لا يبقى أي طلب أو
          حركة مخزون أو إشعار.
        </p>
        {simulationEnabled ? (
          <QaStockSimulationPanel probes={probes} />
        ) : (
          <p className="admin-muted">
            المحاكاة غير مفعّلة على هذا الخادم (QA_STOCK_SIMULATION).
          </p>
        )}
      </section>
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
