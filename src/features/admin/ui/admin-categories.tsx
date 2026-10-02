"use client";

import { createContext, useContext, type ReactNode } from "react";

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
