import { z } from "zod";

import { MILLI } from "@/features/inventory/domain/quantity";
import { toLatinDigits } from "@/shared/lib/digits";
import { formatIls } from "@/shared/lib/format-currency";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

// A selling unit is one way to buy an exact variant: a single piece, a 3-pack, a carton.
// Inventory is always counted in the variant's base unit; a sale of one selling unit
// consumes `unitsPerSale` base units. Packs never hold a balance of their own.

export const MAX_UNITS_PER_SALE = 1_000;
export const MAX_SELLING_UNITS_PER_VARIANT = 12;
export const SELLING_UNIT_LABEL_MAX = 60;

export const sellingUnitIdSchema = z.uuid();

// What the storefront receives: only active units, with availability already resolved on the server.
export const sellingUnitSchema = z
  .object({
    id: sellingUnitIdSchema,
    labelAr: z.string().min(1).max(SELLING_UNIT_LABEL_MAX),
    unitsPerSale: z.number().int().min(1).max(MAX_UNITS_PER_SALE),
    priceAgorot: z.number().int().positive().max(10_000_000),
    isDefault: z.boolean(),
    sku: z.string().min(1).max(64).optional(),
    barcode: z.string().min(1).max(64).optional(),
    // Capped at the cart limit so the storefront never learns the exact stock level.
    maxQuantity: z.number().int().nonnegative(),
  })
  .strict();

export type SellingUnit = z.infer<typeof sellingUnitSchema>;

export const sellingUnitMessages = {
  unitsPerSale: "عدد الحبات داخل الباكيج يجب أن يكون رقماً صحيحاً أكبر من صفر.",
  price: "سعر البيع يجب أن يكون أكبر من صفر.",
  label: "اكتب اسم طريقة البيع، مثل «حبة واحدة» أو «باكيج 3 حبات».",
  required: "لا يمكن نشر الصنف دون طريقة بيع واحدة على الأقل.",
  duplicateSku: "يوجد SKU مستخدم لطريقة بيع أخرى.",
  duplicateBarcode: "يوجد باركود مستخدم لطريقة بيع أخرى.",
  duplicateUnits: "يوجد لهذا الصنف طريقة بيع فعّالة بنفس عدد الحبات.",
  duplicateLabel: "يوجد لهذا الصنف طريقة بيع فعّالة بنفس الاسم.",
  inUse: "لا يمكن حذف طريقة بيع استُخدمت في طلب سابق؛ يمكنك أرشفتها.",
  lastActive: "يجب أن تبقى طريقة بيع فعّالة واحدة على الأقل لهذا الصنف.",
  defaultArchived:
    "لا يمكن أرشفة طريقة البيع الافتراضية؛ اختر افتراضية أخرى أولاً.",
  stale: "تغيّرت طريقة البيع منذ فتح الصفحة. حدّث الصفحة وراجع القيم.",
  tooMany: "وصلت للحد الأقصى لطرق البيع لهذا الصنف.",
} as const;

// Presets only fill the form; the owner can always edit the final label and count.
export const sellingUnitPresets = [
  { key: "single", labelAr: "حبة واحدة", unitsPerSale: 1 },
  { key: "pack", labelAr: "باكيج", unitsPerSale: null },
  { key: "carton", labelAr: "كرتونة", unitsPerSale: null },
] as const;

/** «باكيج» + 3 → «باكيج 3 حبات»; labels the owner already wrote with a number stay as they are. */
export function presetLabel(base: string, unitsPerSale: number | null): string {
  const label = base.trim();
  if (!unitsPerSale || unitsPerSale < 2 || /\d/.test(label)) return label;
  const noun = unitsPerSale >= 3 && unitsPerSale <= 10 ? "حبات" : "حبة";
  return `${label} ${unitsPerSale} ${noun}`;
}

/** Arabic count of base pieces: حبة واحدة، حبتان، 3 حبات، 11 حبة. */
export function piecesText(count: number): string {
  if (count === 1) return "حبة واحدة";
  if (count === 2) return "حبتان";
  if (count >= 3 && count <= 10) return `${count} حبات`;
  return `${count} حبة`;
}

/**
 * Whole selling units that free stock can fill: floor(base units / units per sale).
 * null means the variant is not stock-tracked, so only the variant's availability applies.
 */
