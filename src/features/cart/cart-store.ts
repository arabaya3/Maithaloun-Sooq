import { z } from "zod";

import { variantDomainIdSchema } from "@/features/catalog/domain/product-variant";
import {
  MAX_UNITS_PER_SALE,
  sellingUnitIdSchema,
} from "@/features/catalog/domain/selling-unit";

export const CART_STORAGE_KEY = "souq-maythalun:cart:v3";
export const PREVIOUS_CART_STORAGE_KEY = "souq-maythalun:cart:v2";
export const LEGACY_CART_STORAGE_KEY = "souq-maythalun:cart:v1";
export const MAX_CART_QUANTITY = 9;

const productIdPattern = z.string().regex(/^[a-z0-9-]{1,80}$/);
const quantitySchema = z.number().int().min(1).max(MAX_CART_QUANTITY);

// A line is one exact variant bought one exact way; quantity counts singles or packs, not pieces.
// sellingUnitId is null only for a line restored from an older cart that has no equivalent way to buy.
const cartLineSchema = z
  .object({
    productId: productIdPattern,
    variantId: variantDomainIdSchema,
    sellingUnitId: sellingUnitIdSchema.nullable(),
    // What the customer saw when adding; a different value now means the unit changed and needs review.
    unitsPerSale: z.number().int().min(1).max(MAX_UNITS_PER_SALE),
    quantity: quantitySchema,
  })
  .strict();

const persistedCartV3Schema = z
  .object({ version: z.literal(3), lines: z.array(cartLineSchema).max(100) })
  .strict();

