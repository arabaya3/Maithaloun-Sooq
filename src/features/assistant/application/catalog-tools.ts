import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  draftLabels,
  draftMissing,
  draftPatchSchema,
  draftToCreationInput,
  type DraftFieldName,
  type DraftPatch,
  type ProductDraftData,
} from "@/features/assistant/domain/product-draft";

import {
  assignDraftImage,
  choicePairsSchema,
  choicesToRecord,
  draftOptionsSchema,
  draftVariantPatchSchema,
  emptyVariantDraft,
  patchDraftVariants,
  resolveImageSuggestions,
  setDraftOptions,
  variantDraftMissing,
  variantDraftToSet,
  type VariantDraftData,
} from "@/features/assistant/domain/product-draft-variants";

import { ProductDraftService } from "./product-draft-service";

import { can } from "@/features/admin/domain/permissions";
import {
  categoryIconKeys,
  categoryIconLabels,
} from "@/features/catalog/domain/category";
import { formatIls } from "@/shared/lib/format-currency";
import { candidateFieldNames } from "@/server/ai/product-image-analyzer";

import { amountRefusal } from "./amount-refusal";
import type { PrepareResult } from "./assistant-operations";
import type {
  AssistantToolContext,
  PrepareToolOutput,
} from "./assistant-tools";
import { publicationStates, variantAttributeInput } from "./catalog-operations";

type Run = <T>(
  name: string,
  input: unknown,
  action: () => Promise<T>,
) => Promise<T | { status: "error"; message: string }>;
type Prepare = (
  name: string,
  input: unknown,
  build: () => Promise<PrepareResult>,
) => Promise<PrepareToolOutput | { status: "error"; message: string }>;

const text = (max: number) => z.string().trim().min(1).max(max);
const product = text(160).describe(
  "اسم المنتج كما قالته المستخدمة، أو productId",
);
const variant = text(160).describe(
  "اسم المنتج مع الصنف مثل «منظف أرضيات — 2 لتر»، أو variantId",
);
const category = text(80).describe("اسم القسم بالعربي أو رمزه");
const money = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .describe(
    'المبلغ كما كتبته المستخدمة حرفياً، مثل "15" أو "15 شيكل" أو "خمستعش". لا تحوّله ولا تحسبه؛ الخادم يقرؤه.',
  );
const identifier = z.string().trim().max(64);
const icon = z
  .enum(categoryIconKeys)
  .describe(
    categoryIconKeys
      .map((key) => `${key}=${categoryIconLabels[key]}`)
      .join("، "),
  );
const state = z
  .enum(publicationStates)
  .describe(
    "draft=مسودة غير ظاهرة، published=منشور ومتوفر، published_unavailable=منشور لكن غير متوفر، hidden=مخفي",
  );

