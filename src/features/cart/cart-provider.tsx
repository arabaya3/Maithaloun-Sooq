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
  addItem: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({
  children,
  productIds,
}: {
  children: ReactNode;
  productIds: readonly string[];
}) {
  const [state, dispatch] = useReducer(cartReducer, initialCartState);
  const [restored, setRestored] = useState(false);
  const allowedProductIds = useMemo(() => new Set(productIds), [productIds]);

  useEffect(() => {
    const saved = parsePersistedCart(
      window.localStorage.getItem(CART_STORAGE_KEY),
      allowedProductIds,
    );
    dispatch({ type: "restore", lines: saved.lines });
    queueMicrotask(() => setRestored(true));
  }, [allowedProductIds]);

  useEffect(() => {
    if (restored) {
      window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(state));
    }
  }, [restored, state]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines: state.lines,
      count: state.lines.reduce((total, line) => total + line.quantity, 0),
      ready: restored,
      addItem: (productId, quantity = 1) => {
        if (!allowedProductIds.has(productId)) return;
        dispatch({ type: "add", productId, quantity });
      },
      setQuantity: (productId, quantity) => {
        if (!allowedProductIds.has(productId)) return;
        dispatch({ type: "setQuantity", productId, quantity });
      },
      removeItem: (productId) => {
        if (!allowedProductIds.has(productId)) return;
        dispatch({ type: "remove", productId });
      },
      clearCart: () => dispatch({ type: "clear" }),
    }),
    [allowedProductIds, restored, state.lines],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used within CartProvider");
  return cart;
}
