import { z } from "zod";

import { formatIls } from "@/shared/lib/format-currency";
import { moneyInputMessages, parseMoneyInput } from "@/shared/lib/money-input";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;

export const publicationStates = [
  "draft",
  "published",
  "published_unavailable",
  "hidden",
] as const;
export type PublicationState = (typeof publicationStates)[number];

const textFields = {
  nameAr: { label: "الاسم", max: 160, min: 2 },
  latinName: { label: "الاسم اللاتيني", max: 120 },
  brand: { label: "الماركة", max: 80 },
  description: { label: "الوصف", max: 600 },
  unit: { label: "الوحدة", max: 80 },
  size: { label: "الحجم", max: 40 },
  volume: { label: "السعة", max: 40 },
  weight: { label: "الوزن", max: 40 },
  fragrance: { label: "الرائحة", max: 40 },
  color: { label: "اللون", max: 40 },
  packageCount: { label: "عدد القطع", max: 10 },
} as const;

type TextField = keyof typeof textFields;
export const draftFieldNames = [
  ...(Object.keys(textFields) as TextField[]),
  "category",
  "price",
  "sku",
  "barcode",
  "publication",
  "openingQuantity",
  "openingUnitCost",
] as const;
export type DraftFieldName = (typeof draftFieldNames)[number];

export const draftLabels: Record<DraftFieldName, string> = {
  ...(Object.fromEntries(
    Object.entries(textFields).map(([key, value]) => [key, value.label]),
  ) as Record<TextField, string>),
  category: "القسم",
  price: "سعر البيع",
  sku: "SKU",
  barcode: "الباركود",
  publication: "حالة الظهور",
  openingQuantity: "الرصيد الافتتاحي",
  openingUnitCost: "تكلفة شراء الحبة",
};

const bounded = (max: number) => z.string().trim().min(1).max(max);
export const draftPatchSchema = z
  .object({
    ...(Object.fromEntries(
      Object.entries(textFields).map(([key, value]) => [
        key,
        bounded(value.max).optional(),
      ]),
    ) as Record<TextField, z.ZodOptional<z.ZodString>>),
    category: bounded(80).optional(),
    price: bounded(40).optional(),
    sku: bounded(64).optional(),
    barcode: bounded(32).optional(),
    publication: z.enum(publicationStates).optional(),
    openingQuantity: bounded(12).optional(),
    openingUnitCost: bounded(40).optional(),
    clear: z.array(z.enum(draftFieldNames)).max(10).optional(),
  })
  .strict();
export type DraftPatch = z.infer<typeof draftPatchSchema>;

export interface DraftValue {
  value: string | number;
  source: "user" | "image";
  confidence?: number;
}

export interface ProductDraftData {
  attachmentIds: string[];
  fields: Partial<Record<DraftFieldName, DraftValue>>;
  suggestions: Array<{
    field: DraftFieldName;
    value: string;
    confidence: number;
  }>;
}

export const emptyDraft = (attachmentIds: string[] = []): ProductDraftData => ({
  attachmentIds,
  fields: {},
  suggestions: [],
});

export interface DraftCategory {
  code: string;
  nameAr: string;
}

const identifier = /^[A-Za-z0-9._-]{3,64}$/;

