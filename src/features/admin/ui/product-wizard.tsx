"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Plus, X } from "lucide-react";

import { applyOptionPlanAction } from "@/features/admin/application/product-media-actions";
import {
  createWizardDraftAction,
  type WizardDraftState,
} from "@/features/admin/application/product-wizard-actions";
import {
  allCombinations,
  combinationId,
  combinationText,
  MAX_PLANNED_OPTIONS,
  optionPresets,
  optionShapes,
  optionsForShape,
  planProblem,
  withValue,
  type OptionShape,
  type PlannedOption,
} from "@/features/admin/domain/option-plan";
import {
  wizardStepHref,
  wizardSteps,
} from "@/features/admin/domain/product-wizard-steps";
import { CategoryOptions } from "@/features/admin/ui/admin-categories";
import { ProductDraft } from "@/features/admin/ui/product-draft";

export function WizardProgress({
  current,
  productId,
}: {
  current: number;
  productId: string | null;
}) {
  return (
    <ol
      className="admin-steps admin-wizard-steps"
      aria-label="خطوات إضافة المنتج"
    >
      {wizardSteps.map((step) => {
        const href =
          step.id === current ? null : wizardStepHref(step.id, productId);
        const content = (
          <>
            <span className="admin-step-number" aria-hidden="true">
              {step.id < current ? <Check size={14} /> : step.id}
            </span>
            {step.label}
          </>
        );
        return (
          <li key={step.id}>
            {href ? (
              <Link href={href} prefetch={false} className="admin-step-link">
                {content}
              </Link>
            ) : (
              <span
                className={
                  step.id === current
                    ? "admin-step-link is-current"
                    : "admin-step-link is-locked"
                }
                aria-current={step.id === current ? "step" : undefined}
                aria-disabled={step.id === current ? undefined : true}
              >
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}

export function BasicInfoStep() {
  const [state, action, pending] = useActionState<WizardDraftState, FormData>(
    createWizardDraftAction,
    null,
  );
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useLeaveWarning(dirty && !pending);

  // The first invalid field takes focus, and every typed value stays in place.
  useEffect(() => {
    if (!state?.field) return;
    formRef.current
      ?.querySelector<HTMLElement>(`[name="${state.field}"]`)
      ?.focus();
  }, [state]);

  const invalid = (field: string, hint?: string) => {
    const describedBy = [hint, state?.field === field ? "wizard-error" : null]
      .filter(Boolean)
      .join(" ");
    return {
      ...(state?.field === field ? { "aria-invalid": true } : {}),
      ...(describedBy ? { "aria-describedby": describedBy } : {}),
    };
  };

  return (
    <ProductDraft>
      <form
        ref={formRef}
        className="admin-form admin-panel admin-wizard-form"
        // Dispatched by hand: a <form action> clears every field afterwards, losing the owner's
        // typing whenever the server refuses a value.
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setDirty(false);
          startTransition(() => action(data));
        }}
        onInput={() => setDirty(true)}
        noValidate
        aria-labelledby="wizard-basic-title"
      >
        <h2 id="wizard-basic-title">المعلومات الأساسية</h2>
        <label>
          <span>اسم المنتج بالعربية</span>
          <input
            name="nameAr"
            maxLength={160}
            autoComplete="off"
            {...invalid("nameAr")}
          />
        </label>
        <label>
          <span>القسم</span>
          <select name="categoryId" defaultValue="" {...invalid("categoryId")}>
            <option value="" disabled>
              اختاري القسم
            </option>
            <CategoryOptions />
          </select>
        </label>
        <label>
          <span>سعر البيع ₪</span>
          <input
            name="priceIls"
            inputMode="decimal"
            dir="ltr"
            placeholder="12.50"
            {...invalid("priceIls", "wizard-price-hint")}
          />
        </label>
        <small id="wizard-price-hint" className="admin-muted">
          يُستخدم لكل الأصناف في البداية، ويمكن تغييره لكل صنف لاحقاً.
        </small>
        <label>
          <span>وصف قصير (اختياري)</span>
          <textarea name="description" rows={3} maxLength={4000} />
        </label>
        <details className="admin-disclosure">
          <summary>الاسم باللاتينية (اختياري)</summary>
          <label>
            <span>الاسم اللاتيني</span>
            <input
              name="latinName"
              dir="ltr"
              maxLength={120}
              {...invalid("latinName", "wizard-latin-hint")}
            />
          </label>
          <small id="wizard-latin-hint" className="admin-muted">
            يساعد على تمييز منتجين بنفس الاسم العربي.
          </small>
        </details>
        <p className="admin-muted">
          الصور تُضاف في خطوة «الصور» بعد تحديد الروائح والأحجام، لتُربط كل صورة
          بخيارها.
        </p>
        {state ? (
          <p id="wizard-error" className="admin-form-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <div className="admin-wizard-actions">
          <button
            type="submit"
            className="admin-btn admin-btn-primary"
            disabled={pending}
          >
            {pending ? "جارٍ حفظ المسودة…" : "التالي: الخيارات والمخزون"}
          </button>
          <Link
            href="/admin/products/new/photo"
            prefetch={false}
            className="admin-btn admin-btn-ghost"
          >
            أو اقرئي البيانات من صورة المنتج
          </Link>
        </div>
      </form>
    </ProductDraft>
  );
}

export function SavedBasics({
  productId,
  nameAr,
  category,
  price,
  savedAt,
}: {
  productId: string;
  nameAr: string;
  category: string;
  price: string;
  savedAt: string;
}) {
  return (
    <section
      className="admin-panel admin-wizard-saved"
      aria-labelledby="wizard-saved-title"
    >
      <h2 id="wizard-saved-title">المعلومات الأساسية</h2>
      <dl className="admin-definition-list">
        <dt>الاسم</dt>
        <dd>{nameAr}</dd>
        <dt>القسم</dt>
        <dd>{category}</dd>
        <dt>السعر</dt>
        <dd>{price}</dd>
      </dl>
      <p className="admin-muted" role="status">
        محفوظ كمسودة · آخر حفظ {savedAt}
      </p>
      <div className="admin-wizard-actions">
        <Link
          href={`/admin/products/new?product=${productId}&step=2`}
          prefetch={false}
          className="admin-btn admin-btn-primary"
        >
          التالي: الخيارات والمخزون
        </Link>
        <Link
          href={`/admin/products/${productId}#overview`}
          prefetch={false}
          className="admin-btn admin-btn-secondary"
        >
          تعديل المعلومات
        </Link>
      </div>
    </section>
  );
}

function OptionEditor({
  option,
  onChange,
  onRemove,
}: {
  option: PlannedOption;
  onChange: (next: PlannedOption) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    onChange(
      draft
        .split(/[،,\n]/)
        .reduce((next, part) => withValue(next, part), option),
    );
    setDraft("");
  };
  return (
    <fieldset className="admin-wizard-option">
      <legend className="sr-only">{option.nameAr || "خيار جديد"}</legend>
      <div className="admin-wizard-option-head">
        <label>
          <span>اسم الخيار</span>
          <input
            value={option.nameAr}
            maxLength={40}
            onChange={(event) =>
              onChange({ ...option, nameAr: event.target.value })
            }
          />
        </label>
        <button
          type="button"
          className="admin-icon-btn"
          aria-label={`حذف خيار ${option.nameAr || "جديد"}`}
          onClick={onRemove}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {option.values.length ? (
        <ul className="admin-chip-list" aria-label={`قيم ${option.nameAr}`}>
          {option.values.map((value) => (
            <li key={value}>
              <span>{value}</span>
              <button
                type="button"
                aria-label={`إزالة ${value}`}
                onClick={() =>
                  onChange({
                    ...option,
                    values: option.values.filter((item) => item !== value),
                  })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="admin-wizard-value-row">
        <label>
          <span>{`أضيفي قيمة لـ ${option.nameAr || "الخيار"}`}</span>
          <input
            value={draft}
            maxLength={200}
            placeholder={
              option.kind === "fragrance"
                ? "لافندر، الورد الأبيض"
                : option.kind === "size"
                  ? "750 مل، 1 لتر"
                  : option.kind === "color"
                    ? "أزرق، أخضر"
                    : "اكتبي القيمة"
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={add}
        >
          <Plus size={18} aria-hidden="true" /> إضافة
        </button>
      </div>
    </fieldset>
  );
}

export function OptionsStep({
  productId,
  priceLabel,
}: {
  productId: string;
  priceLabel: string;
}) {
  const router = useRouter();
  const [shape, setShape] = useState<OptionShape | null>(null);
  const [options, setOptions] = useState<PlannedOption[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  useLeaveWarning(options.some((option) => option.values.length) && !pending);

  const combinations = useMemo(() => allCombinations(options), [options]);
  const selected = combinations.filter(
    (combination) => !excluded.has(combinationId(combination)),
  );
  const imagesHref = wizardStepHref(3, productId)!;

  const choose = (next: OptionShape) => {
    setShape(next);
    setOptions(optionsForShape(next));
    setExcluded(new Set());
    setMessage(null);
  };

  const submit = () => {
    if (shape === "single") {
      router.push(imagesHref);
      return;
    }
    const problem = planProblem(options, selected);
    if (problem) {
      setMessage(problem);
      return;
    }
    setPending(true);
    setMessage(null);
    startTransition(async () => {
      const result = await applyOptionPlanAction({
        productDomainId: productId,
        idempotencyKey: key,
        plan: {
          options: options.map(({ nameAr, kind, values }) => ({
            nameAr: nameAr.trim(),
            kind,
            values,
          })),
          combinations: selected,
        },
      });
      if (result.ok) {
        router.push(imagesHref);
        return;
      }
      setPending(false);
      setMessage(result.message);
    });
  };

  const unusedPresets = optionPresets.filter(
    (preset) => !options.some((option) => option.kind === preset.kind),
  );

  return (
    <section
      className="admin-panel admin-wizard-form"
      aria-labelledby="wizard-options-title"
    >
      <h2 id="wizard-options-title">
        هل لهذا المنتج روائح، أحجام أو ألوان مختلفة؟
      </h2>
      <div
        className="admin-wizard-shapes"
        role="radiogroup"
        aria-label="نوع المنتج"
      >
        {optionShapes.map((item) => (
          <label key={item.id} className="admin-check">
            <input
              type="radio"
              name="shape"
              checked={shape === item.id}
              onChange={() => choose(item.id)}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>

      {shape && shape !== "single" ? (
        <>
          {options.map((option, index) => (
            <OptionEditor
              key={option.key}
              option={option}
              onChange={(next) =>
                setOptions(
                  options.map((item, at) => (at === index ? next : item)),
                )
              }
              onRemove={() =>
                setOptions(options.filter((_, at) => at !== index))
              }
            />
          ))}
          {options.length < MAX_PLANNED_OPTIONS ? (
            <div className="admin-wizard-presets" aria-label="إضافة نوع خيار">
              {unusedPresets.map((preset) => (
                <button
                  key={preset.kind}
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() =>
                    setOptions([
                      ...options,
                      {
                        key: preset.kind,
                        nameAr: preset.nameAr,
                        kind: preset.kind,
                        values: [],
                      },
                    ])
                  }
                >
                  <Plus size={18} aria-hidden="true" /> {preset.nameAr}
                </button>
              ))}
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() =>
                  setOptions([
                    ...options,
                    {
                      key: crypto.randomUUID(),
                      nameAr: "",
                      kind: "other",
                      values: [],
                    },
                  ])
                }
              >
                <Plus size={18} aria-hidden="true" /> خيار آخر
              </button>
            </div>
          ) : null}

          {combinations.length ? (
            <fieldset className="admin-check-group admin-wizard-combinations">
              <legend>
                الأصناف التي ستُنشأ ({selected.length} من {combinations.length})
              </legend>
              <p className="admin-muted">
                أزيلي العلامة عن أي صنف غير موجود فعلاً. كل صنف يبدأ بسعر{" "}
                {priceLabel}، وتُعدَّل الأسعار والمخزون لكل صنف في خطوة «الأسعار
                والمخزون».
              </p>
              {combinations.map((combination) => {
                const id = combinationId(combination);
                return (
                  <label key={id} className="admin-check">
                    <input
                      type="checkbox"
                      checked={!excluded.has(id)}
                      onChange={(event) => {
                        const next = new Set(excluded);
                        if (event.target.checked) next.delete(id);
                        else next.add(id);
                        setExcluded(next);
                      }}
                    />
                    <span>{combinationText(combination)}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
        </>
      ) : null}

      {shape === "single" ? (
        <p className="admin-muted">
          سيبقى للمنتج صنف واحد. يمكنك إضافة روائح أو أحجام لاحقاً من قسم
          «الخيارات والأصناف».
        </p>
      ) : null}

      {message ? (
        <p className="admin-form-error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="admin-wizard-actions">
        <button
          type="button"
          className="admin-btn admin-btn-primary"
          disabled={!shape || pending}
          onClick={submit}
        >
          {pending ? "جارٍ إنشاء الأصناف…" : "التالي: الصور"}
        </button>
        <Link
          href={`/admin/products/new?product=${productId}&step=1`}
          prefetch={false}
          className="admin-btn admin-btn-secondary"
        >
          السابق
        </Link>
      </div>
    </section>
  );
}

export function ConfiguredOptions({
  productId,
  options,
  variantCount,
}: {
  productId: string;
  options: Array<{ nameAr: string; values: string[] }>;
  variantCount: number;
}) {
  return (
    <section
      className="admin-panel admin-wizard-form"
      aria-labelledby="wizard-configured-title"
    >
      <h2 id="wizard-configured-title">الخيارات والأصناف</h2>
      {options.length ? (
        <dl className="admin-definition-list">
          {options.map((option) => (
            <div key={option.nameAr}>
              <dt>{option.nameAr}</dt>
              <dd>{option.values.join("، ")}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="admin-muted">
        للمنتج {variantCount} صنف. التعديل من قسم «الخيارات والأصناف» في صفحة
        المنتج.
      </p>
      <div className="admin-wizard-actions">
        <Link
          href={wizardStepHref(3, productId)!}
          prefetch={false}
          className="admin-btn admin-btn-primary"
        >
          التالي: الصور
        </Link>
        <Link
          href={`/admin/products/${productId}#variants`}
          prefetch={false}
          className="admin-btn admin-btn-secondary"
        >
          تعديل الخيارات والأصناف
        </Link>
      </div>
    </section>
  );
}
