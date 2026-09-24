"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";

import {
  CART_STORAGE_KEY,
  LEGACY_CART_STORAGE_KEY,
  cartReducer,
  initialCartState,
  parsePersistedCart,
  serializeCart,
  type CartLine,
} from "./cart-store";

interface CartContextValue {
  lines: readonly CartLine[];
  count: number;
  ready: boolean;
  addItem: (productId: string, variantId: string, quantity?: number) => void;
  setQuantity: (productId: string, variantId: string, quantity: number) => void;
  removeItem: (productId: string, variantId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({
  children,
  catalog,
}: {
  children: ReactNode;
  catalog: ReadonlyArray<{
    productId: string;
    defaultVariantId: string;
    variantIds: readonly string[];
  }>;
}) {
  const [state, dispatch] = useReducer(cartReducer, initialCartState);
  const [restored, setRestored] = useState(false);

  const allowedPairs = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>();
    for (const entry of catalog) {
      map.set(entry.productId, new Set(entry.variantIds));
    }
    return map;
  }, [catalog]);

  const defaultVariantByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalog) {
      map.set(entry.productId, entry.defaultVariantId);
    }
    return map;
  }, [catalog]);

  useEffect(() => {
    const saved = parsePersistedCart(
      window.localStorage.getItem(CART_STORAGE_KEY),
      allowedPairs,
      defaultVariantByProduct,
      window.localStorage.getItem(LEGACY_CART_STORAGE_KEY),
    );
    dispatch({ type: "restore", lines: saved.lines });
    queueMicrotask(() => setRestored(true));
  }, [allowedPairs, defaultVariantByProduct]);

  useEffect(() => {
    if (restored) {
      window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(state));
      window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
    }
  }, [restored, state]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines: state.lines,
      count: state.lines.reduce((total, line) => total + line.quantity, 0),
      ready: restored,
      addItem: (productId, variantId, quantity = 1) => {
        if (!allowedPairs.get(productId)?.has(variantId)) return;
        dispatch({ type: "add", productId, variantId, quantity });
      },
      setQuantity: (productId, variantId, quantity) => {
        if (!allowedPairs.get(productId)?.has(variantId)) return;
        dispatch({ type: "setQuantity", productId, variantId, quantity });
      },
      removeItem: (productId, variantId) => {
        if (!allowedPairs.get(productId)?.has(variantId)) return;
        dispatch({ type: "remove", productId, variantId });
      },
      clearCart: () => dispatch({ type: "clear" }),
    }),
    [allowedPairs, restored, state.lines],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used within CartProvider");
  return cart;
}
