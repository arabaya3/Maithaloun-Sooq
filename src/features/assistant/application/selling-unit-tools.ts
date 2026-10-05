import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  MAX_SELLING_UNITS_PER_VARIANT,
  MAX_UNITS_PER_SALE,
  SELLING_UNIT_LABEL_MAX,
} from "@/features/catalog/domain/selling-unit";

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
const variant = text(120)
  .optional()
  .describe(
    "الصنف (اللون أو الرائحة أو الحجم) كما قالته المستخدمة، إن كان للمنتج أكثر من صنف",
  );
const option = text(SELLING_UNIT_LABEL_MAX).describe(
  "طريقة البيع كما قالتها المستخدمة، مثل «حبة» أو «باكيج 3» أو «الكرتونة»",
);
const money = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .describe(
    'السعر كما كتبته المستخدمة حرفياً، مثل "10" أو "عشرة شيكل". لا تحسبه.',
  );
const units = z
  .number()
  .int()
  .min(1)
  .max(MAX_UNITS_PER_SALE)
  .describe(
    "عدد الحبات التي تُخصم من المخزون عند بيع هذه الطريقة مرة واحدة، كما قالته المستخدمة (حبة=1، باكيج ثلاث حبات=3)",
  );
const identifier = z.string().trim().max(64);

export function createSellingUnitTools(
  context: AssistantToolContext,
  run: Run,
  prepare: Prepare,
) {
  const { actor } = context;
  const ops = context.operations.sellingUnitOps;

  const read = {
    getSellingUnits: tool({
      description:
        "اقرأ طرق البيع لكل صنف من منتج (حبة، باكيج، كرتونة): الاسم، عدد الحبات المخصومة، السعر، سعر الحبة داخل الباكيج، الافتراضية، المؤرشفة، SKU والباركود، وما يكفيه المخزون الحالي.",
      inputSchema: z.object({ product, variant }).strict(),
      execute: (input) =>
        run("getSellingUnits", input, () => ops.view(actor, input)),
    }),
    getVariantsWithoutSellingUnits: tool({
      description:
        "اعرض الأصناف الفعّالة التي ليس لها أي طريقة بيع، فلا يمكن شراؤها أو نشرها.",
      inputSchema: z.object({}).strict(),
      execute: (input) =>
        run("getVariantsWithoutSellingUnits", input, () =>
          ops.withoutUnits(actor),
        ),
    }),
  };

  if (context.mode !== "full") return { read, mutate: {} };

  const mutate = {
    prepareSellingUnitsCreation: tool({
      description:
        "جهّز بطاقة واحدة لإضافة طريقة بيع أو أكثر لصنف واحد، مثل «حبة بأربعة وباكيج ثلاث حبات بعشرة». المخزون يبقى بالحبة؛ كل طريقة تخصم unitsPerSale حبة. لا تخترع سعراً أو عدداً.",
      inputSchema: z
        .object({
          product,
          variant,
          options: z
            .array(
              z
                .object({
                  label: option,
                  unitsPerSale: units,
                  priceIls: money,
                  sku: identifier.optional(),
                  barcode: identifier.optional(),
                  isDefault: z.boolean().optional(),
                })
                .strict(),
            )
            .min(1)
            .max(MAX_SELLING_UNITS_PER_VARIANT),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareSellingUnitsCreation", input, () =>
          ops.prepareCreate(actor, input),
        ),
    }),
    prepareSellingUnitChange: tool({
      description:
        "جهّز بطاقة تغيير طريقة بيع موجودة: update (label أو unitsPerSale أو priceIls أو sku أو barcode)، default لجعلها الافتراضية، archive لإخفائها من المتجر، restore لإعادتها.",
      inputSchema: z
        .object({
          product,
          variant,
          option,
          change: z.enum(["update", "default", "archive", "restore"]),
          label: text(SELLING_UNIT_LABEL_MAX).optional(),
          unitsPerSale: units.optional(),
          priceIls: money.optional(),
          sku: identifier.nullable().optional(),
          barcode: identifier.nullable().optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareSellingUnitChange", input, () =>
          ops.prepareChange(actor, input),
        ),
    }),
    prepareSellingUnitDeletion: tool({
      description:
        "جهّز بطاقة حذف نهائي لطريقة بيع لم تُستخدم في أي طلب أو فاتورة. فقط عند طلب الحذف النهائي صراحة؛ غير ذلك استعمل الأرشفة.",
      inputSchema: z.object({ product, variant, option }).strict(),
      execute: (input) =>
        prepare("prepareSellingUnitDeletion", input, () =>
          ops.prepareDelete(actor, input),
        ),
    }),
  };

  return { read, mutate };
}
