"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createSellingUnitAction,
  sellingUnitStateAction,
  updateSellingUnitAction,
  type SellingUnitActionResult,
  type SellingUnitField,
} from "@/features/admin/application/selling-unit-actions";
import type {
  SellingUnitAdminView,
  VariantSellingUnits,
} from "@/features/admin/application/selling-unit-service";
import {
  deductionText,
  parseUnitsPerSale,
  presetLabel,
  sellingUnitMessages,
  sellingUnitPresets,
  stockInterpretation,
} from "@/features/catalog/domain/selling-unit";
import { formatIls } from "@/shared/lib/format-currency";
import { formatAgorotAsIlsInput } from "@/shared/lib/parse-ils";

interface Fields {
  labelAr: string;
  unitsPerSale: string;
  price: string;
  sku: string;
  barcode: string;
}

type Feedback = {
  tone: "ok" | "error";
  text: string;
  field?: SellingUnitField;
};

const emptyFields: Fields = {
  labelAr: "",
  unitsPerSale: "",
  price: "",
  sku: "",
  barcode: "",
};

function fieldsOf(unit: SellingUnitAdminView): Fields {
  return {
    labelAr: unit.labelAr,
    unitsPerSale: String(unit.unitsPerSale),
    price: formatAgorotAsIlsInput(unit.priceAgorot),
    sku: unit.sku ?? "",
    barcode: unit.barcode ?? "",
  };
}

function FieldInputs({
  fields,
  onChange,
  idPrefix,
  invalid,
  lockUnits = false,
}: {
  fields: Fields;
  onChange: (next: Fields) => void;
  idPrefix: string;
  invalid?: SellingUnitField;
  lockUnits?: boolean;
}) {
  const set = (key: keyof Fields) => (value: string) =>
    onChange({ ...fields, [key]: value });
  return (
    <div className="admin-field-grid">
      <label>
        <span>اسم طريقة البيع</span>
        <input
          id={`${idPrefix}-label`}
          value={fields.labelAr}
          maxLength={60}
          placeholder="باكيج 3 حبات"
          aria-invalid={invalid === "labelAr" || undefined}
          onChange={(event) => set("labelAr")(event.target.value)}
        />
      </label>
      <label>
        <span>عدد الحبات التي تُخصم من المخزون</span>
        <input
          id={`${idPrefix}-units`}
          value={fields.unitsPerSale}
          inputMode="numeric"
          dir="ltr"
          readOnly={lockUnits}
          aria-describedby={lockUnits ? `${idPrefix}-units-note` : undefined}
          aria-invalid={invalid === "unitsPerSale" || undefined}
          onChange={(event) => set("unitsPerSale")(event.target.value)}
        />
        {lockUnits ? (
          <small id={`${idPrefix}-units-note`} className="admin-muted">
            طريقة البيع الأساسية حبة واحدة دائماً، وسعرها هو سعر الصنف.
          </small>
        ) : null}
      </label>
      <label>
        <span>سعر البيع ₪</span>
        <input
          id={`${idPrefix}-price`}
          value={fields.price}
          inputMode="decimal"
          dir="ltr"
          placeholder="10"
          aria-invalid={invalid === "price" || undefined}
          onChange={(event) => set("price")(event.target.value)}
        />
      </label>
      <label>
        <span>SKU (اختياري)</span>
        <input
          id={`${idPrefix}-sku`}
          value={fields.sku}
          maxLength={64}
          dir="ltr"
          aria-invalid={invalid === "sku" || undefined}
          onChange={(event) => set("sku")(event.target.value)}
        />
      </label>
      <label>
        <span>الباركود (اختياري)</span>
        <input
          id={`${idPrefix}-barcode`}
          value={fields.barcode}
          maxLength={64}
          dir="ltr"
          inputMode="numeric"
          aria-invalid={invalid === "barcode" || undefined}
          onChange={(event) => set("barcode")(event.target.value)}
        />
      </label>
    </div>
  );
}

function Preview({
  fields,
  freeBaseMilli,
}: {
  fields: Fields;
  freeBaseMilli: number | null;
}) {
  const units = parseUnitsPerSale(fields.unitsPerSale);
  const label = fields.labelAr.trim() || "طريقة البيع";
  if (fields.unitsPerSale.trim() && units === null) {
    return (
      <p className="admin-media-message" data-tone="error" role="alert">
        {sellingUnitMessages.unitsPerSale}
      </p>
    );
  }
  if (!units) return null;
  return (
    <p className="admin-muted selling-unit-preview" aria-live="polite">
      {deductionText(label, units)}{" "}
      {stockInterpretation(freeBaseMilli, label, units)}
    </p>
  );
}

