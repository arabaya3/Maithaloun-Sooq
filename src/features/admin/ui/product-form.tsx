"use client";

import {
  useActionState,
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";

import {
  deactivateProductVariantAction,
  removeProductSpecificationAction,
  updateProductAction,
  upsertProductSpecificationAction,
  upsertProductVariantAction,
} from "@/features/admin/application/admin-actions";
import { CategoryOptions } from "@/features/admin/ui/admin-categories";
import {
  placeholderKinds,
  type Product,
} from "@/features/catalog/domain/product";
import type { ProductVariant } from "@/features/catalog/domain/product-variant";
import { formatAgorotAsIlsInput } from "@/shared/lib/parse-ils";

type ActionResult = { ok: false; message: string } | null;

function useAdminFormAction(
  action: (formData: FormData) => Promise<ActionResult>,
) {
  return useActionState(
    async (_previous: ActionResult, formData: FormData) =>
      (await action(formData)) ?? null,
    null,
  );
}

function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

function markDirtyFromEvent(
  event: FormEvent<HTMLElement>,
  setDirty: (value: boolean) => void,
) {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  ) {
    setDirty(true);
  }
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="admin-form-error" role="alert">
      {message}
    </p>
  );
}

function PlaceholderOptions() {
  return (
    <>
      {placeholderKinds.map((kind) => (
        <option key={kind} value={kind}>
          {kind}
        </option>
      ))}
    </>
  );
}

