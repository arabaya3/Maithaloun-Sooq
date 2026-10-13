"use client";

import { ShoppingBasket, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { QuantityControl } from "@/features/cart/components/quantity-control";
import {
  cartMerchandiseSubtotal,
  removedCartLines,
  resolveCartLines,
} from "@/features/cart/cart-lines";
import { cartLineKey } from "@/features/cart/cart-store";
import { useCart } from "@/features/cart/cart-provider";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  localizedProductName,
  type Product,
} from "@/features/catalog/domain/product";
import { formatVariantAttributes } from "@/features/catalog/domain/product-variant";
import {
  isSellingUnitPurchasable,
  sellingLineText,
} from "@/features/catalog/domain/selling-unit";
import { calculateDeliveryFeeAgorot } from "@/features/delivery/delivery-policy";
import { getFreeDeliveryMessage } from "@/features/delivery/delivery-messaging";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";
import { formatIls } from "@/shared/lib/format-currency";

export function CartPage({
  products,
  whatsAppOrdering = false,
}: {
  products: readonly Product[];
  whatsAppOrdering?: boolean;
}) {
  const { m: messages, locale } = useI18n();
  const m = messages.cart;
  const {
    lines,
    ready,
    setQuantity,
    removeItem,
    changeSellingUnit,
    clearCart,
  } = useCart();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const resolvedLines = resolveCartLines(lines, productsById);
  const merchandiseSubtotal = cartMerchandiseSubtotal(resolvedLines);
  const removedLines = removedCartLines(lines, productsById);
  const needsAttention =
    removedLines.length > 0 ||
    resolvedLines.some((line) => line.status !== "ok");
  const deliveryFeeAgorot = calculateDeliveryFeeAgorot(merchandiseSubtotal);
  const orderTotal = merchandiseSubtotal + deliveryFeeAgorot;
  const freeDeliveryMessage = getFreeDeliveryMessage(
    merchandiseSubtotal,
    locale,
  );
  const freeDeliveryQualified =
    deliveryFeeAgorot === 0 && merchandiseSubtotal > 0;

  if (!ready) {
    return (
      <div className="cart-loading" role="status" aria-live="polite">
        {m.loading}
      </div>
    );
  }

  if (!resolvedLines.length && !removedLines.length) {
    return (
      <section className="cart-empty" aria-labelledby="empty-cart-title">
        <ShoppingBasket aria-hidden="true" />
        <h1 id="empty-cart-title">{m.emptyTitle}</h1>
        <p>{m.emptyText}</p>
        <Link href="/#catalog">{m.continueShopping}</Link>
      </section>
    );
  }

  return (
    <div className="cart-layout">
      <section className="cart-lines" aria-labelledby="cart-title">
        <div className="cart-title-row">
          <div>
            <span className="eyebrow">{m.reviewEyebrow}</span>
            <h1 id="cart-title">{m.title}</h1>
          </div>
          {!confirmingClear ? (
            <button
              type="button"
              className="clear-cart-button"
              onClick={() => setConfirmingClear(true)}
            >
              {m.clearCart}
            </button>
          ) : null}
        </div>

        {confirmingClear ? (
          <div className="clear-cart-confirmation" role="alert">
            <p>{m.clearConfirm}</p>
            <div>
              <button
                type="button"
                onClick={() => {
                  clearCart();
                  setConfirmingClear(false);
                }}
              >
                {m.clearYes}
              </button>
              <button type="button" onClick={() => setConfirmingClear(false)}>
                {m.cancel}
              </button>
            </div>
          </div>
        ) : null}

        <div className="cart-line-list">
          {resolvedLines.map(
            ({
              line,
              product,
              variant,
              unit,
              status,
              priced,
              lineSubtotalAgorot,
            }) => {
              const { quantity, variantId } = line;
              const name = localizedProductName(product, locale);
              const attributeSummary = formatVariantAttributes(
                variant.attributes,
              );
              // The link reopens exactly what is in the line: its variant and its way of buying.
              const lineQuery = new URLSearchParams();
              if (variantId !== product.defaultVariantId) {
                lineQuery.set("variant", variantId);
              }
              if (unit && !unit.isDefault) lineQuery.set("unit", unit.id);
              const lineHref = lineQuery.size
                ? `/products/${product.slug}?${lineQuery}`
                : `/products/${product.slug}`;
              const pack = unit && unit.unitsPerSale > 1 ? unit : null;
              const showUnit = Boolean(
                unit && (pack || variant.sellingUnits.length > 1),
              );
              const choices = variant.sellingUnits.filter(
                isSellingUnitPurchasable,
              );

              return (
                <article className="cart-line" key={cartLineKey(line)}>
                  <Link href={lineHref} aria-label={m.viewDetails(name)}>
                    <ProductMedia
                      product={product}
                      image={variant.image}
                      className="cart-line-media"
                      sizes="8rem"
                    />
                  </Link>
                  <div className="cart-line-content">
                    <h2>
                      <Link href={lineHref}>
                        <bdi dir="auto">{name}</bdi>
                      </Link>
                    </h2>
                    <p className="cart-line-variant">
                      {variant.labelAr}
                      {attributeSummary ? ` · ${attributeSummary}` : ""}
                    </p>
                    {unit && showUnit ? (
                      <p className="cart-line-unit">
                        <bdi dir="auto">
                          {sellingLineText(unit.labelAr, quantity)}
                        </bdi>
                      </p>
                    ) : null}
                    {pack ? (
                      <p className="cart-line-pieces">
                        {m.totalPieces(quantity * pack.unitsPerSale)}
                      </p>
                    ) : null}
                    {priced && unit ? (
                      <p>
                        {pack ? (
                          <>
                            {m.packPriceBefore}
                            <bdi dir="auto">{pack.labelAr}</bdi>
                            {m.packPriceAfter}
                          </>
                        ) : (
                          m.unitPrice
                        )}
                        <bdi dir="ltr">{formatIls(priced.unitPriceAgorot)}</bdi>
                        {priced.offerId ? (
                          <>
                            {" "}
                            <del className="price-was">
                              <bdi dir="ltr">
                                {formatIls(priced.listUnitPriceAgorot)}
                              </bdi>
                            </del>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {status === "unavailable" ? (
                      <p className="unavailable-message">{m.unavailable}</p>
                    ) : null}
                    {status === "limited" && unit ? (
                      <p className="unavailable-message" role="status">
                        {m.limited(unit.maxQuantity)}
                      </p>
                    ) : null}
                    {status === "review" ? (
                      <div
                        className="cart-line-review"
                        role="group"
                        aria-label={m.reviewGroup(name)}
                      >
                        <p className="unavailable-message">{m.reviewText}</p>
                        {choices.length ? (
                          <div className="cart-line-review-options">
                            {choices.map((choice) => (
                              <button
                                key={choice.id}
                                type="button"
                                onClick={() =>
                                  changeSellingUnit(line, {
                                    sellingUnitId: choice.id,
                                    unitsPerSale: choice.unitsPerSale,
                                  })
                                }
                              >
                                <bdi dir="auto">{choice.labelAr}</bdi>
                                {" — "}
                                <bdi dir="ltr">
                                  {formatIls(choice.priceAgorot)}
                                </bdi>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p>{m.noUnitAvailable}</p>
                        )}
                      </div>
                    ) : null}
                    <div className="cart-line-controls">
                      <QuantityControl
                        name={pack ? `${name} — ${pack.labelAr}` : name}
                        quantity={quantity}
                        max={unit ? Math.max(1, unit.maxQuantity) : 1}
                        disabled={
                          status === "review" || status === "unavailable"
                        }
                        onChange={(value) => setQuantity(line, value)}
                      />
                      <button
                        type="button"
                        className="remove-line-button"
                        aria-label={m.removeFromCart(name)}
                        onClick={() => removeItem(line)}
                      >
                        <Trash2 aria-hidden="true" />
                        {m.remove}
                      </button>
                    </div>
                  </div>
                  <p
                    className="cart-line-subtotal"
                    aria-label={
                      lineSubtotalAgorot === null
                        ? m.lineTotalUnavailable(name)
                        : m.lineTotal(name, formatIls(lineSubtotalAgorot))
                    }
                  >
                    {lineSubtotalAgorot === null ? (
                      "—"
                    ) : (
                      <bdi dir="ltr">{formatIls(lineSubtotalAgorot)}</bdi>
                    )}
                  </p>
                </article>
              );
            },
          )}
          {removedLines.map(({ line, product }) => (
            <article
              key={cartLineKey(line)}
              className="cart-line cart-line-removed"
              aria-label={localizedProductName(product, locale)}
            >
              <div className="cart-line-details">
                <h2>
                  <bdi dir="auto">{localizedProductName(product, locale)}</bdi>
                </h2>
                <p className="unavailable-message" role="status">
                  {m.removedVariant}
                </p>
                <div className="cart-line-review-options">
                  <Link href={`/products/${product.slug}`}>
                    {m.chooseOtherVariant}
                  </Link>
                  <button type="button" onClick={() => removeItem(line)}>
                    {m.deleteFromCart}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="cart-summary" aria-labelledby="cart-summary-title">
        <h2 id="cart-summary-title">{m.summaryTitle}</h2>
        <ul className="cart-summary-lines" aria-label={m.orderLines}>
          {resolvedLines.map((resolved) => {
            const { line, unit, variant } = resolved;
            const details = [
              variant.labelAr,
              formatVariantAttributes(variant.attributes),
              unit && (unit.unitsPerSale > 1 || variant.sellingUnits.length > 1)
                ? sellingLineText(unit.labelAr, line.quantity)
                : `× ${line.quantity}`,
            ].filter(Boolean);
            return (
              <li key={cartLineKey(line)}>
                <span>
                  <bdi dir="auto">
                    {localizedProductName(resolved.product, locale)}
                  </bdi>
                  <small>{details.join(" · ")}</small>
                </span>
                <bdi dir="ltr">
                  {resolved.lineSubtotalAgorot === null
                    ? "—"
                    : formatIls(resolved.lineSubtotalAgorot)}
                </bdi>
              </li>
            );
          })}
        </ul>
        <div className="cart-summary-rows">
          <div>
            <span>{m.subtotal}</span>
            <strong
              aria-label={`${m.subtotal} ${formatIls(merchandiseSubtotal)}`}
            >
              <bdi dir="ltr">{formatIls(merchandiseSubtotal)}</bdi>
            </strong>
          </div>
          <div>
            <span>{m.delivery}</span>
            <strong
              aria-label={`${m.delivery} ${formatIls(deliveryFeeAgorot)}`}
            >
              <bdi dir="ltr">{formatIls(deliveryFeeAgorot)}</bdi>
            </strong>
          </div>
          <div>
            <span>{m.total}</span>
            <strong aria-label={`${m.total} ${formatIls(orderTotal)}`}>
              <bdi dir="ltr">{formatIls(orderTotal)}</bdi>
            </strong>
          </div>
        </div>
        {merchandiseSubtotal > 0 ? (
          <p
            className="free-delivery-hint"
            data-qualified={freeDeliveryQualified}
            role="status"
          >
            {freeDeliveryMessage}
          </p>
        ) : null}
        <p>{m.pricesRechecked}</p>
        {needsAttention ? (
          <p className="checkout-blocker" role="status">
            {m.reviewMarked}
          </p>
        ) : null}
        {needsAttention ? (
          <>
            {whatsAppOrdering ? (
              <span
                className="checkout-action checkout-whatsapp-action"
                aria-disabled="true"
              >
                {m.orderViaWhatsApp}
              </span>
            ) : null}
            <span className="checkout-action" aria-disabled="true">
              {m.orderViaWeb}
            </span>
          </>
        ) : (
          <>
            {whatsAppOrdering ? (
              <>
                <Link
                  className="checkout-action checkout-whatsapp-action"
                  href="/checkout?channel=whatsapp"
                  aria-describedby="cart-whatsapp-note"
                >
                  {m.orderViaWhatsApp}
                </Link>
                <p id="cart-whatsapp-note" className="cart-channel-note">
                  {m.whatsAppNote}
                </p>
              </>
            ) : null}
            <Link
              className={
                whatsAppOrdering
                  ? "checkout-action checkout-web-action"
                  : "checkout-action"
              }
              href="/checkout?channel=web"
              aria-describedby="cart-web-note"
            >
              {m.orderViaWeb}
            </Link>
            <p id="cart-web-note" className="cart-channel-note">
              {m.webNote}
            </p>
          </>
        )}
        <Link className="continue-shopping-link" href="/#catalog">
          {m.continueShopping}
        </Link>
      </aside>
    </div>
  );
}
