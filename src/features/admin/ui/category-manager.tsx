"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import {
  createCategoryAction,
  deleteCategoryAction,
  mergeCategoryAction,
  moveCategoryAction,
  setCategoryArchivedAction,
  updateCategoryAction,
  type CatalogActionResult,
} from "@/features/admin/application/catalog-management-actions";
import {
  categoryIconKeys,
  categoryIconLabels,
  type AdminProductCategory,
  type CategoryIconKey,
} from "@/features/catalog/domain/category";

function ActionError({ state }: { state: CatalogActionResult }) {
  return state ? (
    <p className="admin-form-error" role="alert">
      {state.message}
    </p>
  ) : null;
}

function IconSelect({ value }: { value?: CategoryIconKey }) {
  return (
    <label>
      <span>الأيقونة</span>
      <select name="icon" defaultValue={value ?? "package"}>
        {categoryIconKeys.map((key) => (
          <option key={key} value={key}>
            {categoryIconLabels[key]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CategoryCreateForm() {
  const [state, action, pending] = useActionState(createCategoryAction, null);
  return (
    <form
      action={action}
      className="admin-form admin-panel"
      aria-label="إضافة قسم"
    >
      <h2>إضافة قسم</h2>
      <label>
        <span>اسم القسم</span>
        <input name="nameAr" required minLength={2} maxLength={80} />
      </label>
      <label>
        <span>الرمز (اختياري، أحرف لاتينية صغيرة)</span>
        <input
          name="code"
          dir="ltr"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={40}
          placeholder="air-fresheners"
        />
      </label>
      <label>
        <span>الوصف</span>
        <input name="description" maxLength={300} />
      </label>
      <IconSelect />
      <label className="admin-toggle">
        <input type="checkbox" name="visible" defaultChecked />
        <span>يظهر في المتجر</span>
      </label>
      <button type="submit" className="admin-btn" disabled={pending}>
        إضافة القسم
      </button>
      <ActionError state={state} />
    </form>
  );
}

function ArchiveToggle({ category }: { category: AdminProductCategory }) {
  const [state, action, pending] = useActionState(
    setCategoryArchivedAction,
    null,
  );
  return (
    <form action={action}>
      <input type="hidden" name="code" value={category.code} />
      <input
        type="hidden"
        name="archive"
        value={category.archived ? "0" : "1"}
      />
      <button
        type="submit"
        className="admin-btn"
        disabled={pending || (!category.archived && category.productCount > 0)}
      >
        {category.archived ? "استعادة القسم" : "أرشفة القسم"}
      </button>
      {!category.archived && category.productCount > 0 ? (
        <small className="admin-muted">
          {" "}
          الأرشفة متاحة بعد نقل منتجاته ({category.productCount}).
        </small>
      ) : null}
      <ActionError state={state} />
    </form>
  );
}

function MoveButtons({
  category,
  first,
  last,
}: {
  category: AdminProductCategory;
  first: boolean;
  last: boolean;
}) {
  const [state, action, pending] = useActionState(moveCategoryAction, null);
  return (
    <form action={action} className="admin-category-move">
      <input type="hidden" name="code" value={category.code} />
      <button
        type="submit"
        name="direction"
        value="up"
        className="admin-icon-btn"
        aria-label={`تقديم ${category.nameAr}`}
        disabled={pending || first}
      >
        <ArrowUp size={18} aria-hidden="true" />
      </button>
      <button
        type="submit"
        name="direction"
        value="down"
        className="admin-icon-btn"
        aria-label={`تأخير ${category.nameAr}`}
        disabled={pending || last}
      >
        <ArrowDown size={18} aria-hidden="true" />
      </button>
      <ActionError state={state} />
    </form>
  );
}

function MergeForm({
  category,
  others,
}: {
  category: AdminProductCategory;
  others: AdminProductCategory[];
}) {
  const [state, action, pending] = useActionState(mergeCategoryAction, null);
  if (!others.length) return null;
  return (
    <form action={action} className="admin-form">
      <input type="hidden" name="code" value={category.code} />
      <label>
        <span>دمج في قسم آخر</span>
        <select name="targetCode" required defaultValue="">
          <option value="" disabled>
            اختاري القسم
          </option>
          {others.map((other) => (
            <option key={other.code} value={other.code}>
              {other.nameAr}
            </option>
          ))}
        </select>
      </label>
      <p className="admin-muted">
        تنتقل منتجاته ({category.productCount}) إلى القسم المختار ويُؤرشف هذا
        القسم.
      </p>
      <button type="submit" className="admin-btn" disabled={pending}>
        دمج القسم
      </button>
      <ActionError state={state} />
    </form>
  );
}

function DeleteForm({ category }: { category: AdminProductCategory }) {
  const [state, action, pending] = useActionState(deleteCategoryAction, null);
  if (category.productCount > 0) return null;
  return (
    <form action={action}>
      <input type="hidden" name="code" value={category.code} />
      <button
        type="submit"
        className="admin-btn admin-btn-danger"
        disabled={pending}
      >
        حذف القسم نهائياً
      </button>
      <ActionError state={state} />
    </form>
  );
}

export function CategoryRow({
  category,
  others = [],
  first = false,
  last = false,
}: {
  category: AdminProductCategory;
  /** Active categories this one can merge into. */
  others?: AdminProductCategory[];
  first?: boolean;
  last?: boolean;
}) {
  const [state, action, pending] = useActionState(updateCategoryAction, null);
  return (
    <li
      className="admin-panel admin-category-row"
      aria-label={`القسم ${category.nameAr}`}
    >
      <div className="admin-category-head">
        <p>
          <strong>{category.nameAr}</strong>{" "}
          <small className="admin-muted" dir="ltr">
            {category.code}
          </small>
          <br />
          <small className="admin-muted">
            {category.productCount} منتج
            {category.archived
              ? " · مؤرشف"
              : category.visible
                ? " · ظاهر في المتجر"
                : " · مخفي عن المتجر"}
          </small>
          {!category.archived && category.productCount > 0 ? (
            <>
              <br />
              <Link
                href={`/admin/categories/${category.code}`}
                prefetch={false}
              >
                نقل منتجات هذا القسم
              </Link>
            </>
          ) : null}
        </p>
        {category.archived ? null : (
          <MoveButtons category={category} first={first} last={last} />
        )}
      </div>
      <details className="admin-category-actions">
        <summary>{category.archived ? "إجراءات" : "تعديل وإجراءات"}</summary>
        {category.archived ? null : (
          <form action={action} className="admin-form">
            <input type="hidden" name="code" value={category.code} />
            <input type="hidden" name="sortOrder" value={category.sortOrder} />
            <label>
              <span>الاسم</span>
              <input
                name="nameAr"
                required
                minLength={2}
                maxLength={80}
                defaultValue={category.nameAr}
              />
            </label>
            <label>
              <span>الوصف</span>
              <input
                name="description"
                maxLength={300}
                defaultValue={category.description ?? ""}
              />
            </label>
            <IconSelect value={category.icon} />
            <label className="admin-toggle">
              <input
                type="checkbox"
                name="visible"
                defaultChecked={category.visible}
              />
              <span>يظهر في المتجر</span>
            </label>
            <button type="submit" className="admin-btn" disabled={pending}>
              حفظ القسم
            </button>
            <ActionError state={state} />
          </form>
        )}
        {category.archived ? null : (
          <MergeForm category={category} others={others} />
        )}
        <ArchiveToggle category={category} />
        {category.archived ? <DeleteForm category={category} /> : null}
      </details>
    </li>
  );
}
