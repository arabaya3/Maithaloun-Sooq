import { describe, expect, it } from "vitest";

import {
  forChanges,
  forSearch,
  resolveCatalogEntity,
  scopedCandidates,
  selectionQuestion,
  type CatalogEntry,
} from "./entity-match";
import { mustAnswerNow, shouldStopLoop } from "./loop-guard";
import {
  INTERRUPTED_TOOL_ERROR,
  messageStatus,
  settleMessageParts,
} from "./message-state";
import {
  applyDraftPatch,
  draftMissing,
  draftStage,
  draftToCreationInput,
  emptyDraft,
} from "./product-draft";
import { classifyChatFailure, prepareState } from "./result-state";

describe("interrupted messages", () => {
  it("closes dangling tool calls and streaming text so the next request still works", () => {
    const { parts, interrupted } = settleMessageParts([
      { type: "text", text: "جاري", state: "streaming" },
      {
        type: "tool-searchProducts",
        toolCallId: "c1",
        state: "input-available",
        input: { query: "منظف" },
      },
      {
        type: "tool-getDebtors",
        toolCallId: "c2",
        state: "output-available",
        input: {},
        output: { count: 0 },
      },
    ]);
    expect(interrupted).toBe(true);
    expect(parts[0]).toMatchObject({ state: "done" });
    expect(parts[1]).toMatchObject({
      state: "output-error",
      errorText: INTERRUPTED_TOOL_ERROR,
      input: { query: "منظف" },
    });
    expect(parts[2]).toMatchObject({ state: "output-available" });
  });

  it("leaves completed messages untouched and bounds stored text", () => {
    const long = "ن".repeat(9_000);
    const { parts, interrupted } = settleMessageParts([
      { type: "text", text: long, state: "done" },
    ]);
    expect(interrupted).toBe(false);
    expect((parts[0] as { text: string }).text).toHaveLength(8_000);
    expect(messageStatus({ status: "interrupted" })).toBe("interrupted");
    expect(messageStatus(null)).toBe("completed");
  });
});

describe("agent loop guard", () => {
  const step = (name: string, input: unknown, status = "found") => ({
    toolCalls: [{ toolName: name, input }],
    toolResults: [{ output: { status } }],
  });

  it("stops on an identical repeated tool call", () => {
    expect(
      shouldStopLoop([
        step("searchProducts", { query: "منظف" }),
        step("searchProducts", { query: "منظف" }),
      ]),
    ).toBe(true);
    expect(
      shouldStopLoop([
        step("searchProducts", { query: "منظف" }),
        step("searchProducts", { query: "مبيض" }),
      ]),
    ).toBe(false);
  });

  it("stops after two failing steps in a row", () => {
    expect(shouldStopLoop([step("a", 1, "error"), step("b", 2, "error")])).toBe(
      true,
    );
    expect(shouldStopLoop([step("a", 1, "error"), step("b", 2)])).toBe(false);
  });
});

describe("result states", () => {
  it("never reports completion from a prepare tool", () => {
    expect(prepareState({ status: "awaiting_confirmation" })).toBe(
      "ready_for_confirmation",
    );
    expect(prepareState({ status: "needs_selection" })).toBe(
      "needs_clarification",
    );
    expect(prepareState({ status: "rejected", code: "price_invalid" })).toBe(
      "needs_clarification",
    );
    expect(prepareState({ status: "rejected", code: "forbidden" })).toBe(
      "unsupported",
    );
    expect(prepareState({ status: "error" })).toBe("confirmation_failed");
  });

  it("classifies chat failures without reading provider messages into the reply", () => {
    expect(classifyChatFailure({ statusCode: 429 })).toBe("rate_limited");
    expect(classifyChatFailure({ code: "AI_NOT_CONFIGURED" })).toBe(
      "model_unavailable",
    );
    expect(classifyChatFailure({ statusCode: 503 })).toBe("model_unavailable");
    expect(classifyChatFailure({ name: "TimeoutError" })).toBe("timeout");
    expect(classifyChatFailure(new Error("boom"))).toBe("unknown");
  });
});

