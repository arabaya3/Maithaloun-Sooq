"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  claimOrdersAction,
  reorderReviewAction,
} from "@/features/accounts/application/account-actions";
import type {
  CustomerOrderSummary,
  ReorderReview,
} from "@/features/accounts/application/customer-orders-service";
import { useCart } from "@/features/cart/cart-provider";
import { sellingLineText } from "@/features/catalog/domain/selling-unit";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";
import { formatIls } from "@/shared/lib/format-currency";

function Money({ agorot }: { agorot: number }) {
  return <bdi dir="ltr">{formatIls(agorot)}</bdi>;
}

// Item names and selling labels are the order's stored snapshots, shown as stored.
function lineText(line: {
  name: string;
  sellingLabel: string | null;
  quantity: number;
}) {
  return line.sellingLabel
    ? `${line.name} — ${sellingLineText(line.sellingLabel, line.quantity)}`
    : `${line.name} × ${line.quantity}`;
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
  const t = useI18n().m.account;
  const available = review.lines.filter(
    (line) => line.status !== "unavailable",
  );
  return (
    <div
      className="reorder-review"
      role="region"
      aria-label={t.reorderReviewLabel}
    >
      <p className="account-note">{t.reorderReviewNote}</p>
      <ul>
        {review.lines.map((line) => (
          <li
            key={`${line.productId}:${line.variantId}:${line.sellingUnitId}`}
            data-status={line.status}
          >
            <span>{lineText(line)}</span>
            {line.status === "unavailable" ? (
              <strong>{t.unavailableLine}</strong>
            ) : line.status === "price_changed" ? (
              <span>
                {t.priceChangedFrom}{" "}
                <Money agorot={line.previousUnitPriceAgorot} />{" "}
                {t.priceChangedTo}{" "}
                <Money agorot={line.currentUnitPriceAgorot ?? 0} />
              </span>
            ) : (
              <span>
                {t.samePrice}{" "}
                <Money agorot={line.currentUnitPriceAgorot ?? 0} />
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
            ? t.addAvailable(available.length)
            : t.noneAvailable}
        </button>
        <button type="button" className="account-secondary" onClick={onCancel}>
          {t.cancel}
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
  const { m, href } = useI18n();
  const t = m.account;
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(t.dateLocale, {
        dateStyle: "medium",
        timeZone: "Asia/Hebron",
      }),
    [t.dateLocale],
  );
  const { addItem } = useCart();
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<{
    reference: string;
    review: ReorderReview;
  } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  function addToCart(lines: ReorderReview["lines"]) {
    for (const line of lines) {
      if (
        line.status !== "unavailable" &&
        line.variantId &&
        line.sellingUnitId
      ) {
        addItem(
          {
            productId: line.productId,
            variantId: line.variantId,
            sellingUnitId: line.sellingUnitId,
            unitsPerSale: line.unitsPerSale,
          },
          line.quantity,
        );
      }
    }
    router.push(href("/cart"));
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
          ? t.claimed(result.claimed)
          : t.nothingToClaim
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
          <h2 id="claim-title">{t.claimTitle}</h2>
          <p className="account-note">{t.claimNote(claimableCount)}</p>
          <button
            type="button"
            className="account-secondary"
            disabled={pending === "claim"}
            onClick={() => void claim()}
          >
            {t.claimAction}
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
                  {t.orderStatus[order.status]}
                </span>
              </div>
              <dl className="order-history-meta">
                <div>
                  <dt>{t.date}</dt>
                  <dd>{dateFormat.format(order.createdAt)}</dd>
                </div>
                <div>
                  <dt>{t.total}</dt>
                  <dd>
                    <Money
                      agorot={
                        order.finalTotalAgorot ?? order.itemsSubtotalAgorot
                      }
                    />
                  </dd>
                </div>
                <div>
                  <dt>{t.payment}</dt>
                  <dd>{t.cashOnDelivery}</dd>
                </div>
              </dl>
              <ul className="order-history-items">
                {order.items.map((item, index) => (
                  <li key={index}>{lineText(item)}</li>
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
                  {t.reorder}
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <section className="account-card">
          <h2>{t.noOrders}</h2>
          <p className="account-note">{t.noOrdersNote}</p>
          <Link className="account-secondary" href="/">
            {t.browseProducts}
          </Link>
        </section>
      )}
    </div>
  );
}
