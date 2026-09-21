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
  isProductAvailable,
  type Product,
} from "@/features/catalog/domain/product";
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
    return product ? [{ ...line, product }] : [];
  });
  const subtotal = calculateCartSubtotal(
    resolvedLines
      .filter((line) => isProductAvailable(line.product))
      .map((line) => ({
        unitPriceAgorot: line.product.priceAgorot,
        quantity: line.quantity,
      })),
  );

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
          {resolvedLines.map(({ product, quantity }) => {
            const name = getProductDisplayName(product);
            const available = isProductAvailable(product);
            const lineSubtotal = available
              ? calculateLineSubtotal(product.priceAgorot, quantity)
              : null;

            return (
              <article className="cart-line" key={product.id}>
                <Link
                  href={`/products/${product.slug}`}
                  aria-label={`عرض تفاصيل ${name}`}
                >
                  <ProductMedia
                    product={product}
                    className="cart-line-media"
                    sizes="8rem"
                  />
                </Link>
                <div className="cart-line-content">
                  <h2>
                    <Link href={`/products/${product.slug}`}>
                      <bdi dir="auto">{name}</bdi>
                    </Link>
                  </h2>
                  <p>
                    سعر الوحدة:{" "}
                    <bdi dir="ltr">{formatIls(product.priceAgorot)}</bdi>
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
                      onChange={(value) => setQuantity(product.id, value)}
                    />
                    <button
                      type="button"
                      className="remove-line-button"
                      aria-label={`إزالة ${name} من السلة`}
                      onClick={() => removeItem(product.id)}
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
        <div>
          <span>المجموع الفرعي</span>
          <strong aria-label={`المجموع الفرعي ${formatIls(subtotal)}`}>
            <bdi dir="ltr">{formatIls(subtotal)}</bdi>
          </strong>
        </div>
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