describe("ambiguity for changes", () => {
  const catalog: CatalogEntry[] = [
    {
      productId: "degreaser-8",
      variantId: "degreaser-8--default",
      nameAr: "مزيل دهون",
      latinName: null,
      variantLabel: "8 شيكل",
      sku: null,
      barcode: null,
    },
    {
      productId: "degreaser-10",
      variantId: "degreaser-10--default",
      nameAr: "مزيل دهون",
      latinName: null,
      variantLabel: "10 شيكل",
      sku: null,
      barcode: null,
    },
    {
      productId: "carpet-brush",
      variantId: "carpet-brush--default",
      nameAr: "فرشاة سجاد",
      latinName: null,
      variantLabel: null,
      sku: "BR-1",
      barcode: "7290000000001",
    },
  ];

  it("never guesses between similarly named products", () => {
    expect(resolveCatalogEntity("مزيل دهون", catalog).status).toBe("ambiguous");
  });

  it("turns a lone partial match into a one-option choice, but resolves exact identifiers", () => {
    const partial = forChanges(resolveCatalogEntity("فرشاة", catalog));
    expect(partial).toMatchObject({
      status: "ambiguous",
      candidates: [{ productId: "carpet-brush" }],
    });
    expect(forChanges(resolveCatalogEntity("BR-1", catalog)).status).toBe(
      "resolved",
    );
    expect(
      forChanges(resolveCatalogEntity("7290000000001", catalog)).status,
    ).toBe("resolved");
    expect(forChanges(resolveCatalogEntity("فرشاة سجاد", catalog)).status).toBe(
      "resolved",
    );
    // The definite article alone does not make a name approximate.
    expect(
      forChanges(resolveCatalogEntity("فرشاة السجاد", catalog)),
    ).toMatchObject({
      status: "resolved",
      match: { productId: "carpet-brush" },
    });
  });

  it("asks to confirm a unique partial match instead of calling it ambiguous", () => {
    const partial = forChanges(resolveCatalogEntity("فرشاة", catalog));
    if (partial.status !== "ambiguous") throw new Error("expected a choice");
    const question = selectionQuestion(partial.candidates, "فرشاة", "product");
    expect(question).toContain("نتيجة واحدة");
    expect(question).toContain("فرشاة سجاد");
    expect(question).not.toContain("أكثر من");
    expect(
      selectionQuestion(
        [...partial.candidates, { ...partial.candidates[0]!, productId: "x" }],
        "فرشاة",
        "product",
      ),
    ).toContain("أكثر من منتج");
  });

  it("names the product, not one of its variants, in a product-level choice", () => {
    const variants = [
      {
        productId: "musk",
        variantId: "musk--a",
        label: "مسك — لافندر",
        confidence: 85,
        method: "contains" as const,
      },
      {
        productId: "musk",
        variantId: "musk--b",
        label: "مسك — ورد",
        confidence: 85,
        method: "contains" as const,
      },
    ];
    expect(scopedCandidates(variants, "product")).toEqual([
      expect.objectContaining({ productId: "musk", label: "مسك" }),
    ]);
    expect(scopedCandidates(variants, "variant")).toHaveLength(2);
    expect(selectionQuestion(variants, "مس", "product")).toContain(
      "«مس»: مسك.",
    );
  });

  it("reports a unique partial search result as found and approximate", () => {
    expect(forSearch(resolveCatalogEntity("فرشاة", catalog))).toMatchObject({
      status: "resolved",
      approximate: true,
      match: { productId: "carpet-brush" },
    });
    expect(forSearch(resolveCatalogEntity("BR-1", catalog))).toMatchObject({
      status: "resolved",
      approximate: false,
    });
    expect(forSearch(resolveCatalogEntity("مزيل دهون", catalog)).status).toBe(
      "ambiguous",
    );
  });
});