export function availableSaleQuantity(
  freeBaseMilli: number | null,
  unitsPerSale: number,
): number | null {
  if (freeBaseMilli === null) return null;
  assertUnitsPerSale(unitsPerSale);
  if (freeBaseMilli <= 0) return 0;
  return Math.floor(freeBaseMilli / (unitsPerSale * MILLI));
}

export function maxOrderQuantity(
  freeBaseMilli: number | null,
  unitsPerSale: number,
  cap: number,
): number {
  const available = availableSaleQuantity(freeBaseMilli, unitsPerSale);
  return available === null ? cap : Math.min(cap, available);
}

export function assertUnitsPerSale(unitsPerSale: number): void {
  if (
    !Number.isInteger(unitsPerSale) ||
    unitsPerSale < 1 ||
    unitsPerSale > MAX_UNITS_PER_SALE
  ) {
    throw new RangeError("INVALID_UNITS_PER_SALE");
  }
}

/** Base units a cart line or order line represents: selling units × units per sale. */
export function baseUnitsFor(quantity: number, unitsPerSale: number): number {
  assertUnitsPerSale(unitsPerSale);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError("INVALID_QUANTITY");
  }
  return quantity * unitsPerSale;
}

/** Half-up price of one base piece inside a pack, in agorot. */
export function perPieceAgorot(priceAgorot: number, unitsPerSale: number) {
  assertUnitsPerSale(unitsPerSale);
  return Math.floor((priceAgorot * 2 + unitsPerSale) / (unitsPerSale * 2));
}

/**
 * A factual per-piece price for packs, e.g. «3.33 ₪ للحبة». It says «أوفر» only when the
 * pack is strictly cheaper per piece than the single unit, compared in exact integers.
 */
export function unitComparison(
  unit: Pick<SellingUnit, "priceAgorot" | "unitsPerSale">,
  single: Pick<SellingUnit, "priceAgorot" | "unitsPerSale"> | null,
): { perPiece: string; cheaper: boolean } | null {
  if (unit.unitsPerSale < 2) return null;
  const perPiece = `${formatIls(perPieceAgorot(unit.priceAgorot, unit.unitsPerSale))} للحبة`;
  const cheaper =
    single !== null &&
    single.unitsPerSale === 1 &&
    unit.priceAgorot < single.priceAgorot * unit.unitsPerSale;
  return { perPiece, cheaper };
}

export function isSellingUnitPurchasable(unit: SellingUnit): boolean {
  return unit.maxQuantity >= 1;
}

export function defaultSellingUnit(
  units: readonly SellingUnit[],
): SellingUnit | null {
  return (
    units.find((unit) => unit.isDefault && isSellingUnitPurchasable(unit)) ??
    units.find(isSellingUnitPurchasable) ??
    units.find((unit) => unit.isDefault) ??
    units[0] ??
    null
  );
}

/**
 * After the customer changes colour or size, keep the same way of buying only when the new
 * variant sells an equivalent unit (same pieces per sale) that can be bought; otherwise use the default.
 */
export function sellingUnitAfterVariantChange(
  previous: Pick<SellingUnit, "unitsPerSale"> | null,
  next: readonly SellingUnit[],
): SellingUnit | null {
  if (previous) {
    const equivalent = next.find(
      (unit) =>
        unit.unitsPerSale === previous.unitsPerSale &&
        isSellingUnitPurchasable(unit),
    );
    if (equivalent) return equivalent;
  }
  return defaultSellingUnit(next);
}

export function findSellingUnit(
  units: readonly SellingUnit[],
  id: string | null | undefined,
): SellingUnit | null {
  if (!id) return null;
  return units.find((unit) => unit.id === id) ?? null;
}

/** «باكيج 3 حبات × 2» — the cart shows packs and their count, never «2 حبة» for two packs. */
export function sellingLineText(labelAr: string, quantity: number): string {
  return `${labelAr} × ${quantity}`;
}

/** «بيع باكيج واحد يخصم 3 حبات من المخزون.» */
export function deductionText(labelAr: string, unitsPerSale: number): string {
  return `بيع «${labelAr}» مرة واحدة يخصم ${piecesText(unitsPerSale)} من المخزون.`;
}

