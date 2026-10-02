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

function catalogPlan(
  words: string,
  attachments: string[],
  previous: (toolName: string) => Record<string, unknown> | null,
): Plan | null {
  if (/المعرّف create_new/.test(words)) {
    const input = previous("prepareProductCreation");
    if (input) {
      return {
        kind: "tool",
        toolName: "prepareProductCreation",
        input: { ...input, duplicateDecision: "create_new" },
      };
    }
  }
  if (/(?:اقرئي|حللي) (?:صورة|صور) المنتج/.test(words) && attachments.length) {
    return {
      kind: "tool",
      toolName: "analyzeProductImages",
      input: { attachmentIds: attachments.slice(0, 4) },
    };
  }
  let match =
    /أضيفي منتج (.+?)(?: ماركة (\S+))? بسعر (\d+(?:\.\d+)?) (?:في|قسم) (.+?) (مسودة|منشور)$/.exec(
      words,
    );
  if (match) {
    return {
      kind: "tool",
      toolName: "prepareProductCreation",
      input: {
        ...(attachments.length
          ? { attachmentIds: attachments.slice(0, 4) }
          : {}),
        nameAr: match[1]!,
        ...(match[2] ? { latinName: match[2] } : {}),
        priceIls: match[3]!,
        category: match[4]!,
        state: match[5] === "منشور" ? "published" : "draft",
        acceptPlaceholder: true,
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

function planFromUser(
  text: string,
  previous: (toolName: string) => Record<string, unknown> | null = () => null,
): Plan {
  const attachments = text.match(ATTACHMENT) ?? [];
  const words = text
    .replace(/\[مرفقات:[^\]]*\]/g, " ")
    .replace(/[؟?!.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  if (toolName === "analyzeProductImages") {
    const fields =
      (value.fields as Array<{ label: string; value: string }>) ?? [];
    return `قرأت من الصورة: ${fields
      .filter((row) => row.value)
      .map((row) => `${row.label} ${row.value}`)
      .join("، ")}. ما سعر البيع؟`;
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
    const plan: Plan = result
      ? { kind: "text", text: describe(result.toolName, result.value) }
      : planFromUser(
          lastUserText(options.prompt),
          previousToolInput(options.prompt),
        );
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
      return {
        stream: simulateReadableStream({
          chunks: respond(options),
          chunkDelayInMs: 5,
        }),
      };
    },
  };
}
