"use client";

import { useActionState } from "react";

import {
  createProductAction,
  updateProductAction,
} from "@/features/admin/application/admin-actions";
import {
  categories,
  placeholderKinds,
  type Product,
} from "@/features/catalog/domain/product";
import { formatAgorotAsIlsInput } from "@/shared/lib/parse-ils";

export function ProductForm({
  product,
  sortOrder,
  mode,
}: {
  product?: Product;
  sortOrder: number;
  mode: "create" | "edit";
}) {
  const action = mode === "create" ? createProductAction : updateProductAction;
  const [state, formAction, pending] = useActionState(
    async (
      _previous: { ok: false; message: string } | null,
      formData: FormData,
    ) => (await action(formData)) ?? null,
    null,
  );
  const placeholderVariant =
    product?.image.kind === "placeholder"
      ? product.image.variant
      : "general-cleaner";

  return (
    <form className="admin-form" action={formAction} noValidate>
      {mode === "edit" && product ? (
        <input type="hidden" name="domainId" value={product.id} />
      ) : (
        <>
          <label htmlFor="product-domain-id">معرّف المنتج</label>
          <input
            id="product-domain-id"
            name="domainId"
            required
            dir="ltr"
            defaultValue=""
          />
          <label htmlFor="product-slug">الرابط</label>
          <input id="product-slug" name="slug" required dir="ltr" />
        </>
      )}
      <label htmlFor="product-name-ar">الاسم العربي</label>
      <input
        id="product-name-ar"
        name="nameAr"
        required
        defaultValue={product?.nameAr ?? ""}
      />
      <label htmlFor="product-latin-name">الاسم اللاتيني اختياري</label>
      <input
        id="product-latin-name"
        name="latinName"
        dir="ltr"
        defaultValue={product?.latinName ?? ""}
      />
      <label htmlFor="product-price">السعر بالشيكل</label>
      <input
        id="product-price"
        name="priceIls"
        inputMode="decimal"
        required
        dir="ltr"
        defaultValue={
          product ? formatAgorotAsIlsInput(product.priceAgorot) : ""
        }
      />
      <label htmlFor="product-category">الفئة</label>
      <select
        id="product-category"
        name="categoryId"
        defaultValue={product?.categoryId ?? "home"}
      >
        {categories
          .filter((category) => category.id !== "all")
          .map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
      </select>
      {mode === "edit" ? (
        <>
          <label htmlFor="product-availability">التوفر</label>
          <select
            id="product-availability"
            name="availability"
            defaultValue={product?.availability ?? "unavailable"}
          >
            <option value="available">متاح</option>
            <option value="unavailable">غير متاح</option>
          </select>
        </>
      ) : (
        <p className="admin-muted">المنتج الجديد يُحفظ غير متاح حتى مراجعته.</p>
      )}
      <label htmlFor="product-sort">ترتيب العرض</label>
      <input
        id="product-sort"
        name="sortOrder"
        type="number"
        min={0}
        required
        defaultValue={sortOrder}
      />
      <label htmlFor="product-description">الوصف المعتمد</label>
      <textarea
        id="product-description"
        name="description"
        rows={4}
        defaultValue={product?.description ?? ""}
      />
      <label htmlFor="product-usage">ملاحظات الاستخدام المعتمدة</label>
      <textarea
        id="product-usage"
        name="usageNotes"
        rows={4}
        defaultValue={product?.usageNotes ?? ""}
      />
      <label htmlFor="product-unit">الوحدة</label>
      <input id="product-unit" name="unit" defaultValue={product?.unit ?? ""} />
      <label htmlFor="product-details-status">حالة التفاصيل</label>
      <select
        id="product-details-status"
        name="detailsStatus"
        defaultValue={product?.detailsStatus ?? "placeholder"}
      >
        <option value="placeholder">أولية</option>
        <option value="verified">معتمدة</option>
      </select>
      <label htmlFor="product-placeholder">شكل الصورة المؤقتة</label>
      <select
        id="product-placeholder"
        name="placeholderVariant"
        defaultValue={placeholderVariant}
      >
        {placeholderKinds.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
      {state?.message ? (
        <p className="admin-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending
          ? "جارٍ الحفظ…"
          : mode === "create"
            ? "إنشاء المنتج"
            : "حفظ المنتج"}
      </button>
    </form>
  );
}
