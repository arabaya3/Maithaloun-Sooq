import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { orderService } from "@/features/orders/application/order-service-instance";
import { formatIls } from "@/shared/lib/format-currency";

export const metadata: Metadata = {
  title: "تم استلام الطلب",
  robots: { index: false, follow: false, nocache: true },
};

export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  await connection();
  const confirmation = await orderService.getConfirmation(
    (await params).reference,
  );
  if (!confirmation) notFound();

  return (
    <main className="page-shell order-confirmation-page">
      <section aria-labelledby="confirmation-title">
        <CheckCircle2 aria-hidden="true" />
        <span className="eyebrow">تم استلام الطلب</span>
        <h1 id="confirmation-title">شكراً، طلبك قيد المراجعة</h1>
        <p>
          حالة الطلب: <strong>قيد الانتظار</strong>
        </p>
        <div className="order-reference">
          <span>رقم الطلب</span>
          <strong>
            <bdi dir="ltr">{confirmation.publicReference}</bdi>
          </strong>
        </div>
        <dl>
          <div>
            <dt>مجموع المنتجات</dt>
            <dd>
              <bdi dir="ltr">{formatIls(confirmation.itemsSubtotalAgorot)}</bdi>
            </dd>
          </div>
          <div>
            <dt>تكلفة التوصيل</dt>
            <dd>
              {confirmation.deliveryFeeAgorot === null
                ? "سيتم تأكيدها لاحقاً"
                : formatIls(confirmation.deliveryFeeAgorot)}
            </dd>
          </div>
          <div>
            <dt>طريقة الدفع</dt>
            <dd>نقداً عند الاستلام</dd>
          </div>
        </dl>
        <Link href="/">العودة إلى المتجر</Link>
      </section>
    </main>
  );
}