describe("product draft", () => {
  const categories = [{ code: "home", nameAr: "مستلزمات منزلية" }];

  it("keeps valid fields when another field is rejected", () => {
    const { data, errors } = applyDraftPatch(
      emptyDraft(),
      {
        nameAr: "معطر لميس",
        fragrance: "لافندر",
        price: "عشرة دولار",
        category: "قسم غير موجود",
      },
      categories,
    );
    expect(data.fields.nameAr?.value).toBe("معطر لميس");
    expect(data.fields.fragrance?.value).toBe("لافندر");
    expect(data.fields.price).toBeUndefined();
    expect(errors.map((row) => row.field)).toEqual(["category", "price"]);
    expect(errors.find((row) => row.field === "price")?.message).toBe(
      "ما قدرت أحدد السعر. اكتبه مثلاً: 15 شيكل.",
    );
  });

  it("asks only for what is missing and builds the card input from the draft", () => {
    let data = applyDraftPatch(
      emptyDraft(["a1"]),
      { nameAr: "معطر لميس" },
      categories,
    ).data;
    expect(draftStage(data)).toBe("category_missing");
    data = applyDraftPatch(
      data,
      {
        category: "مستلزمات منزلية",
        price: "خمستعش",
        publication: "draft",
        openingQuantity: "12",
      },
      categories,
    ).data;
    expect(draftMissing(data)).toEqual(["openingUnitCost"]);
    data = applyDraftPatch(data, { openingUnitCost: "8 ش" }, categories).data;
    expect(draftStage(data)).toBe("ready_for_confirmation");
    expect(draftToCreationInput(data)).toMatchObject({
      attachmentIds: ["a1"],
      nameAr: "معطر لميس",
      category: "home",
      priceIls: "15.00",
      state: "draft",
      openingStock: { quantity: "12", unitCostIls: "8.00" },
    });
  });

  it("lets a single field be corrected or cleared", () => {
    let data = applyDraftPatch(
      emptyDraft(),
      { nameAr: "معطر", price: "10" },
      categories,
    ).data;
    data = applyDraftPatch(data, { price: "12.5" }, categories).data;
    expect(data.fields.price?.value).toBe(1_250);
    data = applyDraftPatch(data, { clear: ["price"] }, categories).data;
    expect(data.fields.price).toBeUndefined();
    expect(data.fields.nameAr?.value).toBe("معطر");
  });
});

describe("draft corrections", () => {
  it("drops the old value when a correction is rejected, so no card is built on it", () => {
    const categories = [{ code: "home", nameAr: "مستلزمات منزلية" }];
    let data = applyDraftPatch(
      emptyDraft(),
      {
        nameAr: "معطر",
        price: "15",
        category: "مستلزمات منزلية",
        publication: "draft",
      },
      categories,
    ).data;
    expect(draftStage(data)).toBe("ready_for_confirmation");
    data = applyDraftPatch(data, { price: "عشرة دولار" }, categories).data;
    expect(data.fields.price).toBeUndefined();
    expect(draftStage(data)).toBe("price_missing");
  });
});

describe("mustAnswerNow", () => {
  const call = (
    toolName: string,
    input: unknown,
    output: unknown = { status: "ok" },
  ) => ({
    toolCalls: [{ toolName, input }],
    toolResults: [{ output }],
  });

  it("forces a text answer after a repeated call or on the last allowed step", () => {
    const once = [call("searchProducts", { query: "منظف" })];
    expect(mustAnswerNow(once, 1, 8)).toBe(false);
    expect(mustAnswerNow([...once, ...once], 2, 8)).toBe(true);
    expect(mustAnswerNow(once, 7, 8)).toBe(true);
  });
});

describe("id lookup with a copied label", () => {
  const catalog = [
    {
      productId: "general-cleaner",
      variantId: "general-cleaner--default",
      nameAr: "منظف عام",
      latinName: "Secret",
      variantLabel: null,
      sku: null,
      barcode: null,
    },
  ];

  it("resolves an id followed by a label to that id", () => {
    expect(
      resolveCatalogEntity("منظف عام — general-cleaner--default", catalog),
    ).toMatchObject({
      status: "resolved",
      match: { variantId: "general-cleaner--default", method: "id" },
    });
    const found = resolveCatalogEntity("general-cleaner — Secret", catalog);
    expect(found).toMatchObject({
      status: "resolved",
      match: { productId: "general-cleaner", method: "id" },
    });
    const named = resolveCatalogEntity("منظف — عام", catalog);
    expect(named.status === "resolved" ? named.match.method : null).not.toBe(
      "id",
    );
  });
});
