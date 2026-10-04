import { similarity } from "@/features/purchasing/domain/line-matching";
import { toLatinDigits } from "@/shared/lib/digits";
import {
  normalizeArabicText,
  normalizeReference,
} from "@/shared/lib/normalize-arabic";

export interface CatalogEntry {
  productId: string;
  variantId: string;
  nameAr: string;
  latinName: string | null;
  variantLabel: string | null;
  sku: string | null;
  barcode: string | null;
}

export interface EntityCandidate {
  productId: string;
  variantId: string;
  label: string;
  confidence: number;
  method: "id" | "barcode" | "sku" | "exact_name" | "contains" | "fuzzy";
}

export type EntityResolution =
  | { status: "resolved"; match: EntityCandidate }
  | { status: "ambiguous"; candidates: EntityCandidate[] }
  | { status: "not_found"; candidates: [] };

const MAX_CANDIDATES = 5;
const FUZZY_MIN = 45;

export function entryLabel(entry: CatalogEntry): string {
  const name = entry.latinName
    ? `${entry.nameAr} ${entry.latinName}`
    : entry.nameAr;
  return entry.variantLabel ? `${name} — ${entry.variantLabel}` : name;
}

function candidate(
  entry: CatalogEntry,
  confidence: number,
  method: EntityCandidate["method"],
): EntityCandidate {
  return {
    productId: entry.productId,
    variantId: entry.variantId,
    label: entryLabel(entry),
    confidence,
    method,
  };
}

function distinctProducts(list: EntityCandidate[]): EntityCandidate[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = `${item.productId}:${item.variantId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decide(
  list: EntityCandidate[],
  scope: "product" | "variant",
): EntityResolution {
  const unique = distinctProducts(list);
  const keys = new Set(
    unique.map((item) =>
      scope === "product"
        ? item.productId
        : `${item.productId}:${item.variantId}`,
    ),
  );
  if (keys.size === 1 && unique[0]) {
    return { status: "resolved", match: unique[0] };
  }
  return {
    status: "ambiguous",
    candidates: unique.slice(0, MAX_CANDIDATES),
  };
}

// Identifiers and exact names resolve; partial and fuzzy matches only ever produce choices.
export function resolveCatalogEntity(
  query: string,
  catalog: readonly CatalogEntry[],
  scope: "product" | "variant" = "product",
): EntityResolution {
  const raw = toLatinDigits(query).trim();
  if (!raw) return { status: "not_found", candidates: [] };

  const byId = catalog.filter(
    (entry) => entry.productId === raw || entry.variantId === raw,
  );
  if (byId.length) {
    const exactVariant = byId.filter((entry) => entry.variantId === raw);
    return decide(
      (exactVariant.length ? exactVariant : byId).map((entry) =>
        candidate(entry, 100, "id"),
      ),
      exactVariant.length ? "variant" : scope,
    );
  }
  const digits = raw.replace(/\s/g, "");
  const byBarcode = catalog.filter((entry) => entry.barcode === digits);
  if (byBarcode.length) {
    return decide(
      byBarcode.map((entry) => candidate(entry, 100, "barcode")),
      "variant",
    );
  }
  const reference = normalizeReference(raw);
  const bySku = catalog.filter(
    (entry) => entry.sku && normalizeReference(entry.sku) === reference,
  );
  if (bySku.length) {
    return decide(
      bySku.map((entry) => candidate(entry, 100, "sku")),
      "variant",
    );
  }

  const needle = normalizeArabicText(raw);
  if (needle.length < 2) return { status: "not_found", candidates: [] };
  const names = (entry: CatalogEntry) =>
    [
      entry.nameAr,
      entry.latinName ?? "",
      `${entry.nameAr} ${entry.latinName ?? ""}`,
      `${entry.nameAr} ${entry.variantLabel ?? ""}`,
      `${entry.nameAr} ${entry.latinName ?? ""} ${entry.variantLabel ?? ""}`,
    ]
      .map(normalizeArabicText)
      .filter(Boolean);

  const exact = catalog.filter((entry) => names(entry).includes(needle));
  if (exact.length) {
    return decide(
      exact.map((entry) => candidate(entry, 95, "exact_name")),
      scope,
    );
  }

  const tokens = needle.split(" ").filter((token) => token.length > 1);
  const contains = catalog.filter((entry) => {
    const haystack = normalizeArabicText(
      `${entry.nameAr} ${entry.latinName ?? ""} ${entry.variantLabel ?? ""} ${entry.sku ?? ""}`,
    );
    return (
      tokens.length > 0 && tokens.every((token) => haystack.includes(token))
    );
  });
  if (contains.length) {
    return decide(
      contains.map((entry) => candidate(entry, 85, "contains")),
      scope,
    );
  }

  const fuzzy = catalog
    .map((entry) =>
      candidate(
        entry,
        Math.max(...names(entry).map((name) => similarity(needle, name))),
        "fuzzy",
      ),
    )
    .filter((item) => item.confidence >= FUZZY_MIN)
    .sort((a, b) => b.confidence - a.confidence);
  if (!fuzzy.length) return { status: "not_found", candidates: [] };
  return {
    status: "ambiguous",
    candidates: distinctProducts(fuzzy).slice(0, MAX_CANDIDATES),
  };
}

// Changes act only on an identifier or an exact name; a lone partial match becomes a one-option choice.
export function forChanges(resolution: EntityResolution): EntityResolution {
  if (
    resolution.status === "resolved" &&
    (resolution.match.method === "contains" ||
      resolution.match.method === "fuzzy")
  ) {
    return { status: "ambiguous", candidates: [resolution.match] };
  }
  return resolution;
}

// A lone candidate is a "did you mean" confirmation, never presented as several matches.
export function selectionQuestion(
  candidates: readonly EntityCandidate[],
  query: string,
  scope: "product" | "variant",
): string {
  const wanted = query.trim().slice(0, 60);
  const shown = scopedCandidates(candidates, scope);
  if (shown.length === 1 && shown[0]) {
    return `لقيت نتيجة واحدة قريبة من «${wanted}»: ${shown[0].label}. هل هي المقصودة؟ اضغطي عليها للمتابعة.`;
  }
  return scope === "product"
    ? `لقيت أكثر من منتج قريب من «${wanted}»، أي واحد تقصدين؟`
    : `أي صنف بالضبط تقصدين بـ «${wanted}»؟`;
}

// Read-only search: one distinct partial match is a found result, flagged as approximate.
export function forSearch(
  resolution: EntityResolution,
): EntityResolution & { approximate: boolean } {
  if (resolution.status === "ambiguous") {
    const products = new Set(resolution.candidates.map((c) => c.productId));
    if (products.size === 1 && resolution.candidates[0]) {
      return {
        status: "resolved",
        match: resolution.candidates[0],
        approximate: true,
      };
    }
  }
  return {
    ...resolution,
    approximate:
      resolution.status === "resolved" &&
      (resolution.match.method === "contains" ||
        resolution.match.method === "fuzzy"),
  };
}

// A product-level choice names the product, never one of its variants, and lists each product once.
export function scopedCandidates(
  candidates: readonly EntityCandidate[],
  scope: "product" | "variant",
): EntityCandidate[] {
  if (scope === "variant") return [...candidates];
  const seen = new Set<string>();
  return candidates
    .filter((item) => !seen.has(item.productId) && seen.add(item.productId))
    .map((item) => ({ ...item, label: item.label.split(" — ")[0]! }));
}
