"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";

export interface AdminCategoryOption {
  code: string;
  nameAr: string;
}

const AdminCategoriesContext = createContext<readonly AdminCategoryOption[]>(
  [],
);

export function AdminCategoriesProvider({
  categories,
  children,
}: {
  categories: readonly AdminCategoryOption[];
  children: ReactNode;
}) {
  return (
    <AdminCategoriesContext.Provider value={categories}>
      {children}
    </AdminCategoriesContext.Provider>
  );
}

export function useAdminCategories() {
  return useContext(AdminCategoriesContext);
}

export function CategoryOptions() {
  const categories = useAdminCategories();
  return (
    <>
      {categories.map((category) => (
        <option key={category.code} value={category.code}>
          {category.nameAr}
        </option>
      ))}
    </>
  );
}

/**
 * The other categories a product is also shown in, besides its main one. A searchable list of
 * checkboxes; with `name` it also posts the choice with a plain form (plus a marker field, so the
 * server can tell «none chosen» from «this form has no picker»).
 */
export function ExtraCategoriesPicker({
  primary,
  value,
  onChange,
  name,
}: {
  primary: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  name?: string;
}) {
  const categories = useAdminCategories();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const others = categories.filter((category) => category.code !== primary);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? others.filter(
        (category) =>
          category.nameAr.toLowerCase().includes(needle) ||
          category.code.includes(needle),
      )
    : others;
  const chosen = value.filter((code) => code !== primary);

  return (
    <fieldset className="extra-categories">
      <legend>أقسام إضافية يظهر فيها المنتج (اختياري)</legend>
      <p className="extra-categories-hint">
        نفس المنتج بنفس السعر والمخزون والصور، يظهر أيضاً في هذه الأقسام.
      </p>
      {name ? (
        <>
          <input type="hidden" name={`${name}Present`} value="1" />
          {chosen.map((code) => (
            <input key={code} type="hidden" name={name} value={code} />
          ))}
        </>
      ) : null}
      {chosen.length ? (
        <ul className="extra-categories-chosen" aria-label="الأقسام المختارة">
          {chosen.map((code) => {
            const label =
              categories.find((category) => category.code === code)?.nameAr ??
              code;
            return (
              <li key={code}>
                <button
                  type="button"
                  onClick={() =>
                    onChange(chosen.filter((item) => item !== code))
                  }
                  aria-label={`إزالة ${label}`}
                >
                  {label} ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <label htmlFor={searchId} className="extra-categories-search">
        <span>ابحثي عن قسم</span>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="extra-categories-list" role="group">
        {shown.map((category) => {
          const checked = chosen.includes(category.code);
          return (
            <label key={category.code} className="extra-categories-option">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? chosen.filter((code) => code !== category.code)
                      : [...chosen, category.code],
                  )
                }
              />
              <span>{category.nameAr}</span>
            </label>
          );
        })}
        {!shown.length ? <p>لا يوجد قسم بهذا الاسم.</p> : null}
      </div>
    </fieldset>
  );
}

/** The picker for plain forms that keep their own primary select. */
export function ExtraCategoriesField({
  initialPrimary,
  primarySelectId,
  initial,
  name = "extraCategoryIds",
}: {
  initialPrimary: string;
  primarySelectId: string;
  initial: readonly string[];
  name?: string;
}) {
  const [primary, setPrimary] = useState(initialPrimary);
  const [value, setValue] = useState<string[]>([...initial]);
  useEffect(() => {
    const select = document.getElementById(primarySelectId);
    if (!(select instanceof HTMLSelectElement)) return;
    const sync = () => setPrimary(select.value);
    select.addEventListener("change", sync);
    return () => select.removeEventListener("change", sync);
  }, [primarySelectId]);
  return (
    <ExtraCategoriesPicker
      primary={primary}
      value={value}
      onChange={setValue}
      name={name}
    />
  );
}
