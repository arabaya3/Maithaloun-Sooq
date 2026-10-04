import "server-only";

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

type Plan =
  | { kind: "tool"; toolName: string; input: Record<string, unknown> }
  | { kind: "text"; text: string };

const ATTACHMENT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

type DraftView = Record<string, unknown> | null;

function unassignedImage(draft: DraftView) {
  const map =
    (draft?.imageMap as Array<{
      number: number;
      variant: string | null;
      suggestion: { value: string } | null;
    }>) ?? [];
  return map.find((image) => !image.variant) ?? null;
}

function variantPlan(words: string, draft: DraftView): Plan | null {
  const scents = /^الروائح (.+?)(?:، ?كلهم .+?)? والسعر .+$/.exec(words);
  if (scents && draft) {
    return {
      kind: "tool",
      toolName: "setDraftOptions",
      input: {
        options: [
          {
            nameAr: "الرائحة",
            kind: "fragrance",
            values: scents[1]!
              .split(/،\s*|\s+و(?=\S)/)
              .map((value) => value.trim())
              .filter(Boolean),
          },
        ],
      },
    };
  }
  const image = /^(?:هاي|هذه) الصورة (?:لل|ل)(.+)$/.exec(words);
  // Older tool results can fall out of the history; read the saved draft first.
  if (image && !draft) {
    return { kind: "tool", toolName: "getProductDraft", input: {} };
  }
  const pending = unassignedImage(draft);
  if (image && pending) {
    const option =
      (draft?.options as Array<{ name: string }> | undefined)?.[0]?.name ??
      "الرائحة";
    return {
      kind: "tool",
      toolName: "assignDraftImages",
      input: {
        assignments: [
          {
            image: pending.number,
            variant: [{ option, value: image[1]!.trim() }],
          },
        ],
      },
    };
  }
  const name = /^الاسم (.+)$/.exec(words);
  if (name && draft) {
    return {
      kind: "tool",
      toolName: "updateProductDraft",
      input: { nameAr: name[1]! },
    };
  }
  const category = /^القسم (.+)$/.exec(words);
  if (category && draft) {
    return {
      kind: "tool",
      toolName: "updateProductDraft",
      input: { category: category[1]! },
    };
  }
  const state = /^خليه (منشور|مسودة)$/.exec(words);
  if (state && draft) {
    return {
      kind: "tool",
      toolName: "updateProductDraft",
      input: { publication: state[1] === "منشور" ? "published" : "draft" },
    };
  }
  return null;
}

// The later steps of «الروائح … كلهم 450 مل والسعر 10 شيكل»: one price for every scent, then the shared size.
function followUp(
  toolName: string,
  words: string,
  value: Record<string, unknown>,
): Plan | null {
  if (toolName === "getProductDraft" && value.status === "draft") {
    return variantPlan(words, value);
  }
  if (toolName === "setDraftOptions") {
    const price = /والسعر (.+)$/.exec(words);
    if (price) {
      return {
        kind: "tool",
        toolName: "setDraftVariants",
        input: { changes: [{ match: [], price: price[1]!.trim() }] },
      };
    }
  }
  if (toolName === "setDraftVariants") {
    const size = /كلهم (\d+(?:\.\d+)? ?(?:مل|لتر|غرام))/.exec(words);
    if (size) {
      return {
        kind: "tool",
        toolName: "updateProductDraft",
        input: { size: size[1]! },
      };
    }
  }
  return null;
}

