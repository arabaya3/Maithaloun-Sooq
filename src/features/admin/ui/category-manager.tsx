"use client";

import { useActionState } from "react";

import {
  createCategoryAction,
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

export function CategoryRow({ category }: { category: AdminProductCategory }) {
  const [state, action, pending] = useActionState(updateCategoryAction, null);
  return (
    <li className="admin-panel" aria-label={`القسم ${category.nameAr}`}>
      <p>
        <strong>{category.nameAr}</strong>{" "}
        <small className="admin-muted" dir="ltr">
          {category.code}
        </small>{" "}
        <small className="admin-muted">
          · {category.productCount} منتج
          {category.archived ? " · مؤرشف" : category.visible ? "" : " · مخفي"}
        </small>
      </p>
      {category.archived ? null : (
        <form action={action} className="admin-form">
          <input type="hidden" name="code" value={category.code} />
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
          <label>
            <span>الترتيب</span>
            <input
              name="sortOrder"
              type="number"
              min={0}
              max={10000}
              defaultValue={category.sortOrder}
            />
          </label>
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
      <ArchiveToggle category={category} />
    </li>
  );
}