/** «المتاح حالياً: 10 حبات = 3 × باكيج 3 حبات، وتبقى حبة واحدة.» */
export function stockInterpretation(
  freeBaseMilli: number | null,
  labelAr: string,
  unitsPerSale: number,
): string {
  if (freeBaseMilli === null) return "هذا الصنف غير متتبَّع بالمخزون.";
  const pieces = Math.max(0, Math.floor(freeBaseMilli / MILLI));
  const sets = availableSaleQuantity(freeBaseMilli, unitsPerSale) ?? 0;
  if (unitsPerSale === 1) {
    return `المتاح حالياً: ${piecesText(pieces)}.`;
  }
  if (sets === 0) {
    return `المتاح حالياً: ${pieces ? piecesText(pieces) : "لا شيء"}، وهذا أقل من «${labelAr}» واحد.`;
  }
  const remainder = pieces - sets * unitsPerSale;
  return `المتاح حالياً: ${piecesText(pieces)} = ${sets} × «${labelAr}»${
    remainder > 0 ? `، وتبقى ${piecesText(remainder)}` : ""
  }.`;
}

/**
 * The unit someone named in words: an exact label, then the piece count said («باكيج 3»), then a
 * partial label. Returns null unless exactly one unit fits, so the caller asks instead of guessing.
 */
export function matchSellingUnit<
  T extends { labelAr: string; unitsPerSale: number },
>(units: readonly T[], said: string): T | null {
  // «الكرتونة» and «كرتونة» name the same unit; the definite article is ignored per word.
  const normalize = (value: string) =>
    normalizeArabicText(value)
      .split(" ")
      .map((word) =>
        word.length > 3 && word.startsWith("ال") ? word.slice(2) : word,
      )
      .join(" ");
  const wanted = normalize(said);
  if (!wanted) return null;
  const exact = units.filter((unit) => normalize(unit.labelAr) === wanted);
  if (exact.length === 1) return exact[0]!;
  const digits = wanted.match(/\d+/)?.[0];
  const byCount = digits
    ? units.filter((unit) => unit.unitsPerSale === Number(digits))
    : [];
  if (byCount.length === 1) return byCount[0]!;
  const partial = units.filter(
    (unit) =>
      normalize(unit.labelAr).includes(wanted) ||
      wanted.includes(normalize(unit.labelAr)),
  );
  return partial.length === 1 ? partial[0]! : null;
}

const COUNT_WORDS: Record<number, readonly string[]> = {
  2: ["حبتين", "حبتان", "اثنتين", "اثنين", "زوج"],
  3: ["ثلاث", "ثلاثه", "تلات", "تلاته"],
  4: ["اربع", "اربعه"],
  5: ["خمس", "خمسه"],
  6: ["ست", "سته"],
  7: ["سبع", "سبعه"],
  8: ["ثمان", "ثماني", "ثمانيه", "تمن", "تمانيه"],
  9: ["تسع", "تسعه"],
  10: ["عشر", "عشره"],
  12: ["دزينه", "درزن", "اثنا عشر", "اطنعش"],
};

/**
 * Whether a multi-piece label says how many pieces it holds («باكيج 3 حبات», «كرتونة ست حبات»).
 * A bare «باكيج» does not: the count must come from the owner, never be guessed.
 */
export function labelStatesCount(
  labelAr: string,
  unitsPerSale: number,
): boolean {
  if (unitsPerSale <= 1) return true;
  const words = normalizeArabicText(labelAr).split(" ");
  if (words.includes(String(unitsPerSale))) return true;
  const named = (COUNT_WORDS[unitsPerSale] ?? []).map((word) =>
    normalizeArabicText(word),
  );
  const text = words.join(" ");
  return named.some((word) =>
    word.includes(" ") ? text.includes(word) : words.includes(word),
  );
}

/** Parses the owner's typed count; Arabic-Indic digits are accepted, fractions are not. */
export function parseUnitsPerSale(input: string): number | null {
  const latin = toLatinDigits(input).trim();
  if (!/^\d{1,4}$/.test(latin)) return null;
  const value = Number(latin);
  return value >= 1 && value <= MAX_UNITS_PER_SALE ? value : null;
}
