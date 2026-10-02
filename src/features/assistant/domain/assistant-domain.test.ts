import { describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";

import {
  assistantMode,
  canUseAssistant,
  operationRisk,
  operations,
  toolRisk,
} from "./assistant-policy";
import {
  canonicalJson,
  issueConfirmationToken,
  payloadHash,
  tokenMatches,
  verifyConfirmation,
  type StoredConfirmation,
} from "./confirmation-token";
import { assistantInstructions } from "./assistant-instructions";
import { resolveCatalogEntity, type CatalogEntry } from "./entity-match";
import { maskPhone, summarizeToolInput } from "./redaction";
import { assistantRequestSchema, toModelUserText } from "./user-message";
import { voiceMessages, voiceReducer, type VoiceState } from "./voice-state";

const owner: AdminActor = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "owner",
  displayName: "المالكة",
  role: "owner",
  active: true,
};

describe("assistant policy", () => {
  it("classifies reads, reversible and financial operations", () => {
    expect(toolRisk("searchProducts")).toBe(1);
    expect(toolRisk("getProfitSummary")).toBe(1);
    expect(toolRisk("prepareProductUpdate")).toBe(2);
    expect(toolRisk("prepareProductImageReplacement")).toBe(2);
    for (const name of [
      "prepareManualSale",
      "prepareCustomerPayment",
      "prepareInventoryCorrection",
      "prepareProductMerge",
      "prepareProductArchive",
      "prepareOrderCancellation",
    ]) {
      expect(toolRisk(name)).toBe(3);
    }
    for (const name of [
      "prepareUnusedProductDeletion",
      "prepareUnusedVariantDeletion",
      "prepareEmptyCategoryDeletion",
    ]) {
      expect(toolRisk(name)).toBe(4);
    }
    expect(toolRisk("prepareProductCreation")).toBe(2);
    expect(toolRisk("prepareProductCreationWithOpeningStock")).toBe(3);
    expect(toolRisk("anythingUnknown")).toBe(4);
    for (const operation of operations) {
      expect([2, 3, 4]).toContain(operationRisk[operation]);
    }
    for (const operation of [
      "productDelete",
      "variantDelete",
      "categoryDelete",
    ] as const) {
      expect(operationRisk[operation]).toBe(4);
    }
  });

  it("is off unless explicitly enabled, and owner-only", () => {
    expect(assistantMode(undefined)).toBe("off");
    expect(assistantMode("yes")).toBe("off");
    expect(assistantMode("full")).toBe("full");
    expect(canUseAssistant(owner, "full")).toBe(true);
    expect(canUseAssistant(owner, "off")).toBe(false);
    expect(canUseAssistant({ ...owner, role: "operator" }, "full")).toBe(false);
    expect(canUseAssistant({ ...owner, active: false }, "read")).toBe(false);
  });
});

