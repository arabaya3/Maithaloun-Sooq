"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  publishProductAction,
  type PublishChoice,
} from "../application/product-wizard-actions";

export interface ReviewSummary {
  name: string;
  category: string;
  options: Array<{ name: string; values: string[] }>;
  variants: Array<{
    label: string;
    price: string;
    stock: string;
    available: boolean;
  }>;
  images: { total: number; unassigned: number };
  sellingUnits: number;
}

const choices: Array<{ value: PublishChoice; label: string; hint: string }> = [
  { value: "draft", label: "مسودة", hint: "لا يراه الزبائن بعد." },
  { value: "published", label: "منشور ومتوفر", hint: "يظهر ويمكن طلبه." },
  {
    value: "published_unavailable",
    label: "منشور وغير متوفر حاليًا",
    hint: "يظهر للزبائن بعلامة «غير متوفر».",
  },
  { value: "hidden", label: "مخفي", hint: "يبقى في الإدارة فقط." },
];

export function PublishReview({
  productDomainId,
  summary,
  problems,
  previewHref,
  current,
  placeholder,
}: {
  productDomainId: string;
  summary: ReviewSummary;
  problems: string[];
  previewHref: string;
  current: PublishChoice;
  placeholder: boolean;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<PublishChoice>(current);
  const [consent, setConsent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const publishing =
    choice === "published" || choice === "published_unavailable";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await publishProductAction({
        productDomainId,
        choice,
        acceptPlaceholder: consent,
      });
      setMessage(
        result.ok
          ? { ok: true, text: "حُفظت حالة المنتج." }
          : { ok: false, text: result.message },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <section
      id="wizard-review"
      className="admin-publish-review"
      aria-labelledby="review-title"
    >
      <h2 id="review-title" className="admin-workspace-section-title">
        مراجعة المنتج
      </h2>
      <dl className="admin-review-summary">
        <div>
          <dt>الاسم</dt>
          <dd>{summary.name}</dd>
        </div>
        <div>
          <dt>القسم</dt>
          <dd>{summary.category}</dd>
        </div>
        {summary.options.map((option) => (
          <div key={option.name}>
            <dt>{option.name}</dt>
            <dd>{option.values.join("، ")}</dd>
          </div>
        ))}
        <div>
          <dt>الصور</dt>
          <dd>
            {summary.images.total} صورة
            {summary.images.unassigned
              ? ` (${summary.images.unassigned} غير مربوطة)`
              : ""}
          </dd>
        </div>
        <div>
          <dt>طرق البيع</dt>
          <dd>
            {summary.sellingUnits
              ? `${summary.sellingUnits} طرق بيع`
              : "بالقطعة فقط"}
          </dd>
        </div>
      </dl>
      <div
        className="admin-table-wrap"
        role="region"
        aria-label="جدول الأصناف"
        tabIndex={0}
      >
        <table className="admin-data-table">
          <caption className="admin-muted">الأصناف</caption>
          <thead>
            <tr>
              <th scope="col">الصنف</th>
              <th scope="col">السعر</th>
              <th scope="col">المخزون</th>
              <th scope="col">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {summary.variants.map((variant) => (
              <tr key={variant.label}>
                <td>
                  <bdi>{variant.label}</bdi>
                </td>
                <td>{variant.price}</td>
                <td>{variant.stock}</td>
                <td>{variant.available ? "متوفر" : "غير متوفر"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {placeholder ? (
        <p role="note" className="admin-review-problems">
          الصورة الرئيسية للمنتج ما زالت مؤقتة. للنشر الآن وافقي على الصورة
          المؤقتة، أو اختاري صورة رئيسية من قسم الصور.
        </p>
      ) : null}
      {problems.length ? (
        <div role="note" className="admin-review-problems">
          <strong>قبل النشر:</strong>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : placeholder ? null : (
        <p className="admin-muted">لا ينقص المنتج شيء للنشر.</p>
      )}
      <a href={previewHref} target="_blank" rel="noopener">
        معاينة صفحة المنتج في المتجر
      </a>
      <form onSubmit={submit}>
        <fieldset>
          <legend>حالة المنتج</legend>
          {choices.map((item) => (
            <label key={item.value} className="admin-choice">
              <input
                type="radio"
                name="choice"
                value={item.value}
                checked={choice === item.value}
                onChange={() => setChoice(item.value)}
              />
              <span>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {publishing && placeholder ? (
          <label className="admin-choice">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            أقبل النشر بصورة مؤقتة إن لم توجد صورة
          </label>
        ) : null}
        <button
          className="admin-button-primary"
          type="submit"
          disabled={pending}
        >
          {pending ? "جارٍ الحفظ…" : "حفظ الحالة"}
        </button>
        {message ? (
          <p
            className="admin-media-message"
            data-tone={message.ok ? "ok" : "error"}
            role={message.ok ? "status" : "alert"}
          >
            {message.text}
          </p>
        ) : null}
      </form>
    </section>
  );
}
