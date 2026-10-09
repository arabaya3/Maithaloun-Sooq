"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { newProductId } from "@/features/admin/domain/product-identity";
import {
  normalizeOptionText,
  optionKindLabels,
} from "@/features/catalog/domain/product-options";
import { mapInventoryError } from "@/features/inventory/application/inventory-action-errors";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";
import { getProductImageStore } from "@/server/storage/product-images";
import {
  simpleKinds,
  type SimpleKind,
} from "@/features/admin/domain/simple-product";

import { mapProductAdminError } from "./admin-action-errors";
import { authoringFailure } from "./catalog-authoring-errors";
import { ProductOptionsError } from "./product-options-service";
import {
  adminCatalogService,
  catalogAuthoringService,
  inventoryService,
  productOptionsService,
} from "./admin-services";

const rowSchema = z.object({
  key: z.string().min(1).max(60),
  variantId: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/)
    .nullable(),
  valueId: z.uuid().nullable(),
  label: z.string().trim().max(60),
  priceIls: z.string().max(20),
  // Empty means "leave the stock as it is".
  stockPieces: z.string().max(10),
  costIls: z.string().max(20),
  available: z.boolean(),
});

const inputSchema = z.object({
  productId: z
    .string()
    .regex(/^[a-z0-9-]{1,80}$/)
    .nullable(),
  nameAr: z.string().trim().max(160),
  categoryId: z.string().max(40),
  description: z.string().trim().max(4_000),
  kind: z.enum(simpleKinds),
  optionName: z.string().trim().max(40),
  rows: z.array(rowSchema).min(1).max(20),
});

export type SimpleProductInput = z.input<typeof inputSchema>;
export type SimpleRowInput = z.input<typeof rowSchema>;

export type SimpleProductResult =
  | {
      ok: true;
      productId: string;
      rows: Array<{ key: string; variantId: string; valueId: string | null }>;
      /** Saved, but something after the main save failed; the owner should read it. */
      warning?: string;
    }
  | { ok: false; message: string; productId?: string; rowKey?: string };

type Row = z.infer<typeof rowSchema>;

function optionNameFor(kind: SimpleKind, custom: string) {
  if (kind === "single") return "";
  if (kind === "other") return custom || "النوع";
  return optionKindLabels[kind];
}

function optionErrorMessage(error: unknown): string | null {
  if (!(error instanceof ProductOptionsError)) return null;
  const messages: Partial<Record<ProductOptionsError["code"], string>> = {
    duplicate_value: "يوجد نوعان بنفس الاسم. غيّري اسم أحدهما.",
    duplicate_option: "يوجد نوعان بنفس الاسم. غيّري اسم أحدهما.",
    duplicate_combination: "يوجد نوعان بنفس الاسم. غيّري اسم أحدهما.",
    too_many: "وصلتِ للحد الأقصى من الأنواع.",
    in_use: "هذا النوع مستخدم في طلبات أو فواتير، لذلك لا يمكن حذفه.",
    already_configured:
      "لهذا المنتج إعداد متقدم. عدّلي الأنواع من «إعدادات متقدمة».",
  };
  return (
    messages[error.code] ?? "تعذّر حفظ الأنواع. حدّثي الصفحة وحاولي مرة أخرى."
  );
}

/**
 * Saves the whole simple editor in one call: the product, its one list of types (scents, sizes…),
 * and each type's price, availability and stock. Images are uploaded by the browser afterwards,
 * once every row has its saved id.
 */
