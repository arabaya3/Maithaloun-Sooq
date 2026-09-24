"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";

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

function deriveProductId(
  nameAr: string,
  latinName: string,
  fallbackId: string,
): string {
  const latinSource = latinName.trim().toLowerCase();
  const latinSlug = latinSource
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (latinSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(latinSlug)) {
    return latinSlug;
  }

  const fromName = nameAr
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (fromName && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fromName)) {
    return fromName;
  }

  return fallbackId;
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

function CategoryOptions() {
  return (
    <>
      {categories
        .filter((category) => category.id !== "all")
        .map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
    </>
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

function IdentityFields({
  domainId,
  slug,
  submitNames,
  onDomainIdChange,
  onSlugChange,
  onManualEdit,
}: {
  domainId: string;
  slug: string;
  submitNames: boolean;
  onDomainIdChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onManualEdit: () => void;
}) {
  return (
    <div className="admin-field-grid">
      <label htmlFor="product-domain-id">
        معرّف المنتج
        <input
          id="product-domain-id"
          name={submitNames ? "domainId" : undefined}
          required={submitNames}
          dir="ltr"
          value={domainId}
          onChange={(event) => {
            onManualEdit();
            onDomainIdChange(event.target.value);
          }}
        />
      </label>
      <label htmlFor="product-slug">
        الرابط
        <input
          id="product-slug"
          name={submitNames ? "slug" : undefined}
          required={submitNames}
          dir="ltr"
          value={slug}
          onChange={(event) => {
            onManualEdit();
            onSlugChange(event.target.value);
          }}
        />
      </label>
    </div>
  );
}

function CreateQuickForm({
  sortOrder,
  dirty,
  setDirty,
}: {
  sortOrder: number;
  dirty: boolean;
  setDirty: (value: boolean) => void;
}) {
  const [state, formAction, pending] = useAdminFormAction(createProductAction);
  const [nameAr, setNameAr] = useState("");
  const [latinName, setLatinName] = useState("");
  const [fallbackId] = useState(() =>
    `product-${Date.now().toString(36)}`.slice(0, 80),
  );
  const [domainId, setDomainId] = useState(fallbackId);
  const [slug, setSlug] = useState(fallbackId);
  const [idManual, setIdManual] = useState(false);

  const syncIds = useCallback(
    (nextName: string, nextLatin: string) => {
      if (idManual) return;
      const derived = deriveProductId(nextName, nextLatin, fallbackId);
      setDomainId(derived);
      setSlug(derived);
    },
    [fallbackId, idManual],
  );

  useUnsavedChangesWarning(dirty);

  return (
    <form
      className="admin-form admin-product-quick"
      action={formAction}
      noValidate
      onInput={(event) => markDirtyFromEvent(event, setDirty)}
      onChange={(event) => markDirtyFromEvent(event, setDirty)}
    >
      <input type="hidden" name="sortOrder" value={sortOrder} />
      <input type="hidden" name="detailsStatus" value="placeholder" />
      <input type="hidden" name="placeholderVariant" value="general-cleaner" />

      <label htmlFor="product-name-ar">
        الاسم العربي
        <input
          id="product-name-ar"
          name="nameAr"
          required
          value={nameAr}
          onChange={(event) => {
            const value = event.target.value;
            setNameAr(value);
            syncIds(value, latinName);
          }}
        />
      </label>

      <label htmlFor="product-category">
        الفئة
        <select id="product-category" name="categoryId" defaultValue="home">
          <CategoryOptions />
        </select>
      </label>

      <label htmlFor="product-price">
        السعر بالشيكل
        <input
          id="product-price"
          name="priceIls"
          inputMode="decimal"
          required
          dir="ltr"
        />
      </label>

      <div className="admin-note" role="note">
        <p className="admin-muted">
          التوفر: المنتج الجديد يُحفظ غير متاح حتى مراجعته، مع خيار افتراضي
          `--default`.
        </p>
      </div>

      <label htmlFor="product-description">
        وصف قصير (اختياري)
        <textarea id="product-description" name="description" rows={3} />
      </label>

      <details className="admin-disclosure">
        <summary>معرّف الرابط والاسم اللاتيني</summary>
        <label htmlFor="product-latin-name">
          الاسم اللاتيني (اختياري — يُفضَّل لاشتقاق المعرّف)
          <input
            id="product-latin-name"
            name="latinName"
            dir="ltr"
            value={latinName}
            onChange={(event) => {
              const value = event.target.value;
              setLatinName(value);
              syncIds(nameAr, value);
            }}
          />
        </label>
        <IdentityFields
          domainId={domainId}
          slug={slug}
          submitNames
          onDomainIdChange={setDomainId}
          onSlugChange={setSlug}
          onManualEdit={() => setIdManual(true)}
        />
        <p className="admin-muted">
          يُشتق المعرّف والرابط تلقائياً. عدّلهما يدوياً عند الحاجة.
        </p>
      </details>

      <FieldError message={state?.message} />
      <button type="submit" disabled={pending}>
        {pending ? "جارٍ الحفظ…" : "إنشاء المنتج"}
      </button>
    </form>
  );
}

const WIZARD_STEPS = [
  { id: 1, label: "الأساسيات" },
  { id: 2, label: "الأحجام" },
  { id: 3, label: "الصورة" },
  { id: 4, label: "المراجعة" },
] as const;

function CreateWizardForm({
  sortOrder,
  dirty,
  setDirty,
}: {
  sortOrder: number;
  dirty: boolean;
  setDirty: (value: boolean) => void;
}) {
  const [state, formAction, pending] = useAdminFormAction(createProductAction);
  const [step, setStep] = useState(1);
  const [nameAr, setNameAr] = useState("");
  const [latinName, setLatinName] = useState("");
  const [fallbackId] = useState(() =>
    `product-${Date.now().toString(36)}`.slice(0, 80),
  );
  const [domainId, setDomainId] = useState(fallbackId);
  const [slug, setSlug] = useState(fallbackId);
  const [idManual, setIdManual] = useState(false);
  const [categoryId, setCategoryId] = useState("home");
  const [priceIls, setPriceIls] = useState("");
  const [description, setDescription] = useState("");
  const [usageNotes, setUsageNotes] = useState("");
  const [unit, setUnit] = useState("");
  const [detailsStatus, setDetailsStatus] = useState("placeholder");
  const [placeholderVariant, setPlaceholderVariant] =
    useState("general-cleaner");
  const [sortOrderValue, setSortOrderValue] = useState(sortOrder);
  const [specsOpen, setSpecsOpen] = useState(false);

  const syncIds = useCallback(
    (nextName: string, nextLatin: string) => {
      if (idManual) return;
      const derived = deriveProductId(nextName, nextLatin, fallbackId);
      setDomainId(derived);
      setSlug(derived);
    },
    [fallbackId, idManual],
  );

  useUnsavedChangesWarning(dirty);

  const canGoNext = () => {
    if (step === 1) {
      return (
        nameAr.trim().length > 0 &&
        priceIls.trim().length > 0 &&
        domainId.trim().length > 0 &&
        slug.trim().length > 0
      );
    }
    return true;
  };

  return (
    <div className="admin-wizard">
      <ol className="admin-wizard-steps" aria-label="خطوات إنشاء المنتج">
        {WIZARD_STEPS.map((item) => (
          <li
            key={item.id}
            className={
              item.id === step
                ? "admin-wizard-step is-current"
                : item.id < step
                  ? "admin-wizard-step is-done"
                  : "admin-wizard-step"
            }
          >
            <span aria-hidden="true">{item.id}</span>
            {item.label}
          </li>
        ))}
      </ol>

      <form
        className="admin-form"
        action={formAction}
        noValidate
        onInput={(event) => markDirtyFromEvent(event, setDirty)}
        onChange={(event) => markDirtyFromEvent(event, setDirty)}
      >
        <input type="hidden" name="domainId" value={domainId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="nameAr" value={nameAr} />
        <input type="hidden" name="latinName" value={latinName} />
        <input type="hidden" name="categoryId" value={categoryId} />
        <input type="hidden" name="priceIls" value={priceIls} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="usageNotes" value={usageNotes} />
        <input type="hidden" name="unit" value={unit} />
        <input type="hidden" name="detailsStatus" value={detailsStatus} />
        <input
          type="hidden"
          name="placeholderVariant"
          value={placeholderVariant}
        />
        <input type="hidden" name="sortOrder" value={sortOrderValue} />

        {step === 1 ? (
          <section className="admin-form-section" aria-labelledby="wiz-step-1">
            <h2 id="wiz-step-1">المعلومات الأساسية</h2>
            <label htmlFor="wiz-name-ar">
              الاسم العربي
              <input
                id="wiz-name-ar"
                required
                value={nameAr}
                onChange={(event) => {
                  const value = event.target.value;
                  setNameAr(value);
                  syncIds(value, latinName);
                }}
              />
            </label>
            <label htmlFor="wiz-category">
              الفئة
              <select
                id="wiz-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <CategoryOptions />
              </select>
            </label>
            <label htmlFor="wiz-price">
              السعر الأساسي بالشيكل
              <input
                id="wiz-price"
                inputMode="decimal"
                required
                dir="ltr"
                value={priceIls}
                onChange={(event) => setPriceIls(event.target.value)}
              />
            </label>
            <label htmlFor="wiz-description">
              وصف قصير (اختياري)
              <textarea
                id="wiz-description"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <div className="admin-note" role="note">
              <p className="admin-muted">
                التوفر: يُحفظ المنتج غير متاح حتى مراجعته.
              </p>
            </div>
            <details className="admin-disclosure" open>
              <summary>معرّف الرابط والاسم اللاتيني</summary>
              <label htmlFor="wiz-latin">
                الاسم اللاتيني (اختياري)
                <input
                  id="wiz-latin"
                  dir="ltr"
                  value={latinName}
                  onChange={(event) => {
                    const value = event.target.value;
                    setLatinName(value);
                    syncIds(nameAr, value);
                  }}
                />
              </label>
              <IdentityFields
                domainId={domainId}
                slug={slug}
                submitNames={false}
                onDomainIdChange={setDomainId}
                onSlugChange={setSlug}
                onManualEdit={() => setIdManual(true)}
              />
            </details>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="admin-form-section" aria-labelledby="wiz-step-2">
            <h2 id="wiz-step-2">الأحجام والأوزان</h2>
            <p className="admin-muted">
              عند الإنشاء يُنشأ خيار افتراضي واحد غير متاح. أضف بقية الأحجام من
              صفحة التعديل بعد الحفظ.
            </p>
            <label htmlFor="wiz-unit">
              تسمية الحجم الافتراضي (اختياري)
              <input
                id="wiz-unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="مثل: ١ لتر"
              />
            </label>
            <label htmlFor="wiz-sort">
              ترتيب العرض
              <input
                id="wiz-sort"
                type="number"
                min={0}
                value={sortOrderValue}
                onChange={(event) =>
                  setSortOrderValue(Number(event.target.value) || 0)
                }
              />
            </label>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="admin-form-section" aria-labelledby="wiz-step-3">
            <h2 id="wiz-step-3">صورة المنتج</h2>
            <p className="admin-muted">
              لا يوجد رفع ملفات هنا — اختر شكلاً مؤقتاً أو عيّن المسار لاحقاً
              عبر الخيارات.
            </p>
            <label htmlFor="wiz-placeholder">
              الشكل المؤقت
              <select
                id="wiz-placeholder"
                value={placeholderVariant}
                onChange={(event) => setPlaceholderVariant(event.target.value)}
              >
                <PlaceholderOptions />
              </select>
            </label>
            <label htmlFor="wiz-details-status">
              حالة التفاصيل
              <select
                id="wiz-details-status"
                value={detailsStatus}
                onChange={(event) => setDetailsStatus(event.target.value)}
              >
                <option value="placeholder">أولية</option>
                <option value="verified">معتمدة</option>
              </select>
            </label>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="admin-form-section" aria-labelledby="wiz-step-4">
            <h2 id="wiz-step-4">المراجعة</h2>
            <dl className="admin-definition-list">
              <div>
                <dt>الاسم</dt>
                <dd>{nameAr || "—"}</dd>
              </div>
              <div>
                <dt>الفئة</dt>
                <dd>
                  {categories.find((category) => category.id === categoryId)
                    ?.label ?? categoryId}
                </dd>
              </div>
              <div>
                <dt>السعر</dt>
                <dd dir="ltr">{priceIls ? `${priceIls} ₪` : "—"}</dd>
              </div>
              <div>
                <dt>المعرّف / الرابط</dt>
                <dd dir="ltr">
                  {domainId || "—"} / {slug || "—"}
                </dd>
              </div>
              <div>
                <dt>الحجم الافتراضي</dt>
                <dd>{unit || "الافتراضي"}</dd>
              </div>
              <div>
                <dt>الصورة المؤقتة</dt>
                <dd dir="ltr">{placeholderVariant}</dd>
              </div>
            </dl>

            <details
              className="admin-disclosure"
              open={specsOpen}
              onToggle={(event) =>
                setSpecsOpen((event.target as HTMLDetailsElement).open)
              }
            >
              <summary>مواصفات إضافية (اختياري — تُضاف بعد الإنشاء)</summary>
              <p className="admin-muted">
                مواصفات المنتج تُدار من صفحة التعديل بعد إنشاء المنتج.
              </p>
              <label htmlFor="wiz-usage">
                ملاحظات الاستخدام (اختياري)
                <textarea
                  id="wiz-usage"
                  rows={3}
                  value={usageNotes}
                  onChange={(event) => setUsageNotes(event.target.value)}
                />
              </label>
            </details>

            <div className="admin-note" role="note">
              <p className="admin-muted">
                بعد الإنشاء ستنتقل لصفحة التعديل لإضافة أحجام إضافية إن لزم.
              </p>
            </div>

            <FieldError message={state?.message} />
            <button type="submit" disabled={pending}>
              {pending ? "جارٍ الحفظ…" : "إنشاء المنتج"}
            </button>
          </section>
        ) : null}

        <div className="admin-wizard-nav">
          <button
            type="button"
            className="admin-button-secondary"
            disabled={step <= 1 || pending}
            onClick={() => setStep((current) => Math.max(1, current - 1))}
          >
            السابق
          </button>
          {step < 4 ? (
            <button
              type="button"
              disabled={!canGoNext() || pending}
              onClick={() => setStep((current) => Math.min(4, current + 1))}
            >
              التالي
            </button>
          ) : null}
        </div>
      </form>
    </div>
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
  mode,
}: {
  product?: Product;
  sortOrder: number;
  mode: "create" | "edit";
}) {
  const [dirty, setDirty] = useState(false);
  const [multiSize, setMultiSize] = useState(false);

  if (mode === "edit" && product) {
    return (
      <EditProductForm
        product={product}
        sortOrder={sortOrder}
        dirty={dirty}
        setDirty={setDirty}
      />
    );
  }

  return (
    <div className="admin-product-editor">
      <label className="admin-toggle">
        <input
          type="checkbox"
          checked={multiSize}
          onChange={(event) => setMultiSize(event.target.checked)}
        />
        <span>هذا المنتج له أكثر من حجم أو وزن</span>
      </label>

      {multiSize ? (
        <CreateWizardForm
          sortOrder={sortOrder}
          dirty={dirty}
          setDirty={setDirty}
        />
      ) : (
        <CreateQuickForm
          sortOrder={sortOrder}
          dirty={dirty}
          setDirty={setDirty}
        />
      )}
    </div>
  );
}
