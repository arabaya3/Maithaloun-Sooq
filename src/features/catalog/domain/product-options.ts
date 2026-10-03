import { z } from "zod";

import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

export const optionKinds = [
  "color",
  "fragrance",
  "size",
  "pack",
  "other",
] as const;
export type OptionKind = (typeof optionKinds)[number];

export const optionKindLabels: Record<OptionKind, string> = {
  color: "اللون",
  fragrance: "الرائحة",
  size: "الحجم",
  pack: "العبوة",
  other: "الخيار",
};

export const optionValueSchema = z
  .object({
    id: z.string().min(1).max(64),
    valueAr: z.string().min(1).max(60),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

export const productOptionSchema = z
  .object({
    id: z.string().min(1).max(64),
    nameAr: z.string().min(1).max(40),
    kind: z.enum(optionKinds),
    sortOrder: z.number().int().nonnegative(),
    values: z.array(optionValueSchema).max(30),
  })
  .strict();

export type ProductOptionValue = z.infer<typeof optionValueSchema>;
export type ProductOption = z.infer<typeof productOptionSchema>;

/** optionId → valueId */
export type OptionSelection = Readonly<Record<string, string>>;

export const MAX_GENERATED_VARIANTS = 60;

export function normalizeOptionText(value: string): string {
  return normalizeArabicText(value).slice(0, 60);
}

// The same set of choices always produces the same key, whatever order it was entered in.
export function combinationKey(selection: OptionSelection): string | null {
  const entries = Object.entries(selection).filter(([, value]) => value);
  if (!entries.length) return null;
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([option, value]) => `${option}=${value}`)
    .join("|");
}

export function sortOptions<T extends { sortOrder: number; nameAr: string }>(
  options: readonly T[],
): T[] {
  return [...options].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.nameAr.localeCompare(right.nameAr, "ar"),
  );
}

export function selectionLabel(
  options: readonly ProductOption[],
  selection: OptionSelection,
): string {
  return sortOptions(options)
    .map(
      (option) =>
        option.values.find((value) => value.id === selection[option.id])
          ?.valueAr,
    )
    .filter(Boolean)
    .join(" · ");
}

/** Attribute map stored on the variant so carts, orders and invoices keep readable snapshots. */
export function selectionAttributes(
  options: readonly ProductOption[],
  selection: OptionSelection,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const option of sortOptions(options)) {
    const value = option.values.find(
      (item) => item.id === selection[option.id],
    );
    if (value) attributes[option.nameAr] = value.valueAr;
  }
  return attributes;
}

export interface SelectableVariant {
  id: string;
  optionValues: OptionSelection;
  available: boolean;
}

export function duplicateCombinations(
  variants: readonly SelectableVariant[],
): string[][] {
  const groups = new Map<string, string[]>();
  for (const variant of variants) {
    const key = combinationKey(variant.optionValues);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), variant.id]);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

export function incompleteVariants(
  options: readonly ProductOption[],
  variants: readonly SelectableVariant[],
): string[] {
  if (!options.length) return [];
  return variants
    .filter((variant) =>
      options.some((option) => !variant.optionValues[option.id]),
    )
    .map((variant) => variant.id);
}

export function cartesian(
  options: readonly { id: string; valueIds: readonly string[] }[],
  limit = MAX_GENERATED_VARIANTS,
): OptionSelection[] | null {
  let rows: Record<string, string>[] = [{}];
  for (const option of options) {
    if (!option.valueIds.length) return [];
    rows = rows.flatMap((row) =>
      option.valueIds.map((valueId) => ({ ...row, [option.id]: valueId })),
    );
    if (rows.length > limit) return null;
  }
  return rows;
}

export function missingCombinations(
  options: readonly ProductOption[],
  variants: readonly SelectableVariant[],
  limit = MAX_GENERATED_VARIANTS,
): OptionSelection[] | null {
  if (!options.length) return [];
  const all = cartesian(
    sortOptions(options).map((option) => ({
      id: option.id,
      valueIds: option.values.map((value) => value.id),
    })),
    limit,
  );
  if (!all) return null;
  const existing = new Set(
    variants.map((variant) => combinationKey(variant.optionValues)),
  );
  return all.filter((row) => !existing.has(combinationKey(row)));
}

export type ValueState = "selectable" | "unavailable" | "impossible";

// A value is impossible when no variant combines it with the other current choices.
export function valueStates(
  options: readonly ProductOption[],
  variants: readonly SelectableVariant[],
  selection: OptionSelection,
): Record<string, Record<string, ValueState>> {
  const states: Record<string, Record<string, ValueState>> = {};
  for (const option of options) {
    states[option.id] = {};
    for (const value of option.values) {
      const candidates = variants.filter(
        (variant) =>
          variant.optionValues[option.id] === value.id &&
          Object.entries(selection).every(
            ([otherOption, otherValue]) =>
              otherOption === option.id ||
              !otherValue ||
              variant.optionValues[otherOption] === otherValue,
          ),
      );
      states[option.id]![value.id] = !candidates.length
        ? "impossible"
        : candidates.some((variant) => variant.available)
          ? "selectable"
          : "unavailable";
    }
  }
  return states;
}

export function variantForSelection<T extends SelectableVariant>(
  options: readonly ProductOption[],
  variants: readonly T[],
  selection: OptionSelection,
): T | null {
  if (options.some((option) => !selection[option.id])) return null;
  const key = combinationKey(
    Object.fromEntries(
      options.map((option) => [option.id, selection[option.id]!]),
    ),
  );
  return (
    variants.find((variant) => combinationKey(variant.optionValues) === key) ??
    null
  );
}

// Choosing a value keeps the other choices when a matching variant exists, otherwise moves to the closest available one.
export function nextSelection<T extends SelectableVariant>(
  options: readonly ProductOption[],
  variants: readonly T[],
  selection: OptionSelection,
  optionId: string,
  valueId: string,
): OptionSelection {
  const wanted = { ...selection, [optionId]: valueId };
  if (variantForSelection(options, variants, wanted)) return wanted;
  const matching = variants.filter(
    (variant) => variant.optionValues[optionId] === valueId,
  );
  const best =
    matching.find((variant) => variant.available) ?? matching[0] ?? null;
  return best ? { ...best.optionValues } : wanted;
}

export function packLabel(packCount: number | null | undefined): string | null {
  if (!packCount || packCount < 2) return null;
  return `العبوة فيها ${packCount} قطع`;
}

// «الأزرق» and «أزرق» name the same value; the definite article is ignored when comparing.
export function sameOptionText(left: string, right: string): boolean {
  const strip = (value: string) => {
    const normalized = normalizeOptionText(value);
    return normalized.length > 3 && normalized.startsWith("ال")
      ? normalized.slice(2)
      : normalized;
  };
  return strip(left) === strip(right);
}