describe("confirmation tokens", () => {
  const payload = {
    args: { domainId: "x", changes: { priceAgorot: 1400 } },
    card: {},
  };
  const issued = issueConfirmationToken();
  const stored = (
    overrides: Partial<StoredConfirmation> = {},
  ): StoredConfirmation => ({
    adminUserId: owner.id,
    operation: "productUpdate",
    payload,
    payloadHash: payloadHash("productUpdate", payload),
    recordVersion: "v1",
    tokenHash: issued.tokenHash,
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });
  const request = {
    adminUserId: owner.id,
    operation: "productUpdate",
    token: issued.token,
  };

  it("hashes payloads independently of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(payloadHash("productUpdate", { a: 1, b: 2 })).toBe(
      payloadHash("productUpdate", { b: 2, a: 1 }),
    );
    expect(payloadHash("productUpdate", { a: 1 })).not.toBe(
      payloadHash("productArchive", { a: 1 }),
    );
  });

  it("accepts only the exact, fresh, unused confirmation", () => {
    expect(verifyConfirmation(stored(), request, "v1", new Date())).toBeNull();
    expect(verifyConfirmation(null, request, "v1", new Date())).toBe(
      "not_found",
    );
    expect(
      verifyConfirmation(
        stored(),
        { ...request, adminUserId: "other" },
        "v1",
        new Date(),
      ),
    ).toBe("wrong_owner");
    expect(
      verifyConfirmation(
        stored(),
        { ...request, operation: "manualSale" },
        "v1",
        new Date(),
      ),
    ).toBe("wrong_operation");
    expect(
      verifyConfirmation(
        stored(),
        { ...request, token: issueConfirmationToken().token },
        "v1",
        new Date(),
      ),
    ).toBe("bad_token");
    expect(
      verifyConfirmation(
        stored({ status: "completed" }),
        request,
        "v1",
        new Date(),
      ),
    ).toBe("already_used");
    expect(
      verifyConfirmation(
        stored({ expiresAt: new Date(Date.now() - 1) }),
        request,
        "v1",
        new Date(),
      ),
    ).toBe("expired");
    expect(
      verifyConfirmation(
        stored({ payload: { ...payload, args: { domainId: "y" } } }),
        request,
        "v1",
        new Date(),
      ),
    ).toBe("tampered");
    expect(verifyConfirmation(stored(), request, "v2", new Date())).toBe(
      "stale",
    );
    expect(verifyConfirmation(stored(), request, null, new Date())).toBe(
      "stale",
    );
  });

  it("rejects malformed tokens without comparing", () => {
    expect(tokenMatches("short", issued.tokenHash)).toBe(false);
    expect(
      tokenMatches(`${issued.token.slice(0, 42)}!`, issued.tokenHash),
    ).toBe(false);
    expect(tokenMatches(issued.token, issued.tokenHash)).toBe(true);
  });
});

describe("entity resolution", () => {
  const catalog: CatalogEntry[] = [
    {
      productId: "degreaser-dalia",
      variantId: "degreaser-dalia--default",
      nameAr: "مزيل دهون داليا",
      latinName: "Dalia",
      variantLabel: null,
      sku: "DG-750",
      barcode: "7290000000017",
    },
    {
      productId: "oven-arar",
      variantId: "oven-arar--default",
      nameAr: "منظف أفران عرار",
      latinName: "Arar",
      variantLabel: null,
      sku: null,
      barcode: null,
    },
    {
      productId: "floor-smart",
      variantId: "floor-smart--1l",
      nameAr: "منظف أرضيات سمارت",
      latinName: "Smart",
      variantLabel: "1 لتر",
      sku: null,
      barcode: null,
    },
    {
      productId: "floor-smart",
      variantId: "floor-smart--4l",
      nameAr: "منظف أرضيات سمارت",
      latinName: "Smart",
      variantLabel: "4 لتر",
      sku: null,
      barcode: null,
    },
  ];

  it("resolves identifiers and exact names first", () => {
    expect(resolveCatalogEntity("7290000000017", catalog)).toMatchObject({
      status: "resolved",
      match: { productId: "degreaser-dalia", method: "barcode" },
    });
    expect(resolveCatalogEntity("dg-750", catalog)).toMatchObject({
      status: "resolved",
      match: { method: "sku" },
    });
    expect(resolveCatalogEntity("oven-arar", catalog)).toMatchObject({
      status: "resolved",
      match: { method: "id" },
    });
  });

  it("normalizes Arabic spelling and diacritics", () => {
    expect(resolveCatalogEntity("مُزيل دهون داليا", catalog)).toMatchObject({
      status: "resolved",
      match: { productId: "degreaser-dalia", method: "exact_name" },
    });
    expect(resolveCatalogEntity("منظف افران عرار", catalog)).toMatchObject({
      status: "resolved",
    });
  });

  it("asks which variant instead of guessing", () => {
    const result = resolveCatalogEntity("سمارت", catalog, "variant");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous")
      expect(result.candidates).toHaveLength(2);
    expect(resolveCatalogEntity("سمارت", catalog, "product").status).toBe(
      "resolved",
    );
  });

  it("returns fuzzy matches only as suggestions", () => {
    const result = resolveCatalogEntity("مزيل دهن دليا", catalog);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates[0]?.method).toBe("fuzzy");
    }
    expect(resolveCatalogEntity("شامبو سيارات", catalog).status).toBe(
      "not_found",
    );
  });
});

