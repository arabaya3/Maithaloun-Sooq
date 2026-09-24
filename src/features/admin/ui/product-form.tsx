"use client";

import { useActionState, useState } from "react";

import {
  createProductAction,
  deactivateProductVariantAction,
  removeProductSpecificationAction,
  updateProductAction,
  upsertProductSpecificationAction,
  upsertProductVariantAction,
} from "@/features/admin/application/admin-actions";
import {
  categories,
  placeholderKinds,
  type Product,
} from "@/features/catalog/domain/product";
import type { ProductVariant } from "@/features/catalog/domain/product-variant";
import { formatAgorotAsIlsInput } from "@/shared/lib/parse-ils";

function useAdminFormAction(
  action: (
    formData: FormData,
  ) => Promise<{ ok: false; message: string } | null>,
) {
  return useActionState(
    async (
      _previous: { ok: false; message: string } | null,
      formData: FormData,
    ) => (await action(formData)) ?? null,
    null,
  );
}

function VariantEditor({
  productId,
  variant,
}: {
  productId: string;
  variant?: ProductVariant;
}) {
  const [state, formAction, pending] = useAdminFormAction(
    upsertProductVariantAction,
  );
  const [deactivateState, deactivateAction, deactivatePending] =
    useAdminFormAction(deactivateProductVariantAction);
  const [attributeRows, setAttributeRows] = useState(() => {
    const entries = Object.entries(variant?.attributes ?? {});
    return entries.length ? entries : [["", ""]];
  });
  const imageModeDefault =
    variant?.image.kind === "image" ? "image" : "placeholder";
  const placeholderVariant =
    variant?.image.kind === "placeholder"
      ? variant.image.variant
      : "general-cleaner";

  return (
    <article className="admin-variant-card">
      <h3>{variant ? `خيار: ${variant.labelAr}` : "إضافة خيار جديد"}</h3>
      <form className="admin-form" action={formAction} noValidate>
        <input type="hidden" name="productDomainId" value={productId} />
        <label>
          معرّف الخيار
          <input
            name="variantDomainId"
            required
            dir="ltr"
            defaultValue={variant?.id ?? `${productId}--`}
            readOnly={Boolean(variant)}
          />
        </label>
        <label>
          التسمية
          <input
            name="labelAr"
            required
            defaultValue={variant?.labelAr ?? ""}
          />
        </label>
        <div className="admin-attr-rows">
          <span>الخصائص</span>
          {attributeRows.map(([key, value], index) => (
            <div className="admin-attr-row" key={`attr-${index}`}>
              <input name="attrKey" placeholder="المفتاح" defaultValue={key} />
              <input
                name="attrValue"
                placeholder="القيمة"
                defaultValue={value}
              />
              <button
                type="button"
                onClick={() =>
                  setAttributeRows((rows) =>
                    rows.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
              >
                حذف
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAttributeRows((rows) => [...rows, ["", ""]])}
          >
            إضافة خاصية
          </button>
        </div>
        <label>
          السعر بالشيكل
          <input
            name="priceIls"
            inputMode="decimal"
            required
            dir="ltr"
            defaultValue={
              variant ? formatAgorotAsIlsInput(variant.priceAgorot) : ""
            }
          />
        </label>
        <label>
          التوفر
          <select
            name="availability"
            defaultValue={variant?.availability ?? "unavailable"}
          >
            <option value="available">متاح</option>
            <option value="unavailable">غير متاح</option>
          </select>
        </label>
        <label>
          ترتيب العرض
          <input
            name="sortOrder"
            type="number"
            min={0}
            required
            defaultValue={variant?.sortOrder ?? 0}
          />
        </label>
        <label>
          افتراضي؟
          <select
            name="isDefault"
            defaultValue={variant?.isDefault ? "true" : "false"}
          >
            <option value="false">لا</option>
            <option value="true">نعم</option>
          </select>
        </label>
        <label>
          نوع الصورة
          <select name="imageMode" defaultValue={imageModeDefault}>
            <option value="placeholder">مؤقتة</option>
            <option value="image">مسار صورة</option>
          </select>
        </label>
        <label>
          الشكل المؤقت
          <select name="placeholderVariant" defaultValue={placeholderVariant}>
            {placeholderKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          مسار الصورة
          <input
            name="imageSrc"
            dir="ltr"
            defaultValue={
              variant?.image.kind === "image" ? variant.image.src : ""
            }
          />
        </label>
        <label>
          نص بديل للصورة
          <input
            name="imageAlt"
            defaultValue={
              variant?.image.kind === "image" ? variant.image.alt : ""
            }
          />
        </label>
        <label>
          عرض الصورة
          <input
            name="imageWidth"
            type="number"
            min={1}
            dir="ltr"
            defaultValue={
              variant?.image.kind === "image" ? variant.image.width : ""
            }
          />
        </label>
        <label>
          ارتفاع الصورة
          <input
            name="imageHeight"
            type="number"
            min={1}
            dir="ltr"
            defaultValue={
              variant?.image.kind === "image" ? variant.image.height : ""
            }
          />
        </label>
        {state?.message ? (
          <p className="admin-form-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : variant ? "حفظ الخيار" : "إنشاء الخيار"}
        </button>
      </form>
      {variant && !variant.isDefault ? (
        <form action={deactivateAction}>
          <input type="hidden" name="productDomainId" value={productId} />
          <input type="hidden" name="variantDomainId" value={variant.id} />
          {deactivateState?.message ? (
            <p className="admin-form-error" role="alert">
              {deactivateState.message}
            </p>
          ) : null}
          <button type="submit" disabled={deactivatePending}>
            {deactivatePending ? "جارٍ التعطيل…" : "تعطيل الخيار"}
          </button>
        </form>
      ) : null}
    </article>
  );
}

function SpecificationEditor({
  productId,
  specification,
  nextSortOrder,
}: {
  productId: string;
  specification?: Product["specifications"][number];
  nextSortOrder: number;
}) {
  const [state, formAction, pending] = useAdminFormAction(
    upsertProductSpecificationAction,
  );
  const [removeState, removeAction, removePending] = useAdminFormAction(
    removeProductSpecificationAction,
  );

  return (
    <article className="admin-spec-card">
      <h3>{specification ? "تعديل تفصيل" : "إضافة تفصيل"}</h3>
      <form className="admin-form" action={formAction} noValidate>
        <input type="hidden" name="productDomainId" value={productId} />
        {specification ? (
          <input
            type="hidden"
            name="specificationId"
            value={specification.id}
          />
        ) : null}
        <label>
          العنوان
          <input
            name="labelAr"
            required
            defaultValue={specification?.labelAr ?? ""}
          />
        </label>
        <label>
          القيمة
          <input
            name="valueAr"
            required
            defaultValue={specification?.valueAr ?? ""}
          />
        </label>
        <label>
          الترتيب
          <input
            name="sortOrder"
            type="number"
            min={0}
            required
            defaultValue={specification?.sortOrder ?? nextSortOrder}
          />
        </label>
        {state?.message ? (
          <p className="admin-form-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ التفصيل"}
        </button>
      </form>
      {specification ? (
        <form action={removeAction}>
          <input type="hidden" name="productDomainId" value={productId} />
          <input
            type="hidden"
            name="specificationId"
            value={specification.id}
          />
          {removeState?.message ? (
            <p className="admin-form-error" role="alert">
              {removeState.message}
            </p>
          ) : null}
          <button type="submit" disabled={removePending}>
            {removePending ? "جارٍ الحذف…" : "حذف التفصيل"}
          </button>
        </form>
      ) : null}
    </article>
  );
}

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
  const [state, formAction, pending] = useAdminFormAction(action);
  const placeholderVariant =
    product?.image.kind === "placeholder"
      ? product.image.variant
      : "general-cleaner";

  return (
    <div className="admin-product-editor">
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
          <p className="admin-muted">
            المنتج الجديد يُحفظ غير متاح حتى مراجعته، مع خيار افتراضي
            `--default`.
          </p>
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
        <input
          id="product-unit"
          name="unit"
          defaultValue={product?.unit ?? ""}
        />
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

      {mode === "edit" && product ? (
        <>
          <section className="admin-variant-list" aria-label="خيارات المنتج">
            <h2>خيارات المنتج</h2>
            {product.variants.map((variant) => (
              <VariantEditor
                key={variant.id}
                productId={product.id}
                variant={variant}
              />
            ))}
            <VariantEditor productId={product.id} />
          </section>

          <section className="admin-spec-list" aria-label="تفاصيل المنتج">
            <h2>تفاصيل المنتج</h2>
            {product.specifications.map((specification) => (
              <SpecificationEditor
                key={specification.id}
                productId={product.id}
                specification={specification}
                nextSortOrder={product.specifications.length}
              />
            ))}
            <SpecificationEditor
              productId={product.id}
              nextSortOrder={product.specifications.length}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