export function createCatalogTools(
  context: AssistantToolContext,
  run: Run,
  prepare: Prepare,
) {
  const { actor } = context;
  const ops = context.operations.catalogOps;

  const drafts = new ProductDraftService(context.database);
  const draftAmountRefusal = (name: string, input: unknown) => {
    const refused = amountRefusal(context, input);
    return refused
      ? run(name, { refused: refused.code }, async () => ({
          ...refused,
          state: "needs_clarification" as const,
        }))
      : null;
  };
  const noDraft = {
    status: "rejected" as const,
    code: "missing_draft",
    message: "لا توجد مسودة منتج مفتوحة. ابدئي بوصف المنتج أو إرفاق صوره.",
  };
  const draftCategories = async () =>
    (await context.authoring.listCategories()).map((row) => ({
      code: row.code,
      nameAr: row.nameAr,
    }));

  // Image reads only fill high-confidence fields; everything else becomes a suggestion to confirm.
  async function readProductImages(attachmentIds: string[]): Promise<
    | {
        ok: true;
        imageFields: DraftPatch;
        suggestions: ProductDraftData["suggestions"];
      }
    | {
        ok: false;
        rejection: { status: "rejected"; code: string; message: string };
      }
  > {
    const images: Buffer[] = [];
    for (const id of attachmentIds) {
      const file = await context.attachments.read(actor, id);
      if (!file || file.mimeType !== "image/jpeg") {
        return {
          ok: false,
          rejection: {
            status: "rejected",
            code: "unsupported_file",
            message:
              "إحدى المرفقات ليست صورة أو انتهت صلاحيتها. أعيدي إرفاق صور المنتج.",
          },
        };
      }
      images.push(file.bytes);
    }
    const categories = await context.authoring.listCategories();
    let candidates;
    try {
      candidates = await context
        .imageAnalyzer()
        .analyze({ images, categories });
    } catch {
      return {
        ok: false,
        rejection: {
          status: "rejected",
          code: "extraction_failed",
          message:
            "ما قدرت أقرأ الصور الآن. اكتبي اسم المنتج وبياناته، أو أعيدي المحاولة.",
        },
      };
    }
    const imageFields: Record<string, string> = {};
    const suggestions: ProductDraftData["suggestions"] = [];
    const targets: Partial<
      Record<(typeof candidateFieldNames)[number], DraftFieldName>
    > = {
      nameAr: "nameAr",
      brand: "brand",
      latinName: "latinName",
      categoryCode: "category",
      description: "description",
      size: "size",
      unit: "unit",
      barcode: "barcode",
      fragrance: "fragrance",
      packageCount: "packageCount",
    };
    for (const name of candidateFieldNames) {
      const field = candidates[name];
      const target = targets[name];
      const value =
        name === "categoryCode"
          ? categories.find((row) => row.code === field.value)?.nameAr
          : field.value?.trim();
      if (!target || !value || field.source === "none") continue;
      if (field.confidence >= 0.7) imageFields[target] = value;
      else
        suggestions.push({
          field: target,
          value: value.slice(0, 160),
          confidence: Math.round(field.confidence * 100) / 100,
        });
    }
    const parsed = draftPatchSchema.safeParse(imageFields);
    return {
      ok: true,
      imageFields: parsed.success ? parsed.data : {},
      suggestions,
    };
  }

  // One photo at a time, so each image gets its own scent or colour reading with a confidence.
  async function readEachImage(attachmentIds: string[]) {
    const categories = await context.authoring.listCategories();
    const images = [];
    for (const [index, id] of attachmentIds.entries()) {
      const file = await context.attachments.read(actor, id);
      let suggestion: { value: string; confidence: number } | null = null;
      if (file && file.mimeType === "image/jpeg") {
        try {
          const read = await context
            .imageAnalyzer()
            .analyze({ images: [file.bytes], categories });
          const best = [read.fragrance, read.color]
            .filter(
              (field) => field && field.value.trim() && field.source !== "none",
            )
            .sort((left, right) => right.confidence - left.confidence)[0];
          if (best) {
            suggestion = {
              value: best.value.trim().slice(0, 60),
              confidence: Math.round(best.confidence * 100) / 100,
            };
          }
        } catch {
          suggestion = null;
        }
      }
      images.push({
        attachmentId: id,
        primary: index === 0,
        assignment: null,
        suggestion,
      });
    }
    return images;
  }

  async function withVariantDraft(
    change: (draft: VariantDraftData) => {
      variantDraft: VariantDraftData;
      messages: string[];
    },
  ) {
    const draft = await drafts.current(actor, context.conversationId);
    if (!draft) return noDraft;
    const result = change(draft.data.variantDraft ?? emptyVariantDraft());
    const data = { ...draft.data, variantDraft: result.variantDraft };
    await drafts.replaceData(actor, context.conversationId, data);
    return drafts.view(data, await draftCategories(), {
      expiresAt: draft.expiresAt,
      messages: result.messages,
    });
  }

  const read = {
    searchProductDuplicates: tool({
      description:
        "ابحث عن منتجات قد تكون نفس المنتج قبل إضافته (بالاسم أو الماركة أو الباركود أو SKU).",
      inputSchema: z
        .object({
          nameAr: z.string().trim().max(160).optional(),
          latinName: z.string().trim().max(120).optional(),
          barcode: identifier.optional(),
          sku: identifier.optional(),
          size: z.string().trim().max(40).optional(),
        })
        .strict(),
      execute: (input) =>
        run("searchProductDuplicates", input, async () => {
          const matches = await context.authoring.findDuplicates(input);
          return { count: matches.length, matches };
        }),
    }),
    listCategories: tool({
      description: "قائمة أقسام المتجر مع عدد المنتجات وحالة الظهور.",
      inputSchema: z
        .object({ includeArchived: z.boolean().optional() })
        .strict(),
      execute: (input) =>
        run("listCategories", input, async () => {
          const rows = await context.authoring.listCategories(
            Boolean(input.includeArchived),
          );
          return {
            categories: rows.map((row) => ({
              code: row.code,
              name: row.nameAr,
              icon: categoryIconLabels[row.icon],
              visible: row.visible,
              archived: row.archived,
              products: row.productCount,
            })),
            href: "/admin/products",
          };
        }),
    }),
    checkProductPublication: tool({
      description: "تحقق هل المنتج جاهز للنشر في المتجر، وما الذي ينقصه.",
      inputSchema: z.object({ product }).strict(),
      execute: (input) =>
        run("checkProductPublication", input, async () => {
          const resolved = await context.operations.resolveProduct(
            actor,
            input.product,
            "product",
            "product",
          );
          if (!resolved.ok) return resolved.result;
          const check = await context.authoring.publicationCheck(
            resolved.product.id,
          );
          if (!check) return { status: "not_found" as const };
          return {
            status: "checked" as const,
            product: resolved.product.nameAr,
            ready: check.ready,
            problems: check.problems,
            usesPlaceholderImage: check.acceptedPlaceholder,
            price: formatIls(resolved.product.priceAgorot),
            href: `/admin/products/${resolved.product.id}`,
          };
        }),
    }),
  };

  if (context.mode !== "full") return { read, mutate: {} };

  const attributes = variantAttributeInput.describe(
    "خصائص الصنف كما قالتها المستخدمة أو كما ظهرت بوضوح في الصورة؛ لا تخترع قيماً",
  );

  const mutate = {
    startProductDraft: tool({
      description:
        "لمنتج جديد فقط: ابدأ مسودة منتج جديد محفوظة على الخادم. إذا قالت المستخدمة إن الصورة لمنتج موجود («حطي هاي الصورة لـ…») فلا تستعملها؛ استعمل prepareProductImageReplacement. أرسل attachmentIds لقراءة صور المنتج، وأي حقول قالتها المستخدمة صراحة في fields. يعيد ما قُرئ وما ينقص. يلغي أي مسودة سابقة في هذه المحادثة.",
      inputSchema: z
        .object({
          attachmentIds: z.array(z.uuid()).max(4).optional(),
          fields: draftPatchSchema.optional(),
        })
        .strict(),
      execute: (input) =>
        draftAmountRefusal("startProductDraft", input) ??
        run(
          "startProductDraft",
          { images: input.attachmentIds?.length ?? 0 },
          async () => {
            if (!can(actor, "settings.manage")) {
              return {
                status: "forbidden" as const,
                message: "إضافة المنتجات للمالك فقط.",
              };
            }
            const categories = await draftCategories();
            let imageFields: DraftPatch = {};
            let suggestions: ProductDraftData["suggestions"] = [];
            if (input.attachmentIds?.length) {
              const read = await readProductImages(input.attachmentIds);
              if (!read.ok) return read.rejection;
              ({ imageFields, suggestions } = read);
            }
            const started = await drafts.start(
              actor,
              context.conversationId,
              {
                attachmentIds: input.attachmentIds ?? [],
                imageFields,
                suggestions,
                userFields: input.fields ?? {},
              },
              categories,
            );
            let data = started.data;
            if ((input.attachmentIds?.length ?? 0) > 1) {
              data = {
                ...data,
                variantDraft: {
                  ...emptyVariantDraft(),
                  images: await readEachImage(input.attachmentIds!),
                },
              };
              await drafts.replaceData(actor, context.conversationId, data);
            }
            const draft = await drafts.current(actor, context.conversationId);
            return drafts.view(data, categories, {
              errors: started.errors,
              expiresAt: draft!.expiresAt,
            });
          },
        ),
    }),
    updateProductDraft: tool({
      description:
        "عدّل حقولاً في مسودة المنتج الحالية بما قالته المستخدمة فقط: الاسم، القسم، السعر كما كُتب، الرائحة، اللون، الحجم، SKU، الباركود، حالة الظهور، والرصيد الافتتاحي وتكلفته. الحقول الصحيحة تُحفظ حتى لو رُفض حقل آخر. clear يمسح حقولاً.",
      inputSchema: draftPatchSchema,
      execute: (input) =>
        draftAmountRefusal("updateProductDraft", input) ??
        run("updateProductDraft", { fields: Object.keys(input) }, async () => {
          const categories = await draftCategories();
          const updated = await drafts.update(
            actor,
            context.conversationId,
            input,
            categories,
          );
          if (!updated) return noDraft;
          const draft = await drafts.current(actor, context.conversationId);
          return drafts.view(updated.data, categories, {
            errors: updated.errors,
            expiresAt: draft!.expiresAt,
          });
        }),
    }),
    setDraftOptions: tool({
      description:
        "حدّد خيارات المنتج في المسودة (مثل الرائحة: لافندر، ورد أبيض، مسك) كما قالتها المستخدمة. ينشئ صنفاً لكل تركيبة ويحتفظ بالتفاصيل السابقة للتركيبات الباقية. لا تخترع قيماً.",
      inputSchema: z.object({ options: draftOptionsSchema.min(1) }).strict(),
      execute: (input) =>
        run("setDraftOptions", { options: input.options.length }, () =>
          withVariantDraft((variantDraft) => {
            const result = setDraftOptions(variantDraft, input.options);
            return {
              variantDraft: resolveImageSuggestions(result.draft),
              messages: result.error ? [result.error] : [],
            };
          }),
        ),
    }),
    setDraftVariants: tool({
      description:
        "عدّل أصناف المسودة بما قالته المستخدمة: match يحدد الأصناف (فارغ = كل الأصناف، أو { الخيار: القيمة } لمجموعة)، مع price كما كُتب، packCount (عدد القطع في وحدة البيع)، sku وbarcode لصنف واحد، والرصيد الافتتاحي وتكلفته. «الأزرق 12 والزهري 10» = تغييران.",
      inputSchema: z
        .object({ changes: z.array(draftVariantPatchSchema).min(1).max(20) })
        .strict(),
      execute: (input) =>
        draftAmountRefusal("setDraftVariants", input) ??
        run("setDraftVariants", { changes: input.changes.length }, () =>
          withVariantDraft((variantDraft) => {
            if (!variantDraft.options.length) {
              return {
                variantDraft,
                messages: ["حددي خيارات المنتج أولاً (مثل الروائح)."],
              };
            }
            const result = patchDraftVariants(variantDraft, input.changes);
            return { variantDraft: result.draft, messages: result.errors };
          }),
        ),
    }),
    assignDraftImages: tool({
      description:
        "اربط صور المسودة بالأصناف حسب كلام المستخدمة: image رقم الصورة، variant { الخيار: القيمة } أو shared=true لصورة المنتج كله، وprimary لجعلها الرئيسية. لا تربط صورة بقيمة لم تقلها المستخدمة أو لم تظهر بثقة.",
      inputSchema: z
        .object({
          assignments: z
            .array(
              z
                .object({
                  image: z.number().int().min(1).max(8),
                  variant: choicePairsSchema.optional(),
                  shared: z.boolean().optional(),
                  primary: z.boolean().optional(),
                })
                .strict(),
            )
            .min(1)
            .max(8),
        })
        .strict(),
      execute: (input) =>
        run("assignDraftImages", { images: input.assignments.length }, () =>
          withVariantDraft((variantDraft) => {
            const messages: string[] = [];
            let next = variantDraft;
            for (const item of input.assignments) {
              const target =
                item.shared || !item.variant?.length
                  ? "shared"
                  : choicesToRecord(item.variant);
              const result = assignDraftImage(
                next,
                item.image - 1,
                target,
                item.primary,
              );
              if (result.error) messages.push(result.error);
              else next = result.draft;
            }
            return { variantDraft: next, messages };
          }),
        ),
    }),
    getProductDraft: tool({
      description: "اعرض مسودة المنتج الحالية في هذه المحادثة وما ينقصها.",
      inputSchema: z.object({}).strict(),
      execute: () =>
        run("getProductDraft", {}, async () => {
          const draft = await drafts.current(actor, context.conversationId);
          if (!draft) return noDraft;
          return drafts.view(draft.data, await draftCategories(), {
            submitted: draft.status === "submitted",
            expiresAt: draft.expiresAt,
          });
        }),
    }),
    cancelProductDraft: tool({
      description: "ألغِ مسودة المنتج الحالية عندما تطلب المستخدمة ذلك.",
      inputSchema: z.object({}).strict(),
      execute: () =>
        run("cancelProductDraft", {}, async () => {
          const cancelled = await drafts.setStatus(
            actor,
            context.conversationId,
            "cancelled",
          );
          return cancelled
            ? { status: "cancelled" as const, state: "cancelled" as const }
            : noDraft;
        }),
    }),
    prepareProductFromDraft: tool({
      description:
        "جهّز بطاقة التأكيد من مسودة المنتج المحفوظة على الخادم فقط، بعد اكتمال الاسم والقسم والسعر وحالة الظهور. لا ترسل بيانات المنتج هنا. duplicateDecision=create_new فقط إذا اختارت المستخدمة «منتج جديد مختلف» من الخيارات.",
      inputSchema: z
        .object({
          duplicateDecision: z.enum(["create_new"]).optional(),
          acceptPlaceholder: z.boolean().optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareProductFromDraft", input, async () => {
          const draft = await drafts.current(actor, context.conversationId);
          if (!draft) {
            return {
              status: "rejected",
              code: "missing_draft",
              message: noDraft.message,
            };
          }
          const missing = draftMissing(draft.data);
          const variantDraft = draft.data.variantDraft;
          const fallbackPrice =
            typeof draft.data.fields.price?.value === "number"
              ? draft.data.fields.price.value
              : undefined;
          const variantMissing = variantDraft?.options.length
            ? variantDraftMissing(variantDraft, fallbackPrice)
            : [];
          if (missing.length || variantMissing.length) {
            return {
              status: "rejected",
              code: "missing_required_field",
              message: `ناقص قبل التجهيز: ${[...missing.map((field) => draftLabels[field]), ...variantMissing].join("، ")}.`,
            };
          }
          if (variantDraft?.options.length) {
            const base = draftToCreationInput(draft.data);
            const duplicates = await context.authoring.findDuplicates({
              nameAr: base.nameAr,
              latinName: base.latinName ?? null,
            });
            if (duplicates.length && input.duplicateDecision !== "create_new") {
              return {
                status: "needs_selection",
                field: "duplicateDecision",
                question: "لقيت منتجات مشابهة. هل هو واحد منها أم منتج جديد؟",
                options: [
                  ...duplicates.map((row) => ({
                    id: row.productId,
                    label: `الموجود: ${row.label} (${row.reasons.join("، ")})`,
                  })),
                  { id: "create_new", label: "منتج جديد مختلف" },
                ],
              };
            }
            const converted = variantDraftToSet(variantDraft, fallbackPrice);
            const categories = await draftCategories();
            const prepared = context.operations.mediaOps.prepareProductSet(
              actor,
              {
                set: {
                  product: {
                    nameAr: base.nameAr,
                    latinName: base.latinName ?? null,
                    categoryCode: base.category,
                    description: base.description ?? null,
                    unit: base.unit ?? null,
                    publication:
                      base.state === "published_unavailable"
                        ? "published"
                        : base.state,
                    availability:
                      base.state === "published_unavailable"
                        ? "unavailable"
                        : "available",
                  },
                  options: converted.options,
                  variants: converted.variants.map((row) => ({
                    ...row,
                    available: base.state !== "published_unavailable",
                  })),
                },
                attachments: converted.attachments,
                categoryName:
                  categories.find((row) => row.code === base.category)
                    ?.nameAr ?? base.category,
              },
            );
            if (prepared.status === "ready") {
              await drafts.setStatus(
                actor,
                context.conversationId,
                "submitted",
              );
            }
            return prepared;
          }
          const prepared = await ops.prepareProductCreation(actor, {
            ...draftToCreationInput(draft.data),
            ...input,
          });
          if (prepared.status === "ready") {
            await drafts.setStatus(actor, context.conversationId, "submitted");
          }
          return prepared;
        }),
    }),
    prepareProductDetailsUpdate: tool({
      description:
        "جهّز بطاقة تعديل رابط المنتج (slug) أو ترتيبه أو طريقة الاستخدام أو وصف الصورة (alt).",
      inputSchema: z
        .object({
          product,
          changes: z
            .object({
              slug: z.string().trim().max(120).optional(),
              sortOrder: z.number().int().min(0).max(100_000).optional(),
              usageNotes: z.string().trim().max(2_000).nullable().optional(),
              imageAlt: z.string().trim().max(250).optional(),
            })
            .strict(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareProductDetailsUpdate", input, () =>
          ops.prepareProductDetailsUpdate(actor, input),
        ),
    }),
    prepareProductPublication: tool({
      description:
        "جهّز بطاقة تغيير ظهور منتج: مسودة، منشور ومتوفر، منشور غير متوفر، أو مخفي. «اخفي/أخفي المنتج عن المتجر» = مخفي هنا (وليس أرشفة)، و«انشري/أظهري» = منشور. النشر يتحقق من الجاهزية.",
      inputSchema: z
        .object({ product, state, acceptPlaceholder: z.boolean().optional() })
        .strict(),
      execute: (input) =>
        prepare("prepareProductPublication", input, () =>
          ops.prepareProductPublication(actor, input),
        ),
    }),
    prepareProductRestore: tool({
      description: "جهّز بطاقة استرجاع منتج مؤرشف بمعرّفه (productId).",
      inputSchema: z.object({ productId: text(80) }).strict(),
      execute: (input) =>
        prepare("prepareProductRestore", input, () =>
          ops.prepareProductRestore(actor, input),
        ),
    }),
    prepareProductImageRemoval: tool({
      description: "جهّز بطاقة إزالة صورة منتج والعودة للصورة الافتراضية.",
      inputSchema: z.object({ product }).strict(),
      execute: (input) =>
        prepare("prepareProductImageRemoval", input, () =>
          ops.prepareProductImageRemoval(actor, input),
        ),
    }),
    prepareUnusedProductDeletion: tool({
      description:
        "جهّز بطاقة حذف نهائي لمنتج غير مستخدم إطلاقاً (بلا طلبات أو مشتريات أو مبيعات أو مخزون). استدعها مباشرة عند طلب الحذف النهائي؛ الخادم نفسه يفحص الاستخدام ويرفض إن كان المنتج مستخدماً ويقترح الأرشفة، فلا تَعِد بالفحص. للأرشفة استعمل prepareProductArchive.",
      inputSchema: z.object({ product, reason: text(200) }).strict(),
      execute: (input) =>
        prepare("prepareUnusedProductDeletion", input, () =>
          ops.prepareUnusedProductDeletion(actor, input, (domainId) =>
            context.operations.productReferences(actor, domainId),
          ),
        ),
    }),
    prepareVariantCreation: tool({
      description:
        "جهّز بطاقة إضافة صنف جديد (حجم/رائحة/لون) لمنتج موجود؛ «ضيفي حجم…» تعني صنفاً جديداً بجانب الأصناف الحالية ولا تغيّرها. سعر الصنف مطلوب.",
      inputSchema: z
        .object({
          product,
          label: text(120).describe("اسم الصنف مثل «2 لتر» أو «لافندر»"),
          attributes: attributes.optional(),
          priceIls: money,
          sku: identifier.optional(),
          barcode: identifier.optional(),
          available: z.boolean().optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareVariantCreation", input, () =>
          ops.prepareVariantCreation(actor, input),
        ),
    }),
    prepareVariantUpdate: tool({
      description:
        "جهّز بطاقة تعديل صنف: الاسم، الخصائص، السعر، التوفر، SKU، الباركود. تعدّل صنفاً موجوداً فقط (ومنها SKU والباركود)؛ إضافة حجم أو صنف جديد تتم بـ prepareVariantCreation ولا تغيّر الصنف الحالي.",
      inputSchema: z
        .object({
          variant,
          changes: z
            .object({
              label: z.string().trim().max(120).optional(),
              attributes: attributes.optional(),
              priceIls: money.optional(),
              available: z.boolean().optional(),
              sku: identifier.nullable().optional(),
              barcode: identifier.nullable().optional(),
            })
            .strict(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareVariantUpdate", input, () =>
          ops.prepareVariantUpdate(actor, input),
        ),
    }),
    prepareDefaultVariant: tool({
      description: "جهّز بطاقة جعل صنف هو الصنف الافتراضي المعروض للمنتج.",
      inputSchema: z.object({ variant }).strict(),
      execute: (input) =>
        prepare("prepareDefaultVariant", input, () =>
          ops.prepareDefaultVariant(actor, input),
        ),
    }),
    prepareVariantImage: tool({
      description: "جهّز بطاقة تغيير صورة صنف بصورة مرفقة.",
      inputSchema: z.object({ variant, attachmentId: z.uuid() }).strict(),
      execute: (input) =>
        prepare("prepareVariantImage", input, () =>
          ops.prepareVariantImage(actor, input),
        ),
    }),
    prepareVariantArchive: tool({
      description:
        "جهّز بطاقة أرشفة صنف (mode=archive) أو استرجاع صنف مؤرشف (mode=restore) بمعرّفه أو باسم المنتج والصنف.",
      inputSchema: z
        .object({ variant, mode: z.enum(["archive", "restore"]) })
        .strict(),
      execute: (input) =>
        prepare("prepareVariantArchive", input, () =>
          ops.prepareVariantArchive(actor, input),
        ),
    }),
    prepareUnusedVariantDeletion: tool({
      description:
        "جهّز بطاقة حذف نهائي لصنف لم يُستخدم في أي طلب أو فاتورة أو حركة مخزون.",
      inputSchema: z.object({ variant }).strict(),
      execute: (input) =>
        prepare("prepareUnusedVariantDeletion", input, () =>
          ops.prepareUnusedVariantDeletion(actor, input),
        ),
    }),
    prepareProductSpecification: tool({
      description:
        "جهّز بطاقة إضافة أو تعديل مواصفة منتج (label وvalue)، أو حذفها إذا كانت value = null.",
      inputSchema: z
        .object({
          product,
          label: text(80),
          value: z.string().trim().max(200).nullable(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareProductSpecification", input, () =>
          ops.prepareSpecification(actor, input),
        ),
    }),
    prepareCategoryCreation: tool({
      description: "جهّز بطاقة إضافة قسم جديد مع أيقونة من القائمة المعتمدة.",
      inputSchema: z
        .object({
          nameAr: text(80),
          description: z.string().trim().max(300).optional(),
          icon,
          visible: z.boolean().optional(),
          code: z.string().trim().max(40).optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareCategoryCreation", input, () =>
          ops.prepareCategoryCreation(actor, input),
        ),
    }),
    prepareCategoryUpdate: tool({
      description:
        "جهّز بطاقة تعديل قسم: الاسم، الوصف، الأيقونة، الظهور، الترتيب.",
      inputSchema: z
        .object({
          category,
          changes: z
            .object({
              nameAr: z.string().trim().max(80).optional(),
              description: z.string().trim().max(300).nullable().optional(),
              icon: icon.optional(),
              visible: z.boolean().optional(),
              sortOrder: z.number().int().min(0).max(10_000).optional(),
            })
            .strict(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareCategoryUpdate", input, () =>
          ops.prepareCategoryUpdate(actor, input),
        ),
    }),
    prepareCategoryArchive: tool({
      description:
        "جهّز بطاقة أرشفة قسم فارغ (mode=archive) أو استرجاع قسم مؤرشف (mode=restore).",
      inputSchema: z
        .object({ category, mode: z.enum(["archive", "restore"]) })
        .strict(),
      execute: (input) =>
        prepare("prepareCategoryArchive", input, () =>
          ops.prepareCategoryArchive(actor, input),
        ),
    }),
    prepareCategoryMerge: tool({
      description:
        "جهّز بطاقة دمج قسم مكرر (source) في قسم صحيح (target) ونقل منتجاته.",
      inputSchema: z.object({ source: category, target: category }).strict(),
      execute: (input) =>
        prepare("prepareCategoryMerge", input, () =>
          ops.prepareCategoryMerge(actor, input),
        ),
    }),
    prepareProductsCategoryMove: tool({
      description: "جهّز بطاقة نقل منتج أو عدة منتجات (حتى 20) إلى قسم.",
      inputSchema: z
        .object({ products: z.array(product).min(1).max(20), category })
        .strict(),
      execute: (input) =>
        prepare("prepareProductsCategoryMove", input, () =>
          ops.prepareProductsCategoryMove(actor, input),
        ),
    }),
    prepareEmptyCategoryDeletion: tool({
      description:
        "جهّز بطاقة حذف نهائي لقسم لا يرتبط به أي منتج (حتى المؤرشف).",
      inputSchema: z.object({ category }).strict(),
      execute: (input) =>
        prepare("prepareEmptyCategoryDeletion", input, () =>
          ops.prepareEmptyCategoryDeletion(actor, input),
        ),
    }),
  };

  return { read, mutate };
}