export async function saveSimpleProductAction(
  raw: SimpleProductInput,
): Promise<SimpleProductResult> {
  const actor = await requireTrustedAdminMutation();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "تحقّقي من الحقول ثم حاولي مرة أخرى." };
  const input = parsed.data;

  if (input.nameAr.length < 2)
    return { ok: false, message: "اكتبي اسم المنتج (حرفان على الأقل)." };
  const categories = await catalogAuthoringService.listCategories();
  if (!categories.some((category) => category.code === input.categoryId))
    return { ok: false, message: "اختاري القسم." };

  const multi = input.kind !== "single";
  const rows: Row[] = multi ? input.rows : input.rows.slice(0, 1);
  const prices = new Map<string, number>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (multi) {
      if (!row.label)
        return { ok: false, rowKey: row.key, message: "اكتبي اسم كل نوع." };
      const normalized = normalizeOptionText(row.label);
      if (seen.has(normalized))
        return {
          ok: false,
          rowKey: row.key,
          message: `النوع «${row.label}» مكرر.`,
        };
      seen.add(normalized);
    }
    const price = parseIlsToAgorot(row.priceIls.trim());
    if (price === null || price <= 0)
      return {
        ok: false,
        rowKey: row.key,
        message: multi
          ? `اكتبي سعر «${row.label}» بالشيكل، مثل 12 أو 12.50.`
          : "اكتبي سعر البيع بالشيكل، مثل 12 أو 12.50.",
      };
    prices.set(row.key, price);
    const stock = row.stockPieces.trim();
    if (stock && !/^\d{1,6}$/.test(stock))
      return {
        ok: false,
        rowKey: row.key,
        message: "الكمية عدد صحيح من القطع، مثل 10.",
      };
  }
  const firstPrice = prices.get(rows[0]!.key)!;

  // 1. The product itself.
  let productId = input.productId;
  try {
    if (!productId) {
      productId = newProductId("", randomUUID());
      await adminCatalogService.create(actor, {
        domainId: productId,
        slug: productId,
        nameAr: input.nameAr,
        latinName: undefined,
        priceAgorot: firstPrice,
        categoryId: input.categoryId as never,
        availability: "unavailable",
        sortOrder: 100,
        description: input.description || undefined,
        usageNotes: undefined,
        unit: undefined,
        detailsStatus: "placeholder",
        placeholderVariant: "general-cleaner",
      });
    } else {
      const product = await adminCatalogService.getByDomainId(actor, productId);
      if (!product)
        return { ok: false, message: "المنتج غير موجود. حدّثي الصفحة." };
      await adminCatalogService.update(actor, {
        domainId: productId,
        nameAr: input.nameAr,
        latinName: product.latinName,
        priceAgorot: product.priceAgorot > 0 ? product.priceAgorot : firstPrice,
        categoryId: input.categoryId as never,
        availability: product.availability,
        sortOrder: product.sortOrder,
        description: input.description || undefined,
        usageNotes: product.usageNotes,
        unit: product.unit,
        detailsStatus: product.detailsStatus,
        placeholderVariant:
          product.image.kind === "placeholder"
            ? product.image.variant
            : "general-cleaner",
      });
    }
  } catch (error) {
    return { ok: false, message: mapProductAdminError(error) };
  }

  // 2. The list of types, mapped onto options and variants.
  const saved = new Map<
    string,
    { variantId: string; valueId: string | null }
  >();
  try {
    const matrix = await productOptionsService.matrix(productId);
    if (!matrix) return { ok: false, productId, message: "المنتج غير موجود." };
    const liveOptions = matrix.options.filter((option) => !option.archived);
    const liveVariants = matrix.variants.filter((variant) => !variant.archived);

    if (liveOptions.length > 1)
      return {
        ok: false,
        productId,
        message:
          "لهذا المنتج أكثر من نوع اختلاف. عدّلي الأنواع من «إعدادات متقدمة».",
      };

    if (!multi) {
      if (liveOptions.length || liveVariants.length > 1)
        return {
          ok: false,
          productId,
          message:
            "لهذا المنتج عدة أنواع. احذفي الأنواع واحداً واحداً أولاً، أو أبقي «أكثر من نوع».",
        };
      saved.set(rows[0]!.key, {
        variantId: liveVariants[0]!.id,
        valueId: null,
      });
    } else if (!liveOptions.length) {
      if (liveVariants.length !== 1)
        return {
          ok: false,
          productId,
          message: "لهذا المنتج إعداد متقدم. عدّليه من «إعدادات متقدمة».",
        };
      const nameAr = optionNameFor(input.kind, input.optionName);
      await productOptionsService.applyOptionPlan(
        actor,
        productId,
        {
          options: [
            {
              nameAr,
              kind: input.kind as never,
              values: rows.map((row) => row.label),
            },
          ],
          combinations: rows.map((row) => [row.label]),
        },
        randomUUID(),
      );
    } else {
      const option = liveOptions[0]!;
      const wantedName = optionNameFor(input.kind, input.optionName);
      if (option.kind !== input.kind || option.nameAr !== wantedName)
        await productOptionsService.updateOption(actor, option.id, {
          nameAr: wantedName,
          kind: input.kind as never,
        });

      // Removed rows: archive their variant first, then retire the value if nothing else holds it.
      const keptValues = new Set(
        rows.map((row) => row.valueId).filter(Boolean) as string[],
      );
      const firstKept = rows.find((row) => row.variantId)?.variantId;
      for (const value of option.values) {
        if (keptValues.has(value.id)) continue;
        const carriers = new Set(
          liveVariants
            .filter((item) => item.optionValues[option.id] === value.id)
            .map((item) => item.id),
        );
        // The type's own photos go with it, so the store never shows a scent that is gone.
        for (const image of matrix.images.filter(
          (item) =>
            !item.archived &&
            ((item.scope === "option_value" &&
              item.optionValueId === value.id) ||
              (item.scope === "variant" &&
                item.variantId !== null &&
                carriers.has(item.variantId))),
        )) {
          await removeImage(actor, image.id);
        }
        for (const variant of liveVariants.filter(
          (item) => item.optionValues[option.id] === value.id,
        )) {
          if (variant.isDefault) {
            const next = firstKept ?? null;
            if (!next)
              return {
                ok: false,
                productId,
                message: "أبقي نوعاً واحداً على الأقل من الأنواع المحفوظة.",
              };
            await catalogAuthoringService.setDefaultVariant(actor, next);
          }
          await catalogAuthoringService.archiveVariant(actor, variant.id);
        }
        await productOptionsService
          .setValueArchived(actor, value.id, true)
          .catch(() => undefined);
      }

      for (const row of rows) {
        const current = option.values.find((value) => value.id === row.valueId);
        if (current) {
          if (current.valueAr !== row.label)
            await productOptionsService.updateValue(
              actor,
              current.id,
              row.label,
            );
          continue;
        }
        const { valueId } = await productOptionsService.addValue(
          actor,
          option.id,
          row.label,
        );
        await productOptionsService.generateVariants(
          actor,
          productId,
          [
            {
              selection: { [option.id]: valueId },
              priceAgorot: prices.get(row.key)!,
            },
          ],
          randomUUID(),
        );
      }
    }

    // Read back the ids so every row knows its variant and value.
    if (multi) {
      const after = await productOptionsService.matrix(productId);
      const option = after!.options.find((item) => !item.archived)!;
      for (const row of rows) {
        const value = option.values.find(
          (item) =>
            normalizeOptionText(item.valueAr) ===
            normalizeOptionText(row.label),
        );
        const variant = after!.variants.find(
          (item) =>
            !item.archived &&
            value &&
            item.optionValues[option.id] === value.id,
        );
        if (!value || !variant)
          return {
            ok: false,
            productId,
            message: "تعذّر ربط الأنواع. حدّثي الصفحة.",
          };
        saved.set(row.key, { variantId: variant.id, valueId: value.id });
      }
    }
  } catch (error) {
    const message = optionErrorMessage(error);
    if (message) return { ok: false, productId, message };
    return { ...authoringFailure(error), productId };
  }

  // 3. Price and availability of each type; the first available one opens first for customers.
  try {
    for (const row of rows) {
      await catalogAuthoringService.updateVariant(
        actor,
        saved.get(row.key)!.variantId,
        {
          priceAgorot: prices.get(row.key)!,
          availability: row.available ? "available" : "unavailable",
        },
      );
    }
    const preferred = rows.find((row) => row.available) ?? rows[0]!;
    await catalogAuthoringService.setDefaultVariant(
      actor,
      saved.get(preferred.key)!.variantId,
    );
  } catch (error) {
    return { ...authoringFailure(error), productId };
  }

  // 4. Stock, only for rows where a quantity was written.
  const stockProblems: string[] = [];
  for (const row of rows) {
    const text = row.stockPieces.trim();
    if (!text) continue;
    const variantId = saved.get(row.key)!.variantId;
    try {
      const current = await inventoryService.getVariantStock(actor, variantId);
      const tracked = Boolean(current?.stock.tracked);
      const quantity = Number(text);
      if (!tracked && quantity === 0) continue;
      const cost = parseIlsToAgorot(row.costIls.trim());
      if (!tracked && (cost === null || cost <= 0)) {
        stockProblems.push(
          `«${row.label || input.nameAr}»: اكتبي تكلفة القطعة لتسجيل الكمية.`,
        );
        continue;
      }
      await inventoryService.adjust(actor, {
        idempotencyKey: randomUUID(),
        variantId,
        reason: tracked ? "correction" : "opening_balance",
        quantityMilli: quantity * 1_000,
        ...(tracked ? {} : { unitCostAgorot: cost! }),
        note: tracked ? "تعديل من صفحة المنتج" : "رصيد افتتاحي من صفحة المنتج",
      });
    } catch (error) {
      stockProblems.push(
        `«${row.label || input.nameAr}»: ${mapInventoryError(error)}`,
      );
    }
  }

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/", "layout");
  return {
    ok: true,
    productId,
    rows: rows.map((row) => ({ key: row.key, ...saved.get(row.key)! })),
    ...(stockProblems.length
      ? {
          warning: `حُفظ المنتج، لكن لم تُحفظ الكمية: ${stockProblems.join(" ")}`,
        }
      : {}),
  };
}