function catalogPlan(
  words: string,
  attachments: string[],
  previous: (toolName: string) => Record<string, unknown> | null,
): Plan | null {
  if (/المعرّف create_new/.test(words) && previous("prepareProductFromDraft")) {
    return {
      kind: "tool",
      toolName: "prepareProductFromDraft",
      input: { duplicateDecision: "create_new", acceptPlaceholder: true },
    };
  }
  if (/(?:اقرئي|حللي) (?:صورة|صور) المنتج/.test(words) && attachments.length) {
    return {
      kind: "tool",
      toolName: "startProductDraft",
      input: { attachmentIds: attachments.slice(0, 4) },
    };
  }
  const priced = /^(?:السعر|سعره) (.+)$/.exec(words);
  if (priced && previous("startProductDraft")) {
    return {
      kind: "tool",
      toolName: "updateProductDraft",
      input: { price: priced[1]! },
    };
  }
  let match =
    /أضيفي منتج (.+?)(?: ماركة (\S+))? بسعر (.+?) (?:في|قسم) (.+?) (مسودة|منشور)$/.exec(
      words,
    );
  if (match) {
    const fields = {
      nameAr: match[1]!,
      ...(match[2] ? { latinName: match[2] } : {}),
      price: match[3]!,
      category: match[4]!,
      publication: match[5] === "منشور" ? "published" : "draft",
    };
    return previous("startProductDraft") && !attachments.length
      ? { kind: "tool", toolName: "updateProductDraft", input: fields }
      : {
          kind: "tool",
          toolName: "startProductDraft",
          input: {
            ...(attachments.length
              ? { attachmentIds: attachments.slice(0, 4) }
              : {}),
            fields,
          },
        };
  }
  match = /^(انشري|اخفي) (.+)$/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareProductPublication",
      input: {
        product: match[2]!,
        state: match[1] === "انشري" ? "published" : "hidden",
        acceptPlaceholder: true,
      },
    };
  }
  match = /أضيفي صنف (.+?) لـ ?(.+?) بسعر (\d+(?:\.\d+)?)$/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareVariantCreation",
      input: { product: match[2]!, label: match[1]!, priceIls: match[3]! },
    };
  }
  match = /أضيفي قسم (.+?) بأيقونة (\S+)$/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareCategoryCreation",
      input: { nameAr: match[1]!, icon: match[2]! },
    };
  }
  match = /احذفي القسم (.+?) نهائي[اًا]*$/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareEmptyCategoryDeletion",
      input: { category: match[1]! },
    };
  }
  if (/^(?:شو الأقسام|اعرضي الأقسام)/.test(words)) {
    return { kind: "tool", toolName: "listCategories", input: {} };
  }
  return null;
}

function partyPlan(words: string): Plan | null {
  const tool = (toolName: string, input: Record<string, unknown>): Plan => ({
    kind: "tool",
    toolName,
    input,
  });
  let match = /^أضيفي زبون (.+?)(?: رقمه (\S+))?(?: عنوانه (.+))?$/.exec(words);
  if (match) {
    return tool("prepareCustomerCreation", {
      name: match[1]!,
      ...(match[2] ? { phone: match[2] } : {}),
      ...(match[3] ? { address: match[3] } : {}),
    });
  }
  match = /^اعملي عرض خصم (\d+) بالمية على (.+)$/.exec(words);
  if (match) {
    return tool("prepareOfferCreation", {
      nameAr: `خصم ${match[1]} على ${match[2]}`,
      kind: "percentage",
      value: match[1]!,
      products: [match[2]!],
      enabled: true,
    });
  }
  match = /^اعملي عرض سعر (\d+(?:\.\d+)?) على (.+)$/.exec(words);
  if (match) {
    return tool("prepareOfferCreation", {
      nameAr: `سعر خاص على ${match[2]}`,
      kind: "fixed_price",
      value: match[1]!,
      products: [match[2]!],
      enabled: true,
    });
  }
  match = /^كشف حساب المورد (.+)$/.exec(words);
  if (match) return tool("getSupplierStatement", { supplier: match[1]! });
  match = /^كشف حساب (.+)$/.exec(words);
  if (match) return tool("getCustomerStatement", { customer: match[1]! });
  match = /^ادمجي الزبون (.+?) مع (.+)$/.exec(words);
  if (match) {
    return tool("prepareCustomerMerge", {
      duplicate: match[1]!,
      target: match[2]!,
    });
  }
  match = /^زودي دين (.+?) (\d+(?:\.\d+)?) بسبب (.+)$/.exec(words);
  if (match) {
    return tool("prepareCustomerBalanceAdjustment", {
      customer: match[1]!,
      amountIls: match[2]!,
      direction: "increase_debt",
      reason: match[3]!,
    });
  }
  match = /^احذفي الزبون (.+?) نهائي[اًا]*$/.exec(words);
  if (match)
    return tool("prepareUnusedCustomerDeletion", { customer: match[1]! });
  match = /^أضيفي مورد (.+)$/.exec(words);
  if (match) return tool("prepareSupplierCreation", { nameAr: match[1]! });
  match = /^دفعة (\d+(?:\.\d+)?) للمورد (.+)$/.exec(words);
  if (match) {
    return tool("prepareSupplierPayment", {
      supplier: match[2]!,
      amountIls: match[1]!,
    });
  }
  return null;
}