function UnitRow({
  productDomainId,
  unit,
  freeBaseMilli,
  pending,
  act,
}: {
  productDomainId: string;
  unit: SellingUnitAdminView;
  freeBaseMilli: number | null;
  pending: boolean;
  act: (
    task: () => Promise<SellingUnitActionResult>,
    success: string,
    onFail?: (result: Extract<SellingUnitActionResult, { ok: false }>) => void,
  ) => void;
}) {
  const [fields, setFields] = useState(() => fieldsOf(unit));
  const [invalid, setInvalid] = useState<SellingUnitField | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const idPrefix = `unit-${unit.id}`;
  const state = (action: "default" | "archive" | "restore" | "delete") =>
    act(
      () =>
        sellingUnitStateAction({
          productDomainId,
          unitId: unit.id,
          version: unit.version,
          action,
        }),
      {
        default: "أصبحت هذه طريقة البيع الافتراضية.",
        archive: "أُرشفت طريقة البيع.",
        restore: "أُعيدت طريقة البيع.",
        delete: "حُذفت طريقة البيع نهائياً.",
      }[action],
    );

  return (
    <li
      className="admin-variant-card selling-unit-row"
      data-archived={unit.archived}
    >
      <p className="admin-variant-title">
        <strong>{unit.labelAr}</strong>
        {unit.isDefault ? (
          <span className="admin-badge">الافتراضية</span>
        ) : null}
        {unit.archived ? <span className="admin-badge">مؤرشفة</span> : null}
        <span className="admin-muted">
          {" "}
          {formatIls(unit.priceAgorot)} · يخصم {unit.unitsPerSale}
        </span>
      </p>
      {unit.archived ? null : (
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            setInvalid(undefined);
            act(
              () =>
                updateSellingUnitAction({
                  productDomainId,
                  unitId: unit.id,
                  version: unit.version,
                  ...fields,
                }),
              "تم حفظ طريقة البيع.",
              (result) => setInvalid(result.field),
            );
          }}
        >
          <FieldInputs
            fields={fields}
            onChange={setFields}
            idPrefix={idPrefix}
            invalid={invalid}
            lockUnits={unit.mirrorsVariant}
          />
          <Preview fields={fields} freeBaseMilli={freeBaseMilli} />
          <div className="admin-form-actions">
            <button type="submit" className="admin-btn" disabled={pending}>
              حفظ
            </button>
            {!unit.isDefault ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={pending}
                onClick={() => state("default")}
              >
                اجعلها الافتراضية
              </button>
            ) : null}
            {!unit.isDefault ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={pending}
                onClick={() => state("archive")}
              >
                أرشفة
              </button>
            ) : null}
          </div>
        </form>
      )}
      {unit.archived ? (
        <div className="admin-form-actions">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={pending}
            onClick={() => state("restore")}
          >
            استعادة
          </button>
          {unit.references === 0 ? (
            confirmDelete ? (
              <>
                <button
                  type="button"
                  className="admin-btn admin-btn-danger"
                  disabled={pending}
                  onClick={() => state("delete")}
                >
                  تأكيد الحذف النهائي
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  تراجع
                </button>
              </>
            ) : (
              <button
                type="button"
                className="admin-btn admin-btn-ghost"
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                حذف نهائي
              </button>
            )
          ) : (
            <small className="admin-muted">{sellingUnitMessages.inUse}</small>
          )}
        </div>
      ) : null}
    </li>
  );
}