const persistedCartV2Schema = z
  .object({
    version: z.literal(2),
    lines: z
      .array(
        z
          .object({
            productId: productIdPattern,
            variantId: variantDomainIdSchema,
            quantity: quantitySchema,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

const persistedCartV1Schema = z
  .object({
    version: z.literal(1),
    lines: z
      .array(
        z
          .object({ productId: productIdPattern, quantity: quantitySchema })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type CartLine = z.infer<typeof cartLineSchema>;
export type CartLineKey = Pick<
  CartLine,
  "productId" | "variantId" | "sellingUnitId"
>;

export interface CartState {
  lines: CartLine[];
}

export type CartAction =
  | { type: "restore"; lines: CartLine[] }
  | {
      type: "add";
      line: CartLineKey & { unitsPerSale: number };
      quantity: number;
    }
  | { type: "setQuantity"; line: CartLineKey; quantity: number }
  | { type: "remove"; line: CartLineKey }
  // Moves a line to another way of buying the same variant, merging with an existing line for it.
  | {
      type: "changeSellingUnit";
      line: CartLineKey;
      to: { sellingUnitId: string; unitsPerSale: number };
    }
  | { type: "clear" };

export const initialCartState: CartState = { lines: [] };

export interface CartCatalogEntry {
  productId: string;
  defaultVariantId: string;
  variants: ReadonlyArray<{
    id: string;
    sellingUnits: ReadonlyArray<{ id: string; unitsPerSale: number }>;
  }>;
}

export type CartCatalog = ReadonlyMap<string, CartCatalogEntry>;

export function cartLineKey(line: CartLineKey): string {
  return `${line.productId}::${line.variantId}::${line.sellingUnitId ?? "review"}`;
}

function sameLine(left: CartLineKey, right: CartLineKey): boolean {
  return cartLineKey(left) === cartLineKey(right);
}

function catalogVariant(
  catalog: CartCatalog,
  productId: string,
  variantId: string,
) {
  return catalog
    .get(productId)
    ?.variants.find((variant) => variant.id === variantId);
}

/** True when the line can be checked out as is: its unit still exists unchanged on that variant. */
export function isCartLineCurrent(catalog: CartCatalog, line: CartLine) {
  const unit = catalogVariant(
    catalog,
    line.productId,
    line.variantId,
  )?.sellingUnits.find((entry) => entry.id === line.sellingUnitId);
  return Boolean(unit && unit.unitsPerSale === line.unitsPerSale);
}

// An older line meant «one piece each»; it keeps that meaning only through the one-piece unit.
function upgradeLine(
  catalog: CartCatalog,
  productId: string,
  variantId: string,
  quantity: number,
): CartLine | null {
  const variant = catalogVariant(catalog, productId, variantId);
  if (!variant) return null;
  const single = variant.sellingUnits.find((unit) => unit.unitsPerSale === 1);
  return {
    productId,
    variantId,
    sellingUnitId: single?.id ?? null,
    unitsPerSale: 1,
    quantity,
  };
}

function withoutDuplicates(lines: CartLine[]): CartLine[] | null {
  const keys = lines.map(cartLineKey);
  return new Set(keys).size === keys.length ? lines : null;
}

/**
 * Persisted carts are untrusted: shape, bounds and identifiers are checked, lines for products that
 * left the catalog are dropped, and a line whose unit changed is kept for review
 * rather than silently converted.
 */
export function parsePersistedCart(
  stored: {
    v3?: string | null;
    v2?: string | null;
    v1?: string | null;
  },
  catalog: CartCatalog,
): CartState {
  return (
    parseV3(stored.v3 ?? null, catalog) ??
    parseV2(stored.v2 ?? null, catalog) ??
    parseV1(stored.v1 ?? null, catalog) ??
    initialCartState
  );
}

function readJson(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseV3(raw: string | null, catalog: CartCatalog): CartState | null {
  const parsed = persistedCartV3Schema.safeParse(readJson(raw));
  if (!parsed.success) return null;
  if (!withoutDuplicates(parsed.data.lines)) return null;
  return {
    // A removed variant stays visible in the cart with an explanation; only a removed product drops the line.
    lines: parsed.data.lines.filter((line) => catalog.has(line.productId)),
  };
}

function parseV2(raw: string | null, catalog: CartCatalog): CartState | null {
  const parsed = persistedCartV2Schema.safeParse(readJson(raw));
  if (!parsed.success) return null;
  const keys = parsed.data.lines.map(
    (line) => `${line.productId}::${line.variantId}`,
  );
  if (new Set(keys).size !== keys.length) return null;
  const lines = parsed.data.lines.flatMap((line) => {
    const upgraded = upgradeLine(
      catalog,
      line.productId,
      line.variantId,
      line.quantity,
    );
    return upgraded ? [upgraded] : [];
  });
  return { lines: withoutDuplicates(lines) ?? [] };
}

function parseV1(raw: string | null, catalog: CartCatalog): CartState | null {
  const parsed = persistedCartV1Schema.safeParse(readJson(raw));
  if (!parsed.success) return null;
  const productIds = parsed.data.lines.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length) return null;
  const lines = parsed.data.lines.flatMap((line) => {
    const entry = catalog.get(line.productId);
    if (!entry) return [];
    const upgraded = upgradeLine(
      catalog,
      line.productId,
      entry.defaultVariantId,
      line.quantity,
    );
    return upgraded ? [upgraded] : [];
  });
  return { lines };
}

function clampQuantity(quantity: number): number {
  return Math.max(1, Math.min(MAX_CART_QUANTITY, Math.trunc(quantity)));
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  if (action.type === "restore") return { lines: action.lines };
  if (action.type === "clear") return initialCartState;
  if (action.type === "remove") {
    return {
      lines: state.lines.filter((line) => !sameLine(line, action.line)),
    };
  }
  if (action.type === "setQuantity") {
    const quantity = clampQuantity(action.quantity);
    return {
      lines: state.lines.map((line) =>
        sameLine(line, action.line) ? { ...line, quantity } : line,
      ),
    };
  }
  if (action.type === "changeSellingUnit") {
    const current = state.lines.find((line) => sameLine(line, action.line));
    if (!current) return state;
    const target: CartLineKey = {
      productId: current.productId,
      variantId: current.variantId,
      sellingUnitId: action.to.sellingUnitId,
    };
    const rest = state.lines.filter((line) => !sameLine(line, action.line));
    const existing = rest.find((line) => sameLine(line, target));
    if (existing) {
      return {
        lines: rest.map((line) =>
          line === existing
            ? {
                ...line,
                unitsPerSale: action.to.unitsPerSale,
                quantity: clampQuantity(line.quantity + current.quantity),
              }
            : line,
        ),
      };
    }
    const index = state.lines.indexOf(current);
    const lines = [...state.lines];
    lines[index] = {
      ...current,
      sellingUnitId: action.to.sellingUnitId,
      unitsPerSale: action.to.unitsPerSale,
    };
    return { lines };
  }

  const quantity = clampQuantity(action.quantity);
  const existing = state.lines.find((line) => sameLine(line, action.line));
  if (!existing) {
    return {
      lines: [
        ...state.lines,
        {
          productId: action.line.productId,
          variantId: action.line.variantId,
          sellingUnitId: action.line.sellingUnitId,
          unitsPerSale: action.line.unitsPerSale,
          quantity,
        },
      ],
    };
  }
  return {
    lines: state.lines.map((line) =>
      line === existing
        ? {
            ...line,
            unitsPerSale: action.line.unitsPerSale,
            quantity: clampQuantity(line.quantity + quantity),
          }
        : line,
    ),
  };
}

export function serializeCart(state: CartState): string {
  return JSON.stringify({ version: 3, lines: state.lines });
}

export function calculateLineSubtotal(
  unitPriceAgorot: number,
  quantity: number,
): number {
  if (
    !Number.isInteger(unitPriceAgorot) ||
    unitPriceAgorot < 0 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_CART_QUANTITY
  ) {
    throw new RangeError("Invalid cart subtotal input");
  }

  return unitPriceAgorot * quantity;
}

export function calculateCartSubtotal(
  lines: readonly { unitPriceAgorot: number; quantity: number }[],
): number {
  return lines.reduce(
    (total, line) =>
      total + calculateLineSubtotal(line.unitPriceAgorot, line.quantity),
    0,
  );
}