function normalizeWords(text: string) {
  return text
    .replace(/\[مرفقات:[^\]]*\]/g, " ")
    .replace(/رد بطيء/g, " ")
    .replace(/[؟?!.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function planFromUser(
  text: string,
  previous: (toolName: string) => Record<string, unknown> | null = () => null,
  draft: DraftView = null,
): Plan {
  const attachments = text.match(ATTACHMENT) ?? [];
  const words = normalizeWords(text);
  // Misbehaving replies a real model could produce, used to prove the grounding guard.
  if (words === "اخترعي سعر") {
    return { kind: "text", text: "سعر المنظف 37 شيكل." };
  }
  if (words === "ادعي النجاح") {
    return { kind: "text", text: "تم الحذف بنجاح." };
  }
  let archive = /^(?:أرشفي|ارشفي) الصنف (.+)$/.exec(words);
  if (archive) {
    return {
      kind: "tool",
      toolName: "prepareVariantArchive",
      input: { variant: archive[1]!, mode: "archive" },
    };
  }
  archive = /^(?:رجعي|رجّعي|استرجعي) الصنف (.+)$/.exec(words);
  if (archive) {
    return {
      kind: "tool",
      toolName: "prepareVariantArchive",
      input: { variant: archive[1]!, mode: "restore" },
    };
  }
  const party = partyPlan(words);
  if (party) return party;
  const variants = variantPlan(words, draft);
  if (variants) return variants;
  const catalog = catalogPlan(words, attachments, previous);
  if (catalog) return catalog;
  let match = /غي[ّ]?ر اسم (.+?) (?:إلى|الى) (.+)$/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareProductUpdate",
      input: { product: match[1]!, changes: { nameAr: match[2]! } },
    };
  }
  match = /سعر (?:بيع )?(.+?) (?:إلى|الى) (\d+(?:\.\d+)?)/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareProductUpdate",
      input: { product: match[1]!, changes: { priceIls: match[2]! } },
    };
  }
  match = /صورة (?:جديدة )?(?:للمنتج |لـ ?|ل)?(.+)$/.exec(words);
  if (match && attachments[0]) {
    return {
      kind: "tool",
      toolName: "prepareProductImageReplacement",
      input: { product: match[1]!.trim(), attachmentId: attachments[0] },
    };
  }
  match = /سجل(?:ي)? دفعة (\d+(?:\.\d+)?) (?:شيقل |شيكل )?من (.+)$/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareCustomerPayment",
      input: { customer: match[2]!, amountIls: match[1]! },
    };
  }
  match = /عندي من (.+?) (\d+(?:\.\d+)?) (?:حب[ةه] )?بدل/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareInventoryCorrection",
      input: { product: match[1]!, reason: "correction", quantity: match[2]! },
    };
  }
  if (/كم ربحت|الربح/.test(words)) {
    return {
      kind: "tool",
      toolName: "getProfitSummary",
      input: { period: words.includes("اليوم") ? "today" : "week" },
    };
  }
  if (/كم بعت|المبيعات/.test(words)) {
    return {
      kind: "tool",
      toolName: "getSalesSummary",
      input: { period: words.includes("الأسبوع") ? "week" : "today" },
    };
  }
  if (/قربت تخلص|لازم اطلب|لازم أطلب|نواقص/.test(words)) {
    return { kind: "tool", toolName: "getLowStockItems", input: {} };
  }
  if (/عليه ديون|الديون/.test(words)) {
    return { kind: "tool", toolName: "getDebtors", input: {} };
  }
  if (/قيمة (?:البضاعة|المخزون)/.test(words)) {
    return { kind: "tool", toolName: "getInventorySummary", input: {} };
  }
  match = /(?:ابحث عن|دور على|وين) (.+)$/.exec(words);
  if (match) {
    return {
      kind: "tool",
      toolName: "searchProducts",
      input: { query: match[1]! },
    };
  }
  return {
    kind: "text",
    text: "ممكن توضحي الطلب؟ مثلاً: «ابحث عن منظف» أو «غير اسم … إلى …».",
  };
}