async function removeImage(
  actor: Awaited<ReturnType<typeof requireTrustedAdminMutation>>,
  imageId: string,
) {
  // Only an archived image can be deleted, so the two steps always go together here.
  await productOptionsService.setImageArchived(actor, imageId, true);
  const removed = await productOptionsService.deleteImage(actor, imageId);
  if (!removed.fileStillUsed)
    await getProductImageStore().remove?.(removed.src);
}

/** Deletes one photo from the simple editor. */
export async function removeSimpleImageAction(input: {
  productId: string;
  imageId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const actor = await requireTrustedAdminMutation();
  const parsed = z
    .object({
      productId: z.string().regex(/^[a-z0-9-]{1,80}$/),
      imageId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "الصورة غير موجودة." };
  try {
    await removeImage(actor, parsed.data.imageId);
  } catch (error) {
    if (
      error instanceof ProductOptionsError &&
      error.code === "primary_required"
    )
      return { ok: false, message: "أضيفي صورة أخرى قبل حذف هذه الصورة." };
    return { ok: false, message: "تعذّر حذف الصورة. حدّثي الصفحة." };
  }
  revalidatePath(`/admin/products/${parsed.data.productId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Publishes, or returns the product to draft. The server repeats every publishing check. */
export async function setSimplePublicationAction(input: {
  productId: string;
  publish: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const actor = await requireTrustedAdminMutation();
  if (!/^[a-z0-9-]{1,80}$/.test(input.productId))
    return { ok: false, message: "المنتج غير موجود." };
  try {
    await catalogAuthoringService.setPublication(actor, {
      domainId: input.productId,
      publication: input.publish ? "published" : "draft",
      ...(input.publish ? { availability: "available" as const } : {}),
      acceptPlaceholder: true,
    });
  } catch (error) {
    return authoringFailure(error);
  }
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${input.productId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
