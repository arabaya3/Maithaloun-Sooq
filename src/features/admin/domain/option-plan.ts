import {
  normalizeOptionText,
  type OptionKind,
} from "@/features/catalog/domain/product-options";

export interface PlannedOption {
  key: string;
  nameAr: string;
  kind: OptionKind;
  values: string[];
}

export type OptionShape = "single" | "fragrance" | "size" | "color" | "several";

export const optionShapes: ReadonlyArray<{ id: OptionShape; label: string }> = [
  { id: "single", label: "منتج بخيار واحد" },
  { id: "fragrance", label: "روائح متعددة" },
  { id: "size", label: "أحجام متعددة" },
  { id: "color", label: "ألوان متعددة" },
  { id: "several", label: "أكثر من نوع من الخيارات" },
];

export const optionPresets: ReadonlyArray<{
  kind: OptionKind;
  nameAr: string;
}> = [
  { kind: "fragrance", nameAr: "الرائحة" },
  { kind: "size", nameAr: "الحجم" },
  { kind: "color", nameAr: "اللون" },
];

export const MAX_PLANNED_OPTIONS = 4;
export const MAX_PLANNED_VALUES = 20;
export const MAX_PLANNED_VARIANTS = 60;

/** The options a shape starts with; "several" starts with fragrance and size, the most common pair. */
export function optionsForShape(shape: OptionShape): PlannedOption[] {
  const preset = (kind: OptionKind): PlannedOption => ({
    key: kind,
    nameAr: optionPresets.find((item) => item.kind === kind)!.nameAr,
    kind,
    values: [],
  });
  if (shape === "single") return [];
  if (shape === "several") return [preset("fragrance"), preset("size")];
  return [preset(shape)];
}

/** Every combination of the options' values, in option order. */
export function allCombinations(options: readonly PlannedOption[]): string[][] {
  const live = options.filter((option) => option.values.length);
  if (!live.length || live.length !== options.length) return [];
  return live.reduce<string[][]>(
    (rows, option) =>
      rows.flatMap((row) => option.values.map((value) => [...row, value])),
    [[]],
  );
}

export const combinationText = (combination: readonly string[]) =>
  combination.join(" – ");

export const combinationId = (combination: readonly string[]) =>
  combination.map(normalizeOptionText).join("|");

/** The first problem with the plan, named so the owner knows exactly what to fix. */
export function planProblem(
  options: readonly PlannedOption[],
  selected: readonly string[][],
): string | null {
  if (!options.length)
    return "أضيفي خياراً واحداً على الأقل، أو اختاري «منتج بخيار واحد».";
  if (options.length > MAX_PLANNED_OPTIONS)
    return `الحد الأقصى ${MAX_PLANNED_OPTIONS} أنواع من الخيارات.`;
  const names = new Set<string>();
  for (const option of options) {
    const name = option.nameAr.trim();
    if (!name) return "اكتبي اسم كل نوع من الخيارات.";
    if (names.has(normalizeOptionText(name)))
      return `نوع الخيار «${name}» مكرر.`;
    names.add(normalizeOptionText(name));
    if (!option.values.length)
      return `أضيفي قيمة واحدة على الأقل لـ «${name}».`;
    if (option.values.length > MAX_PLANNED_VALUES)
      return `«${name}» فيه أكثر من ${MAX_PLANNED_VALUES} قيمة.`;
  }
  if (!selected.length) return "اختاري صنفاً واحداً على الأقل من القائمة.";
  if (selected.length > MAX_PLANNED_VARIANTS)
    return `الحد الأقصى ${MAX_PLANNED_VARIANTS} صنفاً للمنتج الواحد.`;
  return null;
}

/** Adds a value unless it is empty or already there (spelling variants such as أ/ا count as the same). */
export function withValue(option: PlannedOption, value: string): PlannedOption {
  const text = value.trim().slice(0, 60);
  if (!text) return option;
  const exists = option.values.some(
    (item) => normalizeOptionText(item) === normalizeOptionText(text),
  );
  return exists ? option : { ...option, values: [...option.values, text] };
}
