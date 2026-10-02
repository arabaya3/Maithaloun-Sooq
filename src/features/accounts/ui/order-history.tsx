"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  claimOrdersAction,
  reorderReviewAction,
} from "@/features/accounts/application/account-actions";
import type {
  CustomerOrderSummary,
  ReorderReview,
} from "@/features/accounts/application/customer-orders-service";
import { useCart } from "@/features/cart/cart-provider";
import { orderStatusLabels } from "@/features/orders/domain/order-status";
import { formatIls } from "@/shared/lib/format-currency";

const dateFormat = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
  dateStyle: "medium",
  timeZone: "Asia/Hebron",
});

function Money({ agorot }: { agorot: number }) {
  return <bdi dir="ltr">{formatIls(agorot)}</bdi>;
}

function ReorderPanel({
  review,
  onConfirm,
  onCancel,
}: {
  review: ReorderReview;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const available = review.lines.filter(
    (line) => line.status !== "unavailable",
  );
  return (
    <div
      className="reorder-review"
      role="region"
      aria-label="مراجعة إعادة الطلب"
    >
      <p className="account-note">
        تغيّرت بعض المنتجات منذ طلبك السابق. راجعها قبل إضافتها للسلة؛ الأسعار
        المعروضة هي الأسعار الحالية.
      </p>
      <ul>
        {review.lines.map((line) => (
          <li
            key={`${line.productId}:${line.variantId}`}
            data-status={line.status}
          >
            <span>
              {line.name} × {line.quantity}
            </span>
            {line.status === "unavailable" ? (
              <strong>غير متوفر حالياً — لن يُضاف</strong>
            ) : line.status === "price_changed" ? (
              <span>
                السعر تغيّر من <Money agorot={line.previousUnitPriceAgorot} />{" "}
                إلى <Money agorot={line.currentUnitPriceAgorot ?? 0} />
              </span>
            ) : (
              <span>
                بنفس السعر <Money agorot={line.currentUnitPriceAgorot ?? 0} />
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="account-row-actions">
        <button
          type="button"
          className="account-primary"
          onClick={onConfirm}
          disabled={!available.length}
        >
          {available.length
            ? `أضف المنتجات المتوفرة للسلة (${available.length})`
            : "لا توجد منتجات متوفرة"}
        </button>
        <button type="button" className="account-secondary" onClick={onCancel}>
          إلغاء
        </button>
      </div>
    </div>
  );
}

export function OrderHistory({
  orders,
  claimableCount,
}: {
  orders: CustomerOrderSummary[];
  claimableCount: number;
}) {
  const router = useRouter();
  const { addItem } = useCart();
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<{
    reference: string;
    review: ReorderReview;
  } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  function addToCart(lines: ReorderReview["lines"]) {
    for (const line of lines) {
      if (line.status !== "unavailable" && line.variantId) {
        addItem(line.productId, line.variantId, line.quantity);
      }
    }
    router.push("/cart");
  }

  async function reorder(reference: string) {
    setPending(reference);
    setMessage("");
    const result = await reorderReviewAction(reference);
    setPending(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (result.review.needsReview)
      setReview({ reference, review: result.review });
    else addToCart(result.review.lines);
  }

  async function claim() {
    setPending("claim");
    const result = await claimOrdersAction();
    setPending(null);
    setMessage(
      result.ok
        ? result.claimed
          ? `أضفنا الطلبات السابقة إلى حسابك (${result.claimed}).`
          : "لا توجد طلبات جديدة لإضافتها."
        : result.message,
    );
    if (result.ok) router.refresh();
  }

  return (
    <div className="account-sections">
      {claimableCount > 0 ? (
        <section
          className="account-card account-suggestion"
          aria-labelledby="claim-title"
        >
          <h2 id="claim-title">طلبات سابقة برقمك</h2>
          <p className="account-note">
            وجدنا طلبات سابقة أُرسلت من رقم جوالك المؤكد ({claimableCount}). هل
            تريد إضافتها إلى حسابك؟
          </p>
          <button
            type="button"
            className="account-secondary"
            disabled={pending === "claim"}
            onClick={() => void claim()}
          >
            إضافة الطلبات إلى حسابي
          </button>
        </section>
      ) : null}
      {message ? (
        <p className="account-message" role="status">
          {message}
        </p>
      ) : null}
      {orders.length ? (
        <ol className="order-history">
          {orders.map((order) => (
            <li key={order.publicReference} className="account-card">
              <div className="order-history-head">
                <strong>
                  <bdi dir="ltr">{order.publicReference}</bdi>
                </strong>
                <span className="account-badge" data-status={order.status}>
                  {orderStatusLabels[order.status]}
                </span>
              </div>
              <dl className="order-history-meta">
                <div>
                  <dt>التاريخ</dt>
                  <dd>{dateFormat.format(order.createdAt)}</dd>
                </div>
                <div>
                  <dt>المجموع</dt>
                  <dd>
                    <Money
                      agorot={
                        order.finalTotalAgorot ?? order.itemsSubtotalAgorot
                      }
                    />
                  </dd>
                </div>
                <div>
                  <dt>الدفع</dt>
                  <dd>نقداً عند الاستلام</dd>
                </div>
              </dl>
              <ul className="order-history-items">
                {order.items.map((item, index) => (
                  <li key={index}>
                    {item.name} × {item.quantity}
                  </li>
                ))}
              </ul>
              {review?.reference === order.publicReference ? (
                <ReorderPanel
                  review={review.review}
                  onCancel={() => setReview(null)}
                  onConfirm={() => addToCart(review.review.lines)}
                />
              ) : (
                <button
                  type="button"
                  className="account-secondary"
                  disabled={pending === order.publicReference}
                  onClick={() => void reorder(order.publicReference)}
                >
                  إعادة الطلب
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <section className="account-card">
          <h2>لا توجد طلبات بعد</h2>
          <p className="account-note">
            ستظهر هنا الطلبات التي ترسلها وأنت مسجّل الدخول.
          </p>
          <Link className="account-secondary" href="/">
            تصفح المنتجات
          </Link>
        </section>
      )}
    </div>
  );
}
