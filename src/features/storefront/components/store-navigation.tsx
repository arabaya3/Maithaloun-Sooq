"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface NavigationCategory {
  code: string;
  // Already in the visitor's language.
  name: string;
}

const StoreNavigationContext = createContext<readonly NavigationCategory[]>([]);

/** Categories for the header row; read once in the store layout. */
export function StoreNavigationProvider({
  categories,
  children,
}: {
  categories: readonly NavigationCategory[];
  children: ReactNode;
}) {
  return (
    <StoreNavigationContext.Provider value={categories}>
      {children}
    </StoreNavigationContext.Provider>
  );
}

export function useNavigationCategories() {
  return useContext(StoreNavigationContext);
}
