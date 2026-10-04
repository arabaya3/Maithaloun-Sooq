"use client";

import { useActionState } from "react";

import {
  restoreVariantAction,
  setPublicationAction,
  updateVariantIdentifiersAction,
  type CatalogActionResult,
} from "@/features/admin/application/catalog-management-actions";

type Publication = "draft" | "published" | "hidden";

const publicationLabels: Record<Publication, string> = {
  draft: "مسودة — لا يظهر في المتجر",
  published: "منشور في المتجر",
  hidden: "مخفي من المتجر",
};

function ActionError({ state }: { state: CatalogActionResult }) {
  return state ? (
    <p className="admin-form-error" role="alert">
      {state.message}
    </p>
  ) : null;
}

function PublicationForm({
  domainId,
  publication,
  problems,
  placeholderImage,
}: {
  domainId: string;
  publication: Publication;
  problems: string[];
  placeholderImage: boolean;
}) {
  const [state, action, pending] = useActionState(setPublicationAction, null);
  return (
    <section
      className="admin-media-section"
      aria-labelledby="publication-title"
    >
      <h3 id="publication-title">حالة النشر</h3>
      <p>
        الحالة الحالية:{" "}
        <strong data-testid="publication-state">
          {publicationLabels[publication]}
        </strong>
      </p>
      {problems.length ? (
        <ul className="admin-note" role="note" aria-label="ما ينقص قبل النشر">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      <form action={action} className="admin-form admin-media-form">
        <input type="hidden" name="domainId" value={domainId} />
        <label>
          <span>الحالة الجديدة</span>
          <select name="publication" defaultValue={publication}>
            {(Object.keys(publicationLabels) as Publication[]).map((value) => (
              <option key={value} value={value}>
                {publicationLabels[value]}
              </option>
            ))}
          </select>
        </label>
        {placeholderImage ? (
          <label className="admin-toggle">
            <input type="checkbox" name="acceptPlaceholder" />
            <span>النشر بصورة مؤقتة (لا توجد صورة حقيقية بعد)</span>
          </label>
        ) : null}
        <button type="submit" className="admin-btn" disabled={pending}>
          حفظ حالة النشر
        </button>
        <ActionError state={state} />
      </form>
    </section>
  );
}

function IdentifierForm({
  productDomainId,
  variant,
}: {
  productDomainId: string;
  variant: { id: string; labelAr: string; sku?: string; barcode?: string };
}) {
  const [state, action, pending] = useActionState(
    updateVariantIdentifiersAction,
    null,
  );
  return (
    <form
      action={action}
      className="admin-form admin-media-form"
      aria-label={`رموز الصنف ${variant.labelAr}`}
    >
      <input type="hidden" name="productDomainId" value={productDomainId} />
      <input type="hidden" name="variantDomainId" value={variant.id} />
      <strong>{variant.labelAr}</strong>
      <label>
        <span>SKU</span>
        <input
          name="sku"
          dir="ltr"
          maxLength={64}
          defaultValue={variant.sku ?? ""}
          autoComplete="off"
        />
      </label>
      <label>
        <span>الباركود</span>
        <input
          name="barcode"
          dir="ltr"
          inputMode="numeric"
          maxLength={64}
          defaultValue={variant.barcode ?? ""}
          autoComplete="off"
        />
      </label>
      <button type="submit" className="admin-btn" disabled={pending}>
        حفظ الرموز
      </button>
      <ActionError state={state} />
    </form>
  );
}

function RestoreForm({
  productDomainId,
  variant,
}: {
  productDomainId: string;
  variant: { variantId: string; labelAr: string };
}) {
  const [state, action, pending] = useActionState(restoreVariantAction, null);
  return (
    <li className="admin-gallery-item">
      <form action={action} className="admin-media-form">
        <input type="hidden" name="productDomainId" value={productDomainId} />
        <input type="hidden" name="variantDomainId" value={variant.variantId} />
        <span>{variant.labelAr}</span>{" "}
        <button type="submit" className="admin-btn" disabled={pending}>
          استعادة الصنف
        </button>
        <ActionError state={state} />
      </form>
    </li>
  );
}

export function ProductCatalogControls({
  domainId,
  publication,
  problems,
  placeholderImage,
  variants,
  archivedVariants,
}: {
  domainId: string;
  publication: Publication;
  problems: string[];
  placeholderImage: boolean;
  variants: Array<{
    id: string;
    labelAr: string;
    sku?: string;
    barcode?: string;
  }>;
  archivedVariants: Array<{ variantId: string; labelAr: string }>;
}) {
  return (
    <section
      className="admin-media-editor"
      aria-labelledby="catalog-controls-title"
    >
      <h2 id="catalog-controls-title">النشر والرموز والأصناف المؤرشفة</h2>
      <PublicationForm
        domainId={domainId}
        publication={publication}
        problems={problems}
        placeholderImage={placeholderImage}
      />
      <details className="admin-media-section">
        <summary>SKU والباركود ({variants.length})</summary>
        {variants.map((variant) => (
          <IdentifierForm
            key={variant.id}
            productDomainId={domainId}
            variant={variant}
          />
        ))}
      </details>
      <details
        className="admin-media-section"
        open={archivedVariants.length > 0}
      >
        <summary>أصناف مؤرشفة ({archivedVariants.length})</summary>
        {archivedVariants.length ? (
          <>
            <p className="admin-muted">
              الصنف المستعاد يرجع غير متوفر للبيع؛ فعّليه من محرر الأصناف بعد
              المراجعة.
            </p>
            <ul className="admin-gallery-list">
              {archivedVariants.map((variant) => (
                <RestoreForm
                  key={variant.variantId}
                  productDomainId={domainId}
                  variant={variant}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="admin-muted">لا توجد أصناف مؤرشفة لهذا المنتج.</p>
        )}
      </details>
    </section>
  );
}
