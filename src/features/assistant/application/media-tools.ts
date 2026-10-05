import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { can } from "@/features/admin/domain/permissions";
import { optionKinds } from "@/features/catalog/domain/product-options";

import type { PrepareResult } from "./assistant-operations";
import type {
  AssistantToolContext,
  PrepareToolOutput,
} from "./assistant-tools";

type Run = <T>(
  name: string,
  input: unknown,
  action: () => Promise<T>,
) => Promise<T | { status: "error"; code: string; message: string }>;
type Prepare = (
  name: string,
  input: unknown,
  build: () => Promise<PrepareResult>,
) => Promise<
  PrepareToolOutput | { status: "error"; code: string; message: string }
>;

const text = (max: number) => z.string().trim().min(1).max(max);
const product = text(160).describe("اسم المنتج كما قالته المستخدمة");
const imageNumber = z
  .number()
  .int()
  .min(1)
  .max(8)
  .describe("رقم الصورة كما ظهر في getProductGallery");
const optionName = text(40).describe(
  "اسم الخيار مثل الرائحة أو اللون أو الحجم",
);
const valueText = text(60);
const money = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .describe(
    'المبلغ كما كتبته المستخدمة حرفياً، مثل "10" أو "10 شيكل" أو "عشرة". لا تحسبه.',
  );
const kind = z
  .enum(optionKinds)
  .describe(
    "color=لون، fragrance=رائحة، size=حجم أو سعة، pack=عبوة، other=غير ذلك",
  );
const combination = z
  .array(z.object({ option: optionName, value: valueText }).strict())
  .min(1)
  .max(4)
  .describe('اختيارات صنف مثل [{ "option": "الرائحة", "value": "مسك" }]');
const toRecord = (pairs: ReadonlyArray<{ option: string; value: string }>) =>
  Object.fromEntries(pairs.map((pair) => [pair.option, pair.value]));

