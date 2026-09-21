import type { Metadata } from "next";
import { connection } from "next/server";

import { adminDeliveryService } from "@/features/admin/application/admin-services";
import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { DeliveryAreaForm } from "@/features/admin/ui/delivery-area-form";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "مناطق التوصيل",
};

export default async function AdminDeliveryAreasPage() {
  await connection();
  const actor = await requireAdminSession();
  const areas = await adminDeliveryService.list(actor);

  return (
    <main className="admin-page">
      <h1>مناطق التوصيل</h1>
      <p className="admin-muted">
        0 ₪ تعني توصيلاً مجانياً. القيمة غير المعروفة تُبقي إجمالي الطلب غير
        محسوب حتى تحديد التكلفة.
      </p>
      <div className="admin-area-grid">
        {areas.map((area) => (
          <section key={area.code} aria-labelledby={`area-${area.code}`}>
            <p id={`area-${area.code}`} className="sr-only">
              {area.nameAr}، التكلفة الحالية{" "}
              {area.deliveryFeeAgorot === null
                ? "غير معروفة"
                : formatIls(area.deliveryFeeAgorot)}
            </p>
            <DeliveryAreaForm area={area} />
          </section>
        ))}
      </div>
    </main>
  );
}
