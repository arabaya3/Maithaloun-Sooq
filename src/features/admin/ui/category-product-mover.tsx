"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { moveProductsAction } from "../application/catalog-management-actions";

export function CategoryProductMover({
  categoryName,
  products,
  targets,
}: {
  categoryName: string;
  products: Array<{ id: string; name: string; status: string }>;
  targets: Array<{ code: string; nameAr: string }>;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const targetName = targets.find((item) => item.code === target)?.nameAr;
  const allChosen = chosen.size === products.length && products.length > 0;

  function toggle(id: string, on: boolean) {
    setConfirming(false);
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function move() {
    startTransition(async () => {
      const result = await moveProductsAction({
        productDomainIds: [...chosen],
        targetCode: target,
      });
      setConfirming(false);
      if (result?.ok) {
        setChosen(new Set());
        setMessage({
          ok: true,
          text: `نُقل ${result.moved} منتج إلى «${targetName}».`,
        });
        router.refresh();
      } else if (result) {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  if (!products.length) {
    return (
      <div className="admin-category-mover">
        {message ? (
          <p className="admin-media-message" data-tone="ok" role="status">
            {message.text}
          </p>
        ) : null}
        <p className="admin-muted">لا توجد منتجات فعّالة في هذا القسم.</p>
      </div>
    );
  }

  return (
    <div className="admin-category-mover">
      <fieldset className="admin-choice-group">
        <legend>
          منتجات «{categoryName}» ({products.length})
        </legend>
        <label className="admin-choice">
          <input
            type="checkbox"
            checked={allChosen}
            onChange={(event) =>
              products.forEach((product) =>
                toggle(product.id, event.target.checked),
              )
            }
          />
          تحديد الكل
        </label>
        {products.map((product) => (
          <label key={product.id} className="admin-choice">
            <input
              type="checkbox"
              checked={chosen.has(product.id)}
              onChange={(event) => toggle(product.id, event.target.checked)}
            />
            <span>
              <bdi>{product.name}</bdi>
              <small className="admin-muted">{product.status}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="admin-category-mover-target">
        <span>القسم الجديد</span>
        <select
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setConfirming(false);
          }}
        >
          <option value="">اختاري قسمًا</option>
          {targets.map((item) => (
            <option key={item.code} value={item.code}>
              {item.nameAr}
            </option>
          ))}
        </select>
      </label>
      {confirming ? (
        <div className="admin-note" role="alert">
          <p>
            نقل {chosen.size} منتج من «{categoryName}» إلى «{targetName}»؟ يظهر
            المنتج في القسم الجديد في المتجر فورًا.
          </p>
          <div className="admin-category-mover-actions">
            <button
              type="button"
              className="admin-button-primary"
              disabled={pending}
              onClick={move}
            >
              {pending ? "جارٍ النقل…" : "تأكيد النقل"}
            </button>
            <button
              type="button"
              className="admin-button-secondary"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="admin-button-primary"
          disabled={!chosen.size || !target}
          onClick={() => {
            setMessage(null);
            setConfirming(true);
          }}
        >
          نقل المنتجات المحددة
        </button>
      )}
      {message ? (
        <p
          className="admin-media-message"
          data-tone={message.ok ? "ok" : "error"}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