// Each field is checked on its own: a rejected field is reported and every valid field is kept.
export function applyDraftPatch(
  data: ProductDraftData,
  patch: DraftPatch,
  categories: readonly DraftCategory[],
  source: "user" | "image" = "user",
): {
  data: ProductDraftData;
  errors: Array<{ field: DraftFieldName; message: string }>;
} {
  const fields = { ...data.fields };
  const errors: Array<{ field: DraftFieldName; message: string }> = [];
  for (const field of patch.clear ?? []) delete fields[field];
  const set = (field: DraftFieldName, value: string | number) => {
    fields[field] = { value, source };
  };

  for (const [key, spec] of Object.entries(textFields) as [
    TextField,
    (typeof textFields)[TextField],
  ][]) {
    const value = patch[key];
    if (value === undefined) continue;
    if ("min" in spec && value.length < spec.min) {
      errors.push({ field: key, message: `${spec.label} قصير جداً.` });
    } else set(key, value);
  }
  if (patch.category !== undefined) {
    const wanted = normalizeArabicText(patch.category);
    const match = categories.find(
      (row) =>
        row.code === patch.category ||
        normalizeArabicText(row.nameAr) === wanted,
    );
    if (match) set("category", match.code);
    else
      errors.push({
        field: "category",
        message: `ما لقيت قسم «${patch.category}». الأقسام: ${categories.map((row) => row.nameAr).join("، ")}.`,
      });
  }
  if (patch.price !== undefined) {
    const parsed = parseMoneyInput(patch.price);
    if (parsed.ok) set("price", parsed.agorot);
    else
      errors.push({ field: "price", message: moneyInputMessages[parsed.code] });
  }
  if (patch.openingUnitCost !== undefined) {
    const parsed = parseMoneyInput(patch.openingUnitCost);
    if (parsed.ok) set("openingUnitCost", parsed.agorot);
    else
      errors.push({
        field: "openingUnitCost",
        message: moneyInputMessages[parsed.code],
      });
  }
  if (patch.openingQuantity !== undefined) {
    const quantity = Number(patch.openingQuantity.replace(",", "."));
    if (Number.isFinite(quantity) && quantity > 0 && quantity <= 100_000) {
      set("openingQuantity", String(quantity));
    } else
      errors.push({
        field: "openingQuantity",
        message: "الكمية لازم تكون رقماً أكبر من صفر.",
      });
  }
  for (const key of ["sku", "barcode"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (identifier.test(value)) set(key, value);
    else
      errors.push({
        field: key,
        message: `${draftLabels[key]} يقبل أحرفاً لاتينية وأرقاماً فقط (3 إلى 64).`,
      });
  }
  if (patch.publication !== undefined) set("publication", patch.publication);

  // A rejected correction must not leave the old value looking confirmed; the field is asked for again.
  for (const error of errors) delete fields[error.field];
  return {
    data: {
      ...data,
      fields,
      suggestions: data.suggestions.filter((item) => !(item.field in fields)),
    },
    errors,
  };
}

const requiredOrder: DraftFieldName[] = [
  "nameAr",
  "category",
  "price",
  "publication",
];

export function draftMissing(data: ProductDraftData): DraftFieldName[] {
  const missing = requiredOrder.filter((field) => !(field in data.fields));
  const quantity = "openingQuantity" in data.fields;
  const cost = "openingUnitCost" in data.fields;
  if (quantity && !cost) missing.push("openingUnitCost");
  if (cost && !quantity) missing.push("openingQuantity");
  return missing;
}

export type DraftStage =
  | "basic_incomplete"
  | "category_missing"
  | "price_missing"
  | "publication_missing"
  | "opening_stock_incomplete"
  | "ready_for_confirmation";

export function draftStage(data: ProductDraftData): DraftStage {
  const [first] = draftMissing(data);
  if (!first) return "ready_for_confirmation";
  if (first === "nameAr") return "basic_incomplete";
  if (first === "category") return "category_missing";
  if (first === "price") return "price_missing";
  if (first === "publication") return "publication_missing";
  return "opening_stock_incomplete";
}

const publicationLabels: Record<PublicationState, string> = {
  draft: "مسودة غير ظاهرة",
  published: "منشور ومتوفر",
  published_unavailable: "منشور غير متوفر",
  hidden: "مخفي",
};

export function draftDisplayValue(
  field: DraftFieldName,
  value: string | number,
  categories: readonly DraftCategory[],
): string {
  if (field === "price" || field === "openingUnitCost") {
    return formatIls(Number(value));
  }
  if (field === "category") {
    return (
      categories.find((row) => row.code === value)?.nameAr ?? String(value)
    );
  }
  if (field === "publication") {
    return publicationLabels[value as PublicationState] ?? String(value);
  }
  return String(value);
}

export function draftToCreationInput(data: ProductDraftData) {
  const text = (field: DraftFieldName) => {
    const value = data.fields[field]?.value;
    return value === undefined ? undefined : String(value);
  };
  const agorot = (field: DraftFieldName) => {
    const value = data.fields[field]?.value;
    return typeof value === "number" ? (value / 100).toFixed(2) : undefined;
  };
  const attributes = Object.fromEntries(
    (
      [
        "size",
        "volume",
        "weight",
        "fragrance",
        "color",
        "packageCount",
      ] as const
    )
      .map((key) => [key, text(key)])
      .filter(([, value]) => value),
  );
  const quantity = text("openingQuantity");
  const unitCost = agorot("openingUnitCost");
  return {
    attachmentIds: data.attachmentIds.length ? data.attachmentIds : undefined,
    nameAr: text("nameAr") ?? "",
    latinName: text("latinName") ?? text("brand"),
    category: text("category") ?? "",
    description: text("description"),
    unit: text("unit"),
    attributes: Object.keys(attributes).length ? attributes : undefined,
    barcode: text("barcode"),
    sku: text("sku"),
    priceIls: agorot("price"),
    state: (text("publication") ?? "draft") as PublicationState,
    ...(quantity && unitCost
      ? { openingStock: { quantity, unitCostIls: unitCost } }
      : {}),
  };
}
