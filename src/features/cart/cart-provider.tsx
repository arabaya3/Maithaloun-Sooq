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
  PREVIOUS_CART_STORAGE_KEY,
  cartReducer,
  initialCartState,
  parsePersistedCart,
  serializeCart,
  type CartCatalog,
  type CartCatalogEntry,
  type CartLine,
  type CartLineKey,
} from "./cart-store";

export type AddableLine = CartLineKey & {
  sellingUnitId: string;
  unitsPerSale: number;
};

interface CartContextValue {
  lines: readonly CartLine[];
  catalog: CartCatalog;
  count: number;
  ready: boolean;
  addItem: (line: AddableLine, quantity?: number) => void;
  setQuantity: (line: CartLineKey, quantity: number) => void;
  removeItem: (line: CartLineKey) => void;
  changeSellingUnit: (
    line: CartLineKey,
    to: { sellingUnitId: string; unitsPerSale: number },
  ) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function sellsUnit(
  catalog: CartCatalog,
  line: Pick<CartLine, "productId" | "variantId">,
  unit: { sellingUnitId: string; unitsPerSale: number },
) {
  return Boolean(
    catalog
      .get(line.productId)
      ?.variants.find((variant) => variant.id === line.variantId)
      ?.sellingUnits.some(
        (entry) =>
          entry.id === unit.sellingUnitId &&
          entry.unitsPerSale === unit.unitsPerSale,
      ),
  );
}

export function CartProvider({
  children,
  catalog: entries,
}: {
  children: ReactNode;
  catalog: readonly CartCatalogEntry[];
}) {
  const [state, dispatch] = useReducer(cartReducer, initialCartState);
  const [restored, setRestored] = useState(false);

  const catalog = useMemo<CartCatalog>(
    () => new Map(entries.map((entry) => [entry.productId, entry])),
    [entries],
  );

  useEffect(() => {
    const saved = parsePersistedCart(
      {
        v3: window.localStorage.getItem(CART_STORAGE_KEY),
        v2: window.localStorage.getItem(PREVIOUS_CART_STORAGE_KEY),
        v1: window.localStorage.getItem(LEGACY_CART_STORAGE_KEY),
      },
      catalog,
    );
    dispatch({ type: "restore", lines: saved.lines });
    queueMicrotask(() => setRestored(true));
  }, [catalog]);

  useEffect(() => {
    if (restored) {
      window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(state));
      window.localStorage.removeItem(PREVIOUS_CART_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
    }
  }, [restored, state]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines: state.lines,
      catalog,
      count: state.lines.reduce((total, line) => total + line.quantity, 0),
      ready: restored,
      addItem: (line, quantity = 1) => {
        if (!sellsUnit(catalog, line, line)) return;
        dispatch({ type: "add", line, quantity });
      },
      setQuantity: (line, quantity) =>
        dispatch({ type: "setQuantity", line, quantity }),
      removeItem: (line) => dispatch({ type: "remove", line }),
      changeSellingUnit: (line, to) => {
        if (!sellsUnit(catalog, line, to)) return;
        dispatch({ type: "changeSellingUnit", line, to });
      },
      clearCart: () => dispatch({ type: "clear" }),
    }),
    [catalog, restored, state.lines],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used within CartProvider");
  return cart;
}