export function createMediaTools(
  context: AssistantToolContext,
  run: Run,
  prepare: Prepare,
) {
  const { actor } = context;
  const ops = context.operations.mediaOps;
  const ownerOnly = {
    status: "forbidden" as const,
    message: "صور وخيارات المنتجات للمالك فقط.",
  };
  const locate = async (query: string) => {
    if (!can(actor, "settings.manage"))
      return { ok: false as const, output: ownerOnly };
    const located = await ops.locate(actor, query);
    return located.ok
      ? located
      : { ok: false as const, output: located.result };
  };

  const read = {
    getProductGallery: tool({
      description:
        "اقرأ صور منتج بالترتيب: الرئيسية، وصف كل صورة، والصنف الذي تخصه، والصور المؤرشفة. استخدم أرقام الصور منها فقط.",
      inputSchema: z.object({ product }).strict(),
      execute: (input) =>
        run("getProductGallery", input, async () => {
          const located = await locate(input.product);
          return located.ok ? ops.galleryView(located) : located.output;
        }),
    }),
    getProductImageMapping: tool({
      description:
        "اقرأ ربط صور منتج بالخيارات والأصناف: لكل صورة ما تخصه (صورة عامة، قيمة مثل «اللون: أزرق»، صنف محدد، أو غير مربوطة)، والصور غير المربوطة، والقيم التي بلا صورة، وما يمنع النشر.",
      inputSchema: z.object({ product }).strict(),
      execute: (input) =>
        run("getProductImageMapping", input, async () => {
          const located = await locate(input.product);
          return located.ok ? ops.mappingView(located) : located.output;
        }),
    }),
    getProductOptions: tool({
      description:
        "اقرأ خيارات منتج (الرائحة، اللون، الحجم، العبوة) وقيمها الحالية والمؤرشفة.",
      inputSchema: z.object({ product }).strict(),
      execute: (input) =>
        run("getProductOptions", input, async () => {
          const located = await locate(input.product);
          return located.ok ? ops.optionsView(located) : located.output;
        }),
    }),
    getVariantMatrix: tool({
      description:
        "اقرأ أصناف منتج مع اختيارات كل صنف وسعره وتوفره ومخزونه وSKU والباركود، والتركيبات الناقصة والمكررة وغير المكتملة.",
      inputSchema: z.object({ product }).strict(),
      execute: (input) =>
        run("getVariantMatrix", input, async () => {
          const located = await locate(input.product);
          return located.ok ? ops.matrixView(located) : located.output;
        }),
    }),
  };

  if (context.mode !== "full") return { read, mutate: {} };

  const mutate = {
    prepareGalleryImagesAdd: tool({
      description:
        "جهّز بطاقة إضافة صور مرفقة إلى معرض منتج موجود، واختيارياً ربطها بصنف واحد (مثل «مسك»). لا تربط صنفاً لم تذكره المستخدمة.",
      inputSchema: z
        .object({
          product,
          attachmentIds: z.array(z.uuid()).min(1).max(8),
          variant: valueText
            .optional()
            .describe("اسم الصنف أو قيمة الخيار كما قالتها المستخدمة"),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareGalleryImagesAdd", input, () =>
          ops.prepareImagesAdd(actor, input),
        ),
    }),
    prepareGalleryReorder: tool({
      description:
        "جهّز بطاقة ترتيب كل صور المنتج. order أرقام الصور الحالية بالترتيب الجديد؛ الأولى تصبح الرئيسية.",
      inputSchema: z
        .object({ product, order: z.array(imageNumber).min(1).max(8) })
        .strict(),
      execute: (input) =>
        prepare("prepareGalleryReorder", input, () =>
          ops.prepareGalleryReorder(actor, input),
        ),
    }),
    prepareGalleryImageChange: tool({
      description:
        "جهّز بطاقة تغيير صورة واحدة: primary=جعلها رئيسية (للصور العامة فقط)، alt=وصفها، archive=أرشفتها، restore=استعادة صورة مؤرشفة برقمها في قائمة المؤرشفة. لربط صورة بلون أو صنف استخدم prepareImageMapping.",
      inputSchema: z
        .object({
          product,
          image: imageNumber,
          change: z.enum(["primary", "alt", "archive", "restore"]),
          alt: text(250).optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareGalleryImageChange", input, () =>
          ops.prepareGalleryImage(actor, input),
        ),
    }),
    prepareImageMapping: tool({
      description:
        "جهّز بطاقة ربط صورة موجودة (برقمها من getProductImageMapping): shared=صورة عامة لكل الأصناف، value=لقيمة خيار مثل اللون أزرق، variant=لصنف محدد واحد، unassigned=إزالة الربط. اربط فقط بما قالته المستخدمة.",
      inputSchema: z
        .object({
          product,
          image: imageNumber,
          target: z.enum(["shared", "value", "variant", "unassigned"]),
          option: optionName.optional().describe("مع value: اسم الخيار"),
          value: valueText.optional().describe("مع value: القيمة كما قالتها"),
          variant: valueText
            .optional()
            .describe("مع variant: اسم الصنف كما قالته"),
          suggestion: z
            .object({
              value: valueText,
              confidence: z.number().min(0).max(1),
              source: z.literal("image_analysis"),
            })
            .strict()
            .optional()
            .describe(
              "فقط إذا كان الربط مبنياً على تحليلك للصورة: ما ظننته ودرجة ثقتك. يظهر تحذيراً في البطاقة.",
            ),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareImageMapping", input, () =>
          ops.prepareImageMapping(actor, input),
        ),
    }),
    prepareSharedImageUse: tool({
      description:
        "جهّز بطاقة لاستخدام الصورة العامة للمنتج لقيمة لون أو رائحة ليس لها صورة (use=true)، أو لإلغاء ذلك (use=false). فقط عندما تطلبه المستخدمة.",
      inputSchema: z
        .object({
          product,
          option: optionName,
          value: valueText,
          use: z.boolean(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareSharedImageUse", input, () =>
          ops.prepareSharedImageUse(actor, input),
        ),
    }),
    prepareGalleryImageDeletion: tool({
      description:
        "جهّز بطاقة حذف نهائي لصورة مؤرشفة برقمها في قائمة المؤرشفة. فقط عندما تطلب المستخدمة الحذف النهائي صراحة.",
      inputSchema: z.object({ product, image: imageNumber }).strict(),
      execute: (input) =>
        prepare("prepareGalleryImageDeletion", input, () =>
          ops.prepareGalleryImage(actor, { ...input, change: "delete" }),
        ),
    }),
    prepareProductOptionCreate: tool({
      description:
        "جهّز بطاقة إضافة خيار جديد لمنتج (مثل الرائحة) مع قيمه كما قالتها المستخدمة. لا تخترع قيماً.",
      inputSchema: z
        .object({
          product,
          nameAr: optionName,
          kind,
          values: z.array(valueText).max(20),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareProductOptionCreate", input, () =>
          ops.prepareOptionCreate(actor, input),
        ),
    }),
    prepareProductOptionChange: tool({
      description:
        "جهّز بطاقة تغيير خيار موجود: rename (newName)، kind، archive، restore، reorder (order بأسماء كل الخيارات).",
      inputSchema: z
        .object({
          product,
          option: optionName,
          change: z.enum(["rename", "kind", "archive", "restore", "reorder"]),
          newName: optionName.optional(),
          kind: kind.optional(),
          order: z.array(optionName).max(4).optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareProductOptionChange", input, () =>
          ops.prepareOptionChange(actor, input),
        ),
    }),
    prepareProductOptionDeletion: tool({
      description:
        "جهّز بطاقة حذف نهائي لخيار غير مرتبط بأي صنف. فقط عند طلب الحذف النهائي صراحة.",
      inputSchema: z.object({ product, option: optionName }).strict(),
      execute: (input) =>
        prepare("prepareProductOptionDeletion", input, () =>
          ops.prepareOptionChange(actor, { ...input, change: "delete" }),
        ),
    }),
    prepareOptionValueChange: tool({
      description:
        "جهّز بطاقة تغيير قيم خيار: add (values)، rename (value → newValue)، archive أو restore (value)، reorder (values بالترتيب الكامل).",
      inputSchema: z
        .object({
          product,
          option: optionName,
          change: z.enum(["add", "rename", "archive", "restore", "reorder"]),
          values: z.array(valueText).max(20).optional(),
          value: valueText.optional(),
          newValue: valueText.optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareOptionValueChange", input, () =>
          ops.prepareValueChange(actor, input),
        ),
    }),
    prepareOptionValueDeletion: tool({
      description:
        "جهّز بطاقة حذف نهائي لقيمة غير مرتبطة بأي صنف. فقط عند طلب الحذف النهائي صراحة.",
      inputSchema: z
        .object({ product, option: optionName, value: valueText })
        .strict(),
      execute: (input) =>
        prepare("prepareOptionValueDeletion", input, () =>
          ops.prepareValueChange(actor, { ...input, change: "delete" }),
        ),
    }),
    prepareVariantGeneration: tool({
      description:
        "جهّز بطاقة إضافة أصناف لمنتج له خيارات: mode=missing لكل التركيبات الناقصة، أو listed مع combinations. السعر واحد لكل الأصناف الجديدة كما قالته المستخدمة؛ إذا اختلفت الأسعار جهّز بطاقة لكل سعر.",
      inputSchema: z
        .object({
          product,
          mode: z.enum(["missing", "listed"]),
          combinations: z.array(combination).max(60).optional(),
          priceIls: money,
          packCount: z.number().int().min(1).max(1_000).optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareVariantGeneration", input, () =>
          ops.prepareVariantGeneration(actor, {
            ...input,
            combinations: input.combinations?.map(toRecord),
          }),
        ),
    }),
    prepareVariantChoices: tool({
      description:
        "جهّز بطاقة تعديل اختيارات صنف موجود (مثل تغيير رائحته أو حجمه) أو عدد القطع في عبوته. السعر والمخزون لا يتغيران هنا.",
      inputSchema: z
        .object({
          product,
          variant: valueText,
          values: combination,
          packCount: z.number().int().min(1).max(1_000).nullable().optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareVariantChoices", input, () =>
          ops.prepareVariantChoices(actor, {
            ...input,
            values: toRecord(input.values),
          }),
        ),
    }),
  };

  return { read, mutate };
}
