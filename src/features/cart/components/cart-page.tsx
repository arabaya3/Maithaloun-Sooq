"use client";

import { ShoppingBasket, Trash2 } from "lucide-react";
import Link from "next/link";
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
  getProductDisplayName,
  type Product,
} from "@/features/catalog/domain/product";
import { formatVariantAttributes } from "@/features/catalog/domain/product-variant";
import {
  isSellingUnitPurchasable,
  sellingLineText,
} from "@/features/catalog/domain/selling-unit";
import { calculateDeliveryFeeAgorot } from "@/features/delivery/delivery-policy";
import { getFreeDeliveryMessage } from "@/features/delivery/delivery-messaging";
import { formatIls } from "@/shared/lib/format-currency";

export function CartPage({ products }: { products: readonly Product[] }) {
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

  if (!resolvedLines.length && !removedLines.length) {
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
              const name = getProductDisplayName(product);
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
                    {unit && showUnit ? (
                      <p className="cart-line-unit">
                        <bdi dir="auto">
                          {sellingLineText(unit.labelAr, quantity)}
                        </bdi>
                      </p>
                    ) : null}
                    {pack ? (
                      <p className="cart-line-pieces">
                        إجمالي القطع: {quantity * pack.unitsPerSale}
                      </p>
                    ) : null}
                    {priced && unit ? (
                      <p>
                        {pack ? (
                          <>
                            سعر «<bdi dir="auto">{pack.labelAr}</bdi>»:{" "}
                          </>
                        ) : (
                          "سعر الوحدة: "
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
                      <p className="unavailable-message">
                        غير متاح حالياً ولا يدخل في المجموع.
                      </p>
                    ) : null}
                    {status === "limited" && unit ? (
                      <p className="unavailable-message" role="status">
                        المتوفر الآن {unit.maxQuantity} فقط من هذا الخيار. قلّل
                        العدد لإكمال الطلب.
                      </p>
                    ) : null}
                    {status === "review" ? (
                      <div
                        className="cart-line-review"
                        role="group"
                        aria-label={`مراجعة طريقة شراء ${name}`}
                      >
                        <p className="unavailable-message">
                          تغيّرت طريقة الشراء لهذا المنتج منذ أضفته. اختر طريقة
                          شراء متاحة، ولن يدخل في المجموع قبل ذلك.
                        </p>
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
                          <p>لا توجد طريقة شراء متاحة لهذا المنتج حالياً.</p>
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
                        aria-label={`إزالة ${name} من السلة`}
                        onClick={() => removeItem(line)}
                      >
                        <Trash2 aria-hidden="true" />
                        إزالة
                      </button>
                    </div>
                  </div>
                  <p
                    className="cart-line-subtotal"
                    aria-label={
                      lineSubtotalAgorot === null
                        ? `مجموع ${name} غير متاح`
                        : `مجموع ${name} ${formatIls(lineSubtotalAgorot)}`
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
              aria-label={getProductDisplayName(product)}
            >
              <div className="cart-line-details">
                <h2>
                  <bdi dir="auto">{getProductDisplayName(product)}</bdi>
                </h2>
                <p className="unavailable-message" role="status">
                  الصنف الذي اخترته من هذا المنتج لم يعد يُباع. احذفه ثم اختر
                  صنفًا آخر من صفحة المنتج.
                </p>
                <div className="cart-line-review-options">
                  <Link href={`/products/${product.slug}`}>اختيار صنف آخر</Link>
                  <button type="button" onClick={() => removeItem(line)}>
                    حذف من السلة
                  </button>
                </div>
              </div>
            </article>
          ))}
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
        {needsAttention ? (
          <p className="checkout-blocker" role="status">
            راجع المنتجات المعلَّمة في السلة قبل المتابعة.
          </p>
        ) : null}
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