function VariantEditor({
  productId,
  variant,
  onDirty,
}: {
  productId: string;
  variant?: ProductVariant;
  onDirty?: () => void;
}) {
  const formId = useId();
  const [state, formAction, pending] = useAdminFormAction(
    upsertProductVariantAction,
  );
  const [deactivateState, deactivateAction, deactivatePending] =
    useAdminFormAction(deactivateProductVariantAction);
  const [attributeRows, setAttributeRows] = useState(() => {
    const entries = Object.entries(variant?.attributes ?? {});
    return entries.length ? entries : [["", ""]];
  });
  const [imageMode, setImageMode] = useState(
    variant?.image.kind === "image" ? "image" : "placeholder",
  );
  const placeholderVariant =
    variant?.image.kind === "placeholder"
      ? variant.image.variant
      : "general-cleaner";

  return (
    <article className="admin-variant-card">
      <h3>{variant ? `خيار: ${variant.labelAr}` : "إضافة خيار جديد"}</h3>
      <form
        className="admin-form"
        action={formAction}
        noValidate
        onInput={() => onDirty?.()}
        onChange={() => onDirty?.()}
      >
        <input type="hidden" name="productDomainId" value={productId} />
        {variant ? (
          <input type="hidden" name="variantDomainId" value={variant.id} />
        ) : (
          <label htmlFor={`${formId}-variant-id`}>
            معرّف الخيار
            <input
              id={`${formId}-variant-id`}
              name="variantDomainId"
              required
              dir="ltr"
              defaultValue={`${productId}--`}
            />
          </label>
        )}

        <div className="admin-field-grid">
          <label htmlFor={`${formId}-label`}>
            التسمية
            <input
              id={`${formId}-label`}
              name="labelAr"
              required
              defaultValue={variant?.labelAr ?? ""}
              placeholder="مثل: ١ كغم"
            />
          </label>
          <label htmlFor={`${formId}-price`}>
            السعر بالشيكل
            <input
              id={`${formId}-price`}
              name="priceIls"
              inputMode="decimal"
              required
              dir="ltr"
              defaultValue={
                variant ? formatAgorotAsIlsInput(variant.priceAgorot) : ""
              }
            />
          </label>
          <label htmlFor={`${formId}-availability`}>
            التوفر
            <select
              id={`${formId}-availability`}
              name="availability"
              defaultValue={variant?.availability ?? "unavailable"}
            >
              <option value="available">متاح</option>
              <option value="unavailable">غير متاح</option>
            </select>
          </label>
          <label htmlFor={`${formId}-default`}>
            افتراضي؟
            <select
              id={`${formId}-default`}
              name="isDefault"
              defaultValue={variant?.isDefault ? "true" : "false"}
            >
              <option value="false">لا</option>
              <option value="true">نعم</option>
            </select>
          </label>
        </div>

        <label htmlFor={`${formId}-sort`} className="admin-field-secondary">
          ترتيب العرض
          <input
            id={`${formId}-sort`}
            name="sortOrder"
            type="number"
            min={0}
            required
            defaultValue={variant?.sortOrder ?? 0}
          />
        </label>

        <fieldset className="admin-fieldset">
          <legend>الصورة</legend>
          <label htmlFor={`${formId}-image-mode`}>
            نوع الصورة
            <select
              id={`${formId}-image-mode`}
              name="imageMode"
              value={imageMode}
              onChange={(event) => setImageMode(event.target.value)}
            >
              <option value="placeholder">مؤقتة</option>
              <option value="image">مسار صورة</option>
            </select>
          </label>
          {imageMode === "placeholder" ? (
            <label htmlFor={`${formId}-placeholder`}>
              الشكل المؤقت
              <select
                id={`${formId}-placeholder`}
                name="placeholderVariant"
                defaultValue={placeholderVariant}
              >
                <PlaceholderOptions />
              </select>
            </label>
          ) : (
            <div className="admin-field-grid">
              <label htmlFor={`${formId}-src`}>
                مسار الصورة
                <input
                  id={`${formId}-src`}
                  name="imageSrc"
                  dir="ltr"
                  defaultValue={
                    variant?.image.kind === "image" ? variant.image.src : ""
                  }
                />
              </label>
              <label htmlFor={`${formId}-alt`}>
                نص بديل للصورة
                <input
                  id={`${formId}-alt`}
                  name="imageAlt"
                  defaultValue={
                    variant?.image.kind === "image" ? variant.image.alt : ""
                  }
                />
              </label>
              <label htmlFor={`${formId}-width`}>
                عرض الصورة
                <input
                  id={`${formId}-width`}
                  name="imageWidth"
                  type="number"
                  min={1}
                  dir="ltr"
                  defaultValue={
                    variant?.image.kind === "image" ? variant.image.width : ""
                  }
                />
              </label>
              <label htmlFor={`${formId}-height`}>
                ارتفاع الصورة
                <input
                  id={`${formId}-height`}
                  name="imageHeight"
                  type="number"
                  min={1}
                  dir="ltr"
                  defaultValue={
                    variant?.image.kind === "image" ? variant.image.height : ""
                  }
                />
              </label>
            </div>
          )}
        </fieldset>

        <details className="admin-disclosure">
          <summary>خصائص إضافية (اختياري)</summary>
          <div className="admin-attr-rows">
            {attributeRows.map(([key, value], index) => (
              <div className="admin-attr-row" key={`attr-${index}`}>
                <input
                  name="attrKey"
                  placeholder="المفتاح"
                  defaultValue={key}
                  aria-label={`مفتاح الخاصية ${index + 1}`}
                />
                <input
                  name="attrValue"
                  placeholder="القيمة"
                  defaultValue={value}
                  aria-label={`قيمة الخاصية ${index + 1}`}
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
        </details>

        <FieldError message={state?.message} />
        <button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : variant ? "حفظ الخيار" : "إنشاء الخيار"}
        </button>
      </form>
      {variant && !variant.isDefault ? (
        <form action={deactivateAction}>
          <input type="hidden" name="productDomainId" value={productId} />
          <input type="hidden" name="variantDomainId" value={variant.id} />
          <FieldError message={deactivateState?.message} />
          <button
            type="submit"
            className="admin-button-danger"
            disabled={deactivatePending}
          >
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
  onDirty,
}: {
  productId: string;
  specification?: Product["specifications"][number];
  nextSortOrder: number;
  onDirty?: () => void;
}) {
  const formId = useId();
  const [state, formAction, pending] = useAdminFormAction(
    upsertProductSpecificationAction,
  );
  const [removeState, removeAction, removePending] = useAdminFormAction(
    removeProductSpecificationAction,
  );

  return (
    <article className="admin-spec-card">
      <h3>{specification ? "تعديل تفصيل" : "إضافة تفصيل"}</h3>
      <form
        className="admin-form"
        action={formAction}
        noValidate
        onInput={() => onDirty?.()}
        onChange={() => onDirty?.()}
      >
        <input type="hidden" name="productDomainId" value={productId} />
        {specification ? (
          <input
            type="hidden"
            name="specificationId"
            value={specification.id}
          />
        ) : null}
        <div className="admin-field-grid">
          <label htmlFor={`${formId}-label`}>
            العنوان
            <input
              id={`${formId}-label`}
              name="labelAr"
              required
              defaultValue={specification?.labelAr ?? ""}
            />
          </label>
          <label htmlFor={`${formId}-value`}>
            القيمة
            <input
              id={`${formId}-value`}
              name="valueAr"
              required
              defaultValue={specification?.valueAr ?? ""}
            />
          </label>
          <label htmlFor={`${formId}-sort`}>
            الترتيب
            <input
              id={`${formId}-sort`}
              name="sortOrder"
              type="number"
              min={0}
              required
              defaultValue={specification?.sortOrder ?? nextSortOrder}
            />
          </label>
        </div>
        <FieldError message={state?.message} />
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
          <FieldError message={removeState?.message} />
          <button
            type="submit"
            className="admin-button-danger"
            disabled={removePending}
          >
            {removePending ? "جارٍ الحذف…" : "حذف التفصيل"}
          </button>
        </form>
      ) : null}
    </article>
  );
}

function EditProductForm({
  product,
  sortOrder,
  dirty,
  setDirty,
}: {
  product: Product;
  sortOrder: number;
  dirty: boolean;
  setDirty: (value: boolean) => void;
}) {
  const [state, formAction, pending] = useAdminFormAction(updateProductAction);
  const [tab, setTab] = useState<"core" | "variants" | "specs">("core");
  const placeholderVariant =
    product.image.kind === "placeholder"
      ? product.image.variant
      : "general-cleaner";

  useUnsavedChangesWarning(dirty);
  const markDirty = () => setDirty(true);

  return (
    <div className="admin-product-editor">
      <div
        className="admin-tabs"
        role="tablist"
        aria-label="أقسام تعديل المنتج"
      >
        {(
          [
            ["core", "الأساسيات"],
            ["variants", "الخيارات"],
            ["specs", "التفاصيل"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={tab === id ? "admin-tab is-active" : "admin-tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        id="panel-core"
        role="tabpanel"
        aria-labelledby="tab-core"
        hidden={tab !== "core"}
      >
        <form
          className="admin-form"
          action={formAction}
          noValidate
          onInput={(event) => markDirtyFromEvent(event, setDirty)}
          onChange={(event) => markDirtyFromEvent(event, setDirty)}
        >
          <input type="hidden" name="domainId" value={product.id} />

          <section className="admin-form-section">
            <h2>بيانات المنتج</h2>
            <label htmlFor="product-name-ar">
              الاسم العربي
              <input
                id="product-name-ar"
                name="nameAr"
                required
                defaultValue={product.nameAr}
              />
            </label>
            <label htmlFor="product-latin-name">
              الاسم اللاتيني اختياري
              <input
                id="product-latin-name"
                name="latinName"
                dir="ltr"
                defaultValue={product.latinName ?? ""}
              />
            </label>
            <div className="admin-field-grid">
              <label htmlFor="product-price">
                السعر بالشيكل
                <input
                  id="product-price"
                  name="priceIls"
                  inputMode="decimal"
                  required
                  dir="ltr"
                  defaultValue={formatAgorotAsIlsInput(product.priceAgorot)}
                />
              </label>
              <label htmlFor="product-category">
                الفئة
                <select
                  id="product-category"
                  name="categoryId"
                  defaultValue={product.categoryId}
                >
                  <CategoryOptions />
                </select>
              </label>
              <label htmlFor="product-availability">
                التوفر
                <select
                  id="product-availability"
                  name="availability"
                  defaultValue={product.availability}
                >
                  <option value="available">متاح</option>
                  <option value="unavailable">غير متاح</option>
                </select>
              </label>
              <label htmlFor="product-sort">
                ترتيب العرض
                <input
                  id="product-sort"
                  name="sortOrder"
                  type="number"
                  min={0}
                  required
                  defaultValue={sortOrder}
                />
              </label>
            </div>
          </section>

          <details className="admin-disclosure">
            <summary>الوصف وملاحظات الاستخدام</summary>
            <label htmlFor="product-description">
              الوصف المعتمد
              <textarea
                id="product-description"
                name="description"
                rows={4}
                defaultValue={product.description ?? ""}
              />
            </label>
            <label htmlFor="product-usage">
              ملاحظات الاستخدام المعتمدة
              <textarea
                id="product-usage"
                name="usageNotes"
                rows={4}
                defaultValue={product.usageNotes ?? ""}
              />
            </label>
            <label htmlFor="product-unit">
              الوحدة
              <input
                id="product-unit"
                name="unit"
                defaultValue={product.unit ?? ""}
              />
            </label>
          </details>

          <details className="admin-disclosure">
            <summary>حالة التفاصيل والصورة المؤقتة</summary>
            <label htmlFor="product-details-status">
              حالة التفاصيل
              <select
                id="product-details-status"
                name="detailsStatus"
                defaultValue={product.detailsStatus}
              >
                <option value="placeholder">أولية</option>
                <option value="verified">معتمدة</option>
              </select>
            </label>
            <label htmlFor="product-placeholder">
              شكل الصورة المؤقتة
              <select
                id="product-placeholder"
                name="placeholderVariant"
                defaultValue={placeholderVariant}
              >
                <PlaceholderOptions />
              </select>
            </label>
          </details>

          <FieldError message={state?.message} />
          <button type="submit" disabled={pending}>
            {pending ? "جارٍ الحفظ…" : "حفظ المنتج"}
          </button>
        </form>
      </div>

      <div
        id="panel-variants"
        role="tabpanel"
        aria-labelledby="tab-variants"
        hidden={tab !== "variants"}
      >
        <section className="admin-variant-list" aria-label="خيارات المنتج">
          <h2>خيارات المنتج</h2>
          <p className="admin-muted">
            كل خيار له تسمية وسعر وتوفر وصورة مستقلة. الخيار الافتراضي لا يمكن
            تعطيله.
          </p>
          {product.variants.map((variant) => (
            <VariantEditor
              key={variant.id}
              productId={product.id}
              variant={variant}
              onDirty={markDirty}
            />
          ))}
          <VariantEditor productId={product.id} onDirty={markDirty} />
        </section>
      </div>

      <div
        id="panel-specs"
        role="tabpanel"
        aria-labelledby="tab-specs"
        hidden={tab !== "specs"}
      >
        <section className="admin-spec-list" aria-label="تفاصيل المنتج">
          <h2>تفاصيل المنتج</h2>
          {product.specifications.length > 0 ? (
            <details className="admin-disclosure">
              <summary>
                عرض التفاصيل الحالية ({product.specifications.length})
              </summary>
              {product.specifications.map((specification) => (
                <SpecificationEditor
                  key={specification.id}
                  productId={product.id}
                  specification={specification}
                  nextSortOrder={product.specifications.length}
                  onDirty={markDirty}
                />
              ))}
            </details>
          ) : (
            <p className="admin-muted">لا توجد تفاصيل بعد.</p>
          )}
          <SpecificationEditor
            productId={product.id}
            nextSortOrder={product.specifications.length}
            onDirty={markDirty}
          />
        </section>
      </div>
    </div>
  );
}

export function ProductForm({
  product,
  sortOrder,
}: {
  product: Product;
  sortOrder: number;
  mode?: "edit";
}) {
  const [dirty, setDirty] = useState(false);
  return (
    <EditProductForm
      product={product}
      sortOrder={sortOrder}
      dirty={dirty}
      setDirty={setDirty}
    />
  );
}