function describe(toolName: string, value: Record<string, unknown>): string {
  const status = value.status;
  if (status === "awaiting_confirmation") {
    return `جهّزت العملية: ${String(value.summary)}. راجعي البطاقة واضغطي «تأكيد» إذا كل شي صحيح.`;
  }
  if (status === "needs_selection") return String(value.question);
  if (status === "rejected" || status === "error" || status === "forbidden") {
    return String(value.message);
  }
  if (toolName === "searchProducts") {
    const results =
      (value.results as Array<{ label: string; price: string }>) ?? [];
    if (!results.length) return "ما لقيت منتجات بهذا الاسم.";
    return `لقيت: ${results.map((row) => `${row.label} (${row.price})`).join("، ")}.`;
  }
  if (toolName === "getProfitSummary") {
    return `الربح الإجمالي (${String(value.period)}): ${String(value.grossProfit)} من صافي مبيعات ${String(value.netSales)}.`;
  }
  if (toolName === "getSalesSummary") {
    return `صافي المبيعات (${String(value.period)}): ${String(value.netSales)} في ${String(value.orderCount)} عملية.`;
  }
  if (toolName === "getLowStockItems") {
    const items =
      (value.items as Array<{ name: string; available: string }>) ?? [];
    return items.length
      ? `لازم تطلبي: ${items.map((row) => `${row.name} (${row.available})`).join("، ")}.`
      : "ما في نواقص حالياً.";
  }
  if (toolName === "getDebtors") {
    return Number(value.count)
      ? `عليهم ديون بمجموع ${String(value.total)}.`
      : "ما حدا عليه ديون.";
  }
  if (value.status === "draft") {
    const pending = unassignedImage(value);
    const options = (value.options as Array<{ name: string }>) ?? [];
    if (pending && options.length) {
      const guess = pending.suggestion
        ? ` (يمكن ${pending.suggestion.value})`
        : "";
      return `ما قدرت أتأكد من الصورة ${pending.number}${guess}. لأي ${options[0]!.name} هي؟`;
    }
    const fields =
      (value.fields as Array<{ label: string; value: string }>) ?? [];
    const missing = (value.missing as string[]) ?? [];
    const errors =
      (value.errors as Array<{ label: string; message: string }>) ?? [];
    return [
      `المسودة: ${fields.map((row) => `${row.label} ${row.value}`).join("، ")}.`,
      ...errors.map((row) => row.message),
      missing.length ? `ناقص: ${missing.join("، ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (
    toolName === "getCustomerStatement" ||
    toolName === "getSupplierStatement"
  ) {
    return `كشف الحساب من ${String(value.from)} إلى ${String(value.to)}: الرصيد الختامي ${String(value.closing)}.`;
  }
  if (toolName === "listCategories") {
    const rows = (value.categories as Array<{ name: string }>) ?? [];
    return `الأقسام: ${rows.map((row) => row.name).join("، ")}.`;
  }
  if (toolName === "getInventorySummary") {
    return `قيمة المخزون الحالية ${String(value.inventoryValue ?? "غير متاحة")}.`;
  }
  return "تم.";
}

function lastToolResult(prompt: LanguageModelV4Prompt) {
  const last = prompt.at(-1);
  if (last?.role !== "tool") return null;
  const part = last.content.find((item) => item.type === "tool-result");
  if (!part || part.type !== "tool-result") return null;
  const output = part.output;
  const value =
    output.type === "json" && output.value && typeof output.value === "object"
      ? (output.value as Record<string, unknown>)
      : {};
  return { toolName: part.toolName, value };
}

function previousToolInput(prompt: LanguageModelV4Prompt) {
  return (toolName: string) => {
    for (let index = prompt.length - 1; index >= 0; index -= 1) {
      const message = prompt[index]!;
      if (message.role !== "assistant") continue;
      for (const part of message.content) {
        if (part.type === "tool-call" && part.toolName === toolName) {
          return (
            typeof part.input === "string" ? JSON.parse(part.input) : part.input
          ) as Record<string, unknown>;
        }
      }
    }
    return null;
  };
}

function lastDraftView(prompt: LanguageModelV4Prompt): DraftView {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index]!;
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result" || part.output.type !== "json") continue;
      const value = part.output.value as Record<string, unknown> | null;
      if (value && value.status === "draft") return value;
    }
  }
  return null;
}

function lastUserText(prompt: LanguageModelV4Prompt): string {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index]!;
    if (message.role === "user") {
      return message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join(" ");
    }
  }
  return "";
}

function chunks(plan: Plan, callId: string): LanguageModelV4StreamPart[] {
  if (plan.kind === "tool") {
    return [
      {
        type: "tool-call",
        toolCallId: callId,
        toolName: plan.toolName,
        input: JSON.stringify(plan.input),
      },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
      },
    ];
  }
  const words = plan.text.split(" ");
  return [
    { type: "text-start", id: "t1" },
    ...words.map((word, index) => ({
      type: "text-delta" as const,
      id: "t1",
      delta: index ? ` ${word}` : word,
    })),
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage,
    },
  ];
}

// Deterministic stand-in for tests and local development: real tools run, only the model is scripted.
export function createFakeAssistantModel(): LanguageModelV4 {
  let calls = 0;
  const respond = (options: LanguageModelV4CallOptions) => {
    calls += 1;
    const result = lastToolResult(options.prompt);
    const draftReady =
      result?.value.status === "draft" &&
      result.value.state === "ready_for_confirmation" &&
      !result.value.submitted;
    const userText = lastUserText(options.prompt);
    const next = result
      ? followUp(result.toolName, normalizeWords(userText), result.value)
      : null;
    const plan: Plan = draftReady
      ? {
          kind: "tool",
          toolName: "prepareProductFromDraft",
          input: { acceptPlaceholder: true },
        }
      : (next ??
        (result
          ? { kind: "text", text: describe(result.toolName, result.value) }
          : planFromUser(
              userText,
              previousToolInput(options.prompt),
              lastDraftView(options.prompt),
            )));
    return chunks(plan, `fake-call-${calls}`);
  };
  return {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake-assistant-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("FAKE_MODEL_STREAM_ONLY");
    },
    async doStream(options) {
      // "رد بطيء" streams slowly so tests can drop the connection mid-reply.
      const slow = /رد بطيء/.test(lastUserText(options.prompt));
      return {
        stream: simulateReadableStream({
          chunks: respond(options),
          chunkDelayInMs: slow ? 400 : 5,
        }),
      };
    },
  };
}
