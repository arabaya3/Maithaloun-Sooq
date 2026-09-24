"use client";

import { ShoppingBasket, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { QuantityControl } from "@/features/cart/components/quantity-control";
import {
  calculateCartSubtotal,
  calculateLineSubtotal,
} from "@/features/cart/cart-store";
import { useCart } from "@/features/cart/cart-provider";
import { ProductMedia } from "@/features/catalog/components/product-media";
import {
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import {
  formatVariantAttributes,
  isVariantAvailable,
  resolveVariant,
} from "@/features/catalog/domain/product-variant";
import { calculateDeliveryFeeAgorot } from "@/features/delivery/delivery-policy";
import { getFreeDeliveryMessage } from "@/features/delivery/delivery-messaging";
import { formatIls } from "@/shared/lib/format-currency";

export function CartPage({ products }: { products: readonly Product[] }) {
  const { lines, ready, setQuantity, removeItem, clearCart } = useCart();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const resolvedLines = lines.flatMap((line) => {
    const product = productsById.get(line.productId);
    if (!product) return [];
    const variant = resolveVariant(product.variants, line.variantId);
    if (!variant) return [];
    return [{ ...line, product, variant }];
  });
  const merchandiseSubtotal = calculateCartSubtotal(
    resolvedLines
      .filter((line) => isVariantAvailable(line.variant))
      .map((line) => ({
        unitPriceAgorot: line.variant.priceAgorot,
        quantity: line.quantity,
      })),
  );
  const deliveryFeeAgorot = calculateDeliveryFeeAgorot(merchandiseSubtotal);
  const orderTotal = merchandiseSubtotal + deliveryFeeAgorot;
  const freeDeliveryMessage = getFreeDeliveryMessage(merchandiseSubtotal);
  const freeDeliveryQualified =
    deliveryFeeAgorot === 0 && merchandiseSubtotal > 0;

  if (!ready) {
    return (
      <div className="cart-loading" role="status" aria-live="polite">
        جارٍ تحميل السلة…
      </div>
    );
  }

  if (!resolvedLines.length) {
    return (
      <section className="cart-empty" aria-labelledby="empty-cart-title">
        <ShoppingBasket aria-hidden="true" />
        <h1 id="empty-cart-title">سلتك فارغة</h1>
        <p>أضف احتياجاتك من المنتجات، وستظهر هنا.</p>
        <Link href="/#catalog">متابعة التسوق</Link>
      </section>
    );
  }

  return (
    <div className="cart-layout">
      <section className="cart-lines" aria-labelledby="cart-title">
        <div className="cart-title-row">
          <div>
            <span className="eyebrow">مراجعة المنتجات</span>
            <h1 id="cart-title">سلة التسوق</h1>
          </div>
          {!confirmingClear ? (
            <button
              type="button"
              className="clear-cart-button"
              onClick={() => setConfirmingClear(true)}
            >
              إفراغ السلة
            </button>
          ) : null}
        </div>

        {confirmingClear ? (
          <div className="clear-cart-confirmation" role="alert">
            <p>هل تريد إزالة جميع المنتجات من السلة؟</p>
            <div>
              <button
                type="button"
                onClick={() => {
                  clearCart();
                  setConfirmingClear(false);
                }}
              >
                نعم، أفرغ السلة
              </button>
              <button type="button" onClick={() => setConfirmingClear(false)}>
                إلغاء
              </button>
            </div>
          </div>
        ) : null}

        <div className="cart-line-list">
          {resolvedLines.map(({ product, variant, quantity, variantId }) => {
            const name = getProductDisplayName(product);
            const available = isVariantAvailable(variant);
            const lineSubtotal = available
              ? calculateLineSubtotal(variant.priceAgorot, quantity)
              : null;
            const attributeSummary = formatVariantAttributes(
              variant.attributes,
            );
            const lineHref =
              variantId === product.defaultVariantId
                ? `/products/${product.slug}`
                : `/products/${product.slug}?variant=${variantId}`;

            return (
              <article
                className="cart-line"
                key={`${product.id}::${variantId}`}
              >
                <Link href={lineHref} aria-label={`عرض تفاصيل ${name}`}>
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
                  <p>
                    سعر الوحدة:{" "}
                    <bdi dir="ltr">{formatIls(variant.priceAgorot)}</bdi>
                  </p>
                  {!available ? (
                    <p className="unavailable-message">
                      غير متاح حالياً ولا يدخل في المجموع.
                    </p>
                  ) : null}
                  <div className="cart-line-controls">
                    <QuantityControl
                      name={name}
                      quantity={quantity}
                      disabled={!available}
                      onChange={(value) =>
                        setQuantity(product.id, variantId, value)
                      }
                    />
                    <button
                      type="button"
                      className="remove-line-button"
                      aria-label={`إزالة ${name} من السلة`}
                      onClick={() => removeItem(product.id, variantId)}
                    >
                      <Trash2 aria-hidden="true" />
                      إزالة
                    </button>
                  </div>
                </div>
                <p
                  className="cart-line-subtotal"
                  aria-label={
                    lineSubtotal === null
                      ? `مجموع ${name} غير متاح`
                      : `مجموع ${name} ${formatIls(lineSubtotal)}`
                  }
                >
                  {lineSubtotal === null ? (
                    "—"
                  ) : (
                    <bdi dir="ltr">{formatIls(lineSubtotal)}</bdi>
                  )}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="cart-summary" aria-labelledby="cart-summary-title">
        <h2 id="cart-summary-title">ملخص السلة</h2>
        <div className="cart-summary-rows">
          <div>
            <span>مجموع المنتجات</span>
            <strong
              aria-label={`مجموع المنتجات ${formatIls(merchandiseSubtotal)}`}
            >
              <bdi dir="ltr">{formatIls(merchandiseSubtotal)}</bdi>
            </strong>
          </div>
          <div>
            <span>التوصيل</span>
            <strong aria-label={`التوصيل ${formatIls(deliveryFeeAgorot)}`}>
              <bdi dir="ltr">{formatIls(deliveryFeeAgorot)}</bdi>
            </strong>
          </div>
          <div>
            <span>الإجمالي</span>
            <strong aria-label={`الإجمالي ${formatIls(orderTotal)}`}>
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
        <p>تُراجع الأسعار والتوفر مرة أخرى عند تأكيد الطلب.</p>
        <Link className="checkout-action" href="/checkout">
          متابعة إلى بيانات الطلب
        </Link>
        <Link className="continue-shopping-link" href="/#catalog">
          متابعة التسوق
        </Link>
      </aside>
    </div>
  );
}
