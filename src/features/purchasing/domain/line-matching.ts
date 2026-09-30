import { toLatinDigits } from "@/shared/lib/digits";
import {
  normalizeArabicText,
  normalizeReference,
} from "@/shared/lib/normalize-arabic";

import type { ExtractionMatchMethod } from "./purchase-constants";

export interface CatalogVariant {
  variantId: string;
  productName: string;
  variantLabel: string | null;
  sku: string | null;
  barcode: string | null;
}

export interface MatchInput {
  name: string;
  barcode?: string;
  sku?: string;
  size?: string;
}

export interface MatchCandidate {
  variantId: string;
  label: string;
  score: number;
}

export interface MatchResult {
  status: "matched" | "suggested" | "unmatched";
  method: ExtractionMatchMethod | null;
  variantId: string | null;
  confidence: number | null;
  candidates: MatchCandidate[];
}

export const FUZZY_SUGGESTION_THRESHOLD = 45;
const MAX_CANDIDATES = 4;

export function variantLabel(variant: CatalogVariant): string {
  return variant.variantLabel
    ? `${variant.productName} — ${variant.variantLabel}`
    : variant.productName;
}

function bigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, "");
  const grams = new Map<string, number>();
  if (compact.length < 2) {
    if (compact) grams.set(compact, 1);
    return grams;
  }
  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

export function similarity(left: string, right: string): number {
  const a = bigrams(normalizeArabicText(left));
  const b = bigrams(normalizeArabicText(right));
  let sizeA = 0;
  let sizeB = 0;
  let shared = 0;
  for (const count of a.values()) sizeA += count;
  for (const [gram, count] of b) {
    sizeB += count;
    shared += Math.min(count, a.get(gram) ?? 0);
  }
  if (sizeA + sizeB === 0) return 0;
  return Math.round((200 * shared) / (sizeA + sizeB));
}

function matched(
  method: ExtractionMatchMethod,
  variant: CatalogVariant,
  confidence: number,
): MatchResult {
  return {
    status: "matched",
    method,
    variantId: variant.variantId,
    confidence,
    candidates: [
      {
        variantId: variant.variantId,
        label: variantLabel(variant),
        score: confidence,
      },
    ],
  };
}

function suggested(candidates: MatchCandidate[]): MatchResult {
  return {
    status: candidates.length ? "suggested" : "unmatched",
    method: candidates.length ? "fuzzy" : null,
    variantId: null,
    confidence: candidates[0]?.score ?? null,
    candidates,
  };
}

// Only identifiers, exact names and saved supplier wording select a product automatically.
// Fuzzy similarity produces suggestions that a person must choose from.
export function matchLine(
  input: MatchInput,
  catalog: readonly CatalogVariant[],
  aliases: ReadonlyMap<string, string>,
): MatchResult {
  const barcode = toLatinDigits(input.barcode ?? "").replace(/\s/g, "");
  if (barcode) {
    const hit = catalog.find((variant) => variant.barcode === barcode);
    if (hit) return matched("barcode", hit, 100);
  }
  const sku = input.sku ? normalizeReference(input.sku) : "";
  if (sku) {
    const hit = catalog.find(
      (variant) => variant.sku && normalizeReference(variant.sku) === sku,
    );
    if (hit) return matched("sku", hit, 100);
  }

  const name = normalizeArabicText(input.name);
  if (!name) return suggested([]);
  const withSize = input.size
    ? normalizeArabicText(`${input.name} ${input.size}`)
    : name;

  const exact = catalog.filter((variant) => {
    const product = normalizeArabicText(variant.productName);
    const full = normalizeArabicText(
      `${variant.productName} ${variant.variantLabel ?? ""}`,
    );
    return [name, withSize].some(
      (value) => value === product || value === full,
    );
  });
  if (exact.length === 1) return matched("exact_name", exact[0]!, 95);
  if (exact.length > 1) {
    const bySize = exact.filter(
      (variant) =>
        normalizeArabicText(
          `${variant.productName} ${variant.variantLabel ?? ""}`,
        ) === withSize,
    );
    if (bySize.length === 1) return matched("exact_name", bySize[0]!, 95);
    return suggested(
      exact.slice(0, MAX_CANDIDATES).map((variant) => ({
        variantId: variant.variantId,
        label: variantLabel(variant),
        score: 80,
      })),
    );
  }

  const aliasVariantId = aliases.get(name);
  if (aliasVariantId) {
    const hit = catalog.find((variant) => variant.variantId === aliasVariantId);
    if (hit) return matched("supplier_alias", hit, 90);
  }

  const scored = catalog
    .map((variant) => ({
      variantId: variant.variantId,
      label: variantLabel(variant),
      score: Math.max(
        similarity(withSize, variantLabel(variant)),
        similarity(name, variant.productName),
      ),
    }))
    .filter((candidate) => candidate.score >= FUZZY_SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
  return suggested(scored);
}
