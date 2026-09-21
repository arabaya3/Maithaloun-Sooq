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
} from "./cart-store";

interface CartContextValue {
  count: number;
  addItem: (productId: string, quantity?: number) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialCartState);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const saved = parsePersistedCart(
      window.localStorage.getItem(CART_STORAGE_KEY),
    );
    dispatch({ type: "restore", lines: saved.lines });
    queueMicrotask(() => setRestored(true));
  }, []);

  useEffect(() => {
    if (restored) {
      window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(state));
    }
  }, [restored, state]);

  const value = useMemo<CartContextValue>(
    () => ({
      count: state.lines.reduce((total, line) => total + line.quantity, 0),
      addItem: (productId, quantity = 1) =>
        dispatch({ type: "add", productId, quantity }),
    }),
    [state.lines],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used within CartProvider");
  return cart;
}