describe("redaction", () => {
  it("keeps identifiers and numbers, not free text or phones", () => {
    const summary = summarizeToolInput({
      productId: "degreaser-dalia",
      quantityMilli: 3000,
      phone: "0591234567",
      reason: "الزبون رجّعها",
      changes: { nameAr: "اسم جديد", priceAgorot: 1400 },
      items: [{ product: "x" }],
    });
    expect(summary).toEqual({
      productId: "degreaser-dalia",
      quantityMilli: 3000,
      phone: { chars: 10 },
      reason: { chars: 13 },
      changes: { nameAr: { chars: 8 }, priceAgorot: 1400 },
      items: { items: 1 },
    });
    expect(maskPhone("+970591234567")).toBe("••••567");
  });
});

describe("user message", () => {
  it("accepts only a plain user text message", () => {
    const base = {
      conversationId: null,
      message: {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "مرحبا" }],
      },
    };
    expect(assistantRequestSchema.safeParse(base).success).toBe(true);
    expect(
      assistantRequestSchema.safeParse({
        ...base,
        message: { ...base.message, role: "assistant" },
      }).success,
    ).toBe(false);
    expect(
      assistantRequestSchema.safeParse({
        ...base,
        message: {
          ...base.message,
          parts: [
            { type: "tool-prepareManualSale", state: "output-available" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      assistantRequestSchema.safeParse({
        ...base,
        message: {
          ...base.message,
          parts: [{ type: "text", text: "x".repeat(2_001) }],
        },
      }).success,
    ).toBe(false);
  });

  it("passes attachments to the model as opaque ids only", () => {
    expect(
      toModelUserText("هاي صورة جديدة", [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "image" },
      ]),
    ).toBe(
      "هاي صورة جديدة\n[مرفقات: صورة aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa]",
    );
  });
});

describe("voice states", () => {
  const run = (events: Parameters<typeof voiceReducer>[1][]) =>
    events.reduce<VoiceState>(voiceReducer, { name: "idle" });

  it("goes from permission to listening to an editable transcript", () => {
    expect(
      run([
        { type: "start" },
        { type: "granted", at: 1 },
        { type: "stop" },
        { type: "transcribed", transcript: "  كم ربحت اليوم  " },
      ]),
    ).toEqual({ name: "ready", transcript: "كم ربحت اليوم" });
  });

  it("explains denied permission, unsupported browsers and empty recordings", () => {
    expect(run([{ type: "start" }, { type: "denied" }])).toEqual({
      name: "failed",
      message: voiceMessages.denied,
    });
    expect(run([{ type: "unsupported" }])).toEqual({
      name: "failed",
      message: voiceMessages.unsupported,
    });
    expect(
      run([
        { type: "start" },
        { type: "granted", at: 1 },
        { type: "stop" },
        { type: "transcribed", transcript: " " },
      ]),
    ).toEqual({ name: "failed", message: voiceMessages.empty });
  });

  it("can be cancelled and ignores a late transcript", () => {
    expect(
      run([
        { type: "start" },
        { type: "granted", at: 1 },
        { type: "cancel" },
        { type: "transcribed", transcript: "x" },
      ]),
    ).toEqual({ name: "idle" });
  });
});

describe("assistant instructions", () => {
  it("tell the model in read mode that changes are disabled", () => {
    expect(assistantInstructions("read")).toContain("وضع القراءة فقط");
    expect(assistantInstructions("full")).not.toContain("وضع القراءة فقط");
  });
});