function AddUnitForm({
  productDomainId,
  variant,
  pending,
  act,
}: {
  productDomainId: string;
  variant: VariantSellingUnits;
  pending: boolean;
  act: (
    task: () => Promise<SellingUnitActionResult>,
    success: string,
    onFail?: (result: Extract<SellingUnitActionResult, { ok: false }>) => void,
    onOk?: () => void,
  ) => void;
}) {
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [isDefault, setIsDefault] = useState(false);
  const [invalid, setInvalid] = useState<SellingUnitField | undefined>();
  const idPrefix = `new-${variant.variantId}`;
  return (
    <form
      className="admin-form admin-media-form"
      aria-label={`إضافة طريقة بيع لـ ${variant.label}`}
      onSubmit={(event) => {
        event.preventDefault();
        setInvalid(undefined);
        act(
          () =>
            createSellingUnitAction({
              productDomainId,
              variantDomainId: variant.variantId,
              ...fields,
              isDefault,
            }),
          "تمت إضافة طريقة البيع.",
          (result) => setInvalid(result.field),
          () => {
            setFields(emptyFields);
            setIsDefault(false);
          },
        );
      }}
    >
      <p className="admin-muted">ابدأ من نموذج ثم عدّل الاسم والعدد والسعر:</p>
      <div className="admin-form-actions">
        {sellingUnitPresets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => {
              const units =
                preset.unitsPerSale ?? parseUnitsPerSale(fields.unitsPerSale);
              setFields({
                ...fields,
                labelAr: presetLabel(preset.labelAr, units),
                unitsPerSale: units ? String(units) : "",
              });
            }}
          >
            {preset.labelAr}
          </button>
        ))}
      </div>
      <FieldInputs
        fields={fields}
        onChange={setFields}
        idPrefix={idPrefix}
        invalid={invalid}
      />
      <label className="admin-choice">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
        />
        <span>اجعلها طريقة البيع الافتراضية</span>
      </label>
      <Preview fields={fields} freeBaseMilli={variant.freeBaseMilli} />
      <button type="submit" className="admin-btn" disabled={pending}>
        إضافة طريقة بيع
      </button>
    </form>
  );
}

// Owner editor: each exact variant lists how it can be bought. Stock is always counted in pieces.
export function SellingUnitsEditor({
  productDomainId,
  variants,
}: {
  productDomainId: string;
  variants: readonly VariantSellingUnits[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Feedback | null>(null);

  function act(
    task: () => Promise<SellingUnitActionResult>,
    success: string,
    onFail?: (result: Extract<SellingUnitActionResult, { ok: false }>) => void,
    onOk?: () => void,
  ) {
    startTransition(async () => {
      const result = await task().catch((): SellingUnitActionResult => ({
        ok: false,
        message: "تعذّر الحفظ. تحقق من الاتصال وحاول مرة أخرى.",
      }));
      if (result.ok) {
        setMessage({ tone: "ok", text: success });
        onOk?.();
        router.refresh();
      } else {
        setMessage({
          tone: "error",
          text: result.message,
          field: result.field,
        });
        onFail?.(result);
      }
    });
  }

  return (
    <section className="admin-panel" aria-labelledby="selling-units-title">
      <h2 id="selling-units-title">طرق البيع</h2>
      <p className="admin-muted">
        حدّد كيف يُشترى كل صنف: حبة واحدة، باكيج، كرتونة. المخزون يُعدّ دائماً
        بالحبة، وكل طريقة بيع تخصم عدد حباتها عند البيع.
      </p>
      {message ? (
        <p
          className="admin-media-message"
          data-tone={message.tone}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
      {variants.map((variant) => {
        const active = variant.units.filter((unit) => !unit.archived);
        return (
          <details
            key={variant.variantId}
            className="admin-media-section"
            open={variants.length === 1 || !active.length}
          >
            <summary>
              {variant.label} ({active.length})
              {!active.length ? (
                <span className="admin-badge"> بدون طريقة بيع</span>
              ) : null}
            </summary>
            {!active.length ? (
              <p className="admin-media-message" data-tone="error">
                {sellingUnitMessages.required}
              </p>
            ) : null}
            <p className="admin-muted">
              {variant.freeBaseMilli === null
                ? "هذا الصنف غير متتبَّع بالمخزون."
                : stockInterpretation(variant.freeBaseMilli, "حبة", 1)}
            </p>
            <ul className="admin-variant-cards">
              {variant.units.map((unit) => (
                <UnitRow
                  key={`${unit.id}:${unit.version}`}
                  productDomainId={productDomainId}
                  unit={unit}
                  freeBaseMilli={variant.freeBaseMilli}
                  pending={pending}
                  act={act}
                />
              ))}
            </ul>
            <AddUnitForm
              productDomainId={productDomainId}
              variant={variant}
              pending={pending}
              act={act}
            />
          </details>
        );
      })}
    </section>
  );
}
