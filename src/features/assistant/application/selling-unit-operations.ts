import "server-only";

import { z } from "zod";

import {
  sellingUnitErrorMessages,
  type SellingUnitAdminView,
  type SellingUnitService,
  type VariantSellingUnits,
} from "@/features/admin/application/selling-unit-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can } from "@/features/admin/domain/permissions";
import type { Product } from "@/features/catalog/domain/product";
import {
  MAX_SELLING_UNITS_PER_VARIANT,
  MAX_UNITS_PER_SALE,
  SELLING_UNIT_LABEL_MAX,
  deductionText,
  labelStatesCount,
  matchSellingUnit,
  piecesText,
  stockInterpretation,
  unitComparison,
} from "@/features/catalog/domain/selling-unit";
import { formatIls } from "@/shared/lib/format-currency";
import { parseMoneyInput } from "@/shared/lib/money-input";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

import type { SellingUnitOperation } from "../domain/assistant-policy";
import { moneyRejection } from "../domain/money-rejection";
import type {
  ConfirmationCard,
  ExecutionResult,
  Handler,
  PrepareResult,
} from "./assistant-operations";

export interface SellingUnitOperationServices {
  sellingUnits: SellingUnitService;
  resolveProduct: (
    actor: AdminActor,
    query: string,
    scope: "product" | "variant",
    field: string,
  ) => Promise<
    { ok: true; product: Product } | { ok: false; result: PrepareResult }
  >;
}

const rejected = (code: string, message: string): PrepareResult => ({
  status: "rejected",
  code,
  message,
});
const productHref = (domainId: string) => `/admin/products/${domainId}`;
const normalize = normalizeArabicText;

export interface ProposedSellingUnit {
  label: string;
  unitsPerSale: number;
  priceIls: string;
  sku?: string;
  barcode?: string;
  isDefault?: boolean;
}

type Located = {
  product: Product;
  variant: VariantSellingUnits;
  variants: VariantSellingUnits[];
};

function unitLine(unit: { priceAgorot: number; unitsPerSale: number }) {
  return `${formatIls(unit.priceAgorot)} — يخصم ${piecesText(unit.unitsPerSale)}`;
}

function currentSummary(variant: VariantSellingUnits): string {
  const active = variant.units.filter((unit) => !unit.archived);
  return active.length
    ? active
        .map(
          (unit) =>
            `${unit.labelAr}: ${unitLine(unit)}${unit.isDefault ? " (الافتراضية)" : ""}`,
        )
        .join("، ")
    : "لا توجد طريقة بيع";
}

export class SellingUnitOperations {
  constructor(private readonly s: SellingUnitOperationServices) {}

  private ownerOnly(actor: AdminActor): PrepareResult | null {
    return can(actor, "settings.manage")
      ? null
      : rejected("forbidden", "طرق البيع للمالك فقط.");
  }

  // The exact variant: the only one, or the one whose label or option value was named.
  async locate(
    actor: AdminActor,
    productQuery: string,
    variantQuery: string | undefined,
  ): Promise<
    { ok: true; located: Located } | { ok: false; result: PrepareResult }
  > {
    const found = await this.s.resolveProduct(
      actor,
      productQuery,
      "product",
      "product",
    );
    if (!found.ok) return found;
    const variants = await this.s.sellingUnits.listForProduct(found.product.id);
    if (!variants.length) {
      return {
        ok: false,
        result: rejected("not_found", "لا يوجد صنف فعّال لهذا المنتج."),
      };
    }
    const pick = (variant: VariantSellingUnits) => ({
      ok: true as const,
      located: { product: found.product, variant, variants },
    });
    if (variants.length === 1 && !variantQuery) return pick(variants[0]!);
    if (variantQuery) {
      const wanted = normalize(variantQuery);
      const productVariants = found.product.variants;
      const matches = variants.filter((variant) => {
        if (variant.variantId === variantQuery) return true;
        if (normalize(variant.label) === wanted) return true;
        const attributes =
          productVariants.find((row) => row.id === variant.variantId)
            ?.attributes ?? {};
        return Object.values(attributes).some(
          (value) => normalize(value) === wanted,
        );
      });
      if (matches.length === 1) return pick(matches[0]!);
    }
    return {
      ok: false,
      result: {
        status: "needs_selection",
        field: "variant",
        question: variantQuery
          ? `أي صنف من ${found.product.nameAr} تقصدين بـ «${variantQuery.slice(0, 40)}»؟`
          : `لأي صنف من ${found.product.nameAr}؟`,
        options: variants.map((variant) => ({
          id: variant.variantId,
          label: variant.label,
        })),
      },
    };
  }

  private findUnit(
    variant: VariantSellingUnits,
    query: string,
    archived: boolean | "any",
  ): SellingUnitAdminView | PrepareResult {
    const pool = variant.units.filter(
      (unit) => archived === "any" || unit.archived === archived,
    );
    const match = matchSellingUnit(pool, query);
    if (match) return match;
    return pool.length
      ? {
          status: "needs_selection",
          field: "option",
          question: `أي طريقة بيع تقصدين لـ ${variant.label}؟`,
          options: pool.map((unit) => ({
            id: unit.labelAr,
            label: `${unit.labelAr} — ${unitLine(unit)}`,
          })),
        }
      : rejected("not_found", "لا توجد طرق بيع مطابقة لهذا الصنف.");
  }

  // Read tools ----------------------------------------------------------------

  async view(actor: AdminActor, input: { product: string; variant?: string }) {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const found = await this.s.resolveProduct(
      actor,
      input.product,
      "product",
      "product",
    );
    if (!found.ok) return found.result;
    const variants = await this.s.sellingUnits.listForProduct(found.product.id);
    const shown = input.variant
      ? variants.filter(
          (variant) => normalize(variant.label) === normalize(input.variant!),
        )
      : variants;
    return {
      status: "ok" as const,
      product: found.product.nameAr,
      variants: (shown.length ? shown : variants).map((variant) => {
        const single = variant.units.find(
          (unit) => !unit.archived && unit.unitsPerSale === 1,
        );
        return {
          variant: variant.label,
          stock: stockInterpretation(variant.freeBaseMilli, "حبة", 1),
          sellingOptions: variant.units.map((unit) => ({
            label: unit.labelAr,
            unitsPerSale: unit.unitsPerSale,
            price: formatIls(unit.priceAgorot),
            perPiece: unitComparison(unit, single ?? null)?.perPiece ?? null,
            isDefault: unit.isDefault,
            archived: unit.archived,
            sku: unit.sku,
            barcode: unit.barcode,
            usedInOrdersOrSales: unit.references > 0,
            stock: unit.archived
              ? null
              : stockInterpretation(
                  variant.freeBaseMilli,
                  unit.labelAr,
                  unit.unitsPerSale,
                ),
          })),
        };
      }),
    };
  }

  async withoutUnits(actor: AdminActor) {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const rows = await this.s.sellingUnits.variantsWithoutUnits();
    return {
      status: "ok" as const,
      count: rows.length,
      variants: rows.map((row) => ({
        product: row.productName,
        variant: row.variantLabel,
        published: row.published,
      })),
    };
  }

  // Prepare tools ---------------------------------------------------------------

  async prepareCreate(
    actor: AdminActor,
    input: {
      product: string;
      variant?: string;
      options: ProposedSellingUnit[];
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    if (!input.options.length) {
      return rejected("invalid_input", "حددي طريقة بيع واحدة على الأقل.");
    }
    const found = await this.locate(actor, input.product, input.variant);
    if (!found.ok) return found.result;
    const { product, variant } = found.located;
    const active = variant.units.filter((unit) => !unit.archived);
    // Ways the owner named that already exist with the same count and price are confirmed, not re-added.
    const alreadyThere: SellingUnitAdminView[] = [];
    const proposed: Array<{
      labelAr: string;
      unitsPerSale: number;
      priceAgorot: number;
      sku: string | null;
      barcode: string | null;
      isDefault: boolean;
    }> = [];
    for (const option of input.options) {
      const label = option.label.trim();
      if (!label || label.length > SELLING_UNIT_LABEL_MAX) {
        return rejected(
          "invalid_label",
          sellingUnitErrorMessages.invalid_label,
        );
      }
      if (
        !Number.isInteger(option.unitsPerSale) ||
        option.unitsPerSale < 1 ||
        option.unitsPerSale > MAX_UNITS_PER_SALE
      ) {
        return rejected(
          "invalid_units",
          sellingUnitErrorMessages.invalid_units,
        );
      }
      // A pack whose size the owner did not say is asked about, not guessed into a card.
      if (!labelStatesCount(label, option.unitsPerSale)) {
        return rejected(
          "units_unstated",
          `كم حبة في «${label}»؟ اكتبي العدد مع الاسم، مثل «${label} 3 حبات».`,
        );
      }
      const price = parseMoneyInput(option.priceIls);
      if (!price.ok) return moneyRejection(option.priceIls);
      const existing = active.find(
        (unit) => unit.unitsPerSale === option.unitsPerSale,
      );
      if (existing && existing.priceAgorot === price.agorot) {
        alreadyThere.push(existing);
        continue;
      }
      if (existing) {
        return rejected(
          "duplicate_units",
          `يوجد لهذا الصنف «${existing.labelAr}» بسعر ${formatIls(existing.priceAgorot)}. لتغيير سعرها استعملي تعديل طريقة البيع بدلاً من الإضافة.`,
        );
      }
      const clashWith = [
        ...active.map((unit) => ({
          labelAr: unit.labelAr,
          unitsPerSale: unit.unitsPerSale,
        })),
        ...proposed,
      ];
      if (clashWith.some((unit) => unit.unitsPerSale === option.unitsPerSale)) {
        return rejected(
          "duplicate_units",
          `${sellingUnitErrorMessages.duplicate_units} (${piecesText(option.unitsPerSale)})`,
        );
      }
      if (
        clashWith.some((unit) => normalize(unit.labelAr) === normalize(label))
      ) {
        return rejected(
          "duplicate_label",
          sellingUnitErrorMessages.duplicate_label,
        );
      }
      const sku = option.sku?.trim() || null;
      const barcode = option.barcode?.trim() || null;
      const clash = await this.s.sellingUnits.identifierClash({ sku, barcode });
      if (clash) return rejected(clash, sellingUnitErrorMessages[clash]);
      proposed.push({
        labelAr: label,
        unitsPerSale: option.unitsPerSale,
        priceAgorot: price.agorot,
        sku,
        barcode,
        isDefault: option.isDefault === true,
      });
    }
    if (!proposed.length) {
      return rejected(
        "unchanged",
        "كل طرق البيع المذكورة موجودة مسبقاً بنفس العدد والسعر؛ لا يوجد ما يُضاف.",
      );
    }
    if (active.length + proposed.length > MAX_SELLING_UNITS_PER_VARIANT) {
      return rejected("too_many", sellingUnitErrorMessages.too_many);
    }
    const single =
      [...active, ...proposed].find((unit) => unit.unitsPerSale === 1) ?? null;
    const warnings: string[] = [];
    for (const unit of proposed) {
      const comparison = unitComparison(unit, single);
      if (comparison && single && !comparison.cheaper) {
        warnings.push(
          `سعر الحبة داخل «${unit.labelAr}» (${comparison.perPiece}) ليس أقل من سعر الحبة منفردة؛ لن يُعرض كتوفير.`,
        );
      }
    }
    if (product.publication !== "published") {
      warnings.push(
        "المنتج غير منشور في المتجر حالياً؛ ستظهر طرق البيع بعد نشره.",
      );
    }
    const impact = [
      "ستظهر في صفحة المنتج تحت «طريقة الشراء»، والعدد في السلة يعني عدد المرات من الطريقة المختارة.",
      ...proposed.map(
        (unit) =>
          `${deductionText(unit.labelAr, unit.unitsPerSale)} ${stockInterpretation(
            variant.freeBaseMilli,
            unit.labelAr,
            unit.unitsPerSale,
          )}`,
      ),
    ];
    const version = await this.s.sellingUnits.variantVersion(variant.variantId);
    if (!version) return rejected("not_found", "الصنف غير موجود.");
    return {
      status: "ready",
      operation: "sellingUnitsCreate",
      args: {
        domainId: product.id,
        variantId: variant.variantId,
        variantVersion: version,
        options: proposed,
      },
      summary: `إضافة ${proposed.length} من طرق البيع لـ ${product.nameAr}`,
      card: {
        title: "إضافة طرق بيع",
        target: {
          label: `${product.nameAr} — ${variant.label}`,
          href: productHref(product.id),
        },
        rows: [
          {
            label: "طرق البيع الحالية",
            before: null,
            after: currentSummary(variant),
          },
          ...alreadyThere.map((unit) => ({
            label: `موجودة: ${unit.labelAr}`,
            before: null,
            after: `${unitLine(unit)} — لا تغيير`,
          })),
          ...proposed.map((unit) => ({
            label: `جديد: ${unit.labelAr}${unit.isDefault ? " (افتراضية)" : ""}`,
            before: null,
            after: `${unitLine(unit)}${
              unitComparison(unit, single)
                ? ` · ${unitComparison(unit, single)!.perPiece}`
                : ""
            }${unit.sku ? ` · SKU ${unit.sku}` : ""}${unit.barcode ? ` · باركود ${unit.barcode}` : ""}`,
          })),
        ],
        impact,
        warnings,
        confirmLabel: "تأكيد إضافة طرق البيع",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareChange(
    actor: AdminActor,
    input: {
      product: string;
      variant?: string;
      option: string;
      change: "update" | "default" | "archive" | "restore";
      label?: string;
      unitsPerSale?: number;
      priceIls?: string;
      sku?: string | null;
      barcode?: string | null;
    },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const found = await this.locate(actor, input.product, input.variant);
    if (!found.ok) return found.result;
    const { product, variant } = found.located;
    const unit = this.findUnit(
      variant,
      input.option,
      input.change === "restore",
    );
    if ("status" in unit) return unit;
    const version = await this.s.sellingUnits.variantVersion(variant.variantId);
    if (!version) return rejected("not_found", "الصنف غير موجود.");
    const target = {
      label: `${product.nameAr} — ${variant.label} — ${unit.labelAr}`,
      href: productHref(product.id),
    };
    const base = {
      domainId: product.id,
      variantId: variant.variantId,
      unitId: unit.id,
      unitVersion: unit.version,
    };
    const active = variant.units.filter((row) => !row.archived);

    if (input.change === "default") {
      if (unit.isDefault) {
        return rejected("unchanged", "هذه هي طريقة البيع الافتراضية أصلاً.");
      }
      const current = active.find((row) => row.isDefault);
      return {
        status: "ready",
        operation: "sellingUnitDefault",
        args: base,
        summary: `جعل «${unit.labelAr}» طريقة البيع الافتراضية`,
        card: {
          title: "تغيير طريقة البيع الافتراضية",
          target,
          rows: [
            {
              label: "الافتراضية",
              before: current?.labelAr ?? "—",
              after: unit.labelAr,
            },
          ],
          impact: [
            "تُختار تلقائياً في المتجر عند فتح المنتج وعند الإضافة من بطاقة المنتج.",
          ],
          warnings: [],
          confirmLabel: "تأكيد التغيير",
          destructive: false,
          reversible: true,
        },
      };
    }

    if (input.change === "archive" || input.change === "restore") {
      if (input.change === "archive") {
        if (unit.isDefault) {
          return rejected(
            "default_archived",
            sellingUnitErrorMessages.default_archived,
          );
        }
        if (active.length <= 1) {
          return rejected("last_active", sellingUnitErrorMessages.last_active);
        }
      } else if (active.some((row) => row.unitsPerSale === unit.unitsPerSale)) {
        return rejected(
          "duplicate_units",
          sellingUnitErrorMessages.duplicate_units,
        );
      }
      return {
        status: "ready",
        operation:
          input.change === "archive"
            ? "sellingUnitArchive"
            : "sellingUnitRestore",
        args: base,
        summary: `${input.change === "archive" ? "أرشفة" : "استعادة"} «${unit.labelAr}»`,
        card: {
          title:
            input.change === "archive"
              ? "أرشفة طريقة بيع"
              : "استعادة طريقة بيع",
          target,
          rows: [
            {
              label: "الحالة",
              before: input.change === "archive" ? "فعّالة" : "مؤرشفة",
              after: input.change === "archive" ? "مؤرشفة" : "فعّالة",
            },
          ],
          impact:
            input.change === "archive"
              ? [
                  "تختفي من المتجر ولا يمكن شراؤها، والطلبات والفواتير السابقة تبقى كما هي.",
                  "السلال التي فيها هذه الطريقة تطلب من الزبون اختيار طريقة أخرى.",
                ]
              : ["تعود للظهور في المتجر بسعرها المحفوظ."],
          warnings: [],
          confirmLabel:
            input.change === "archive" ? "تأكيد الأرشفة" : "تأكيد الاستعادة",
          destructive: false,
          reversible: true,
        },
      };
    }

    // update
    const labelAr = input.label?.trim() ?? unit.labelAr;
    if (!labelAr || labelAr.length > SELLING_UNIT_LABEL_MAX) {
      return rejected("invalid_label", sellingUnitErrorMessages.invalid_label);
    }
    const unitsPerSale = input.unitsPerSale ?? unit.unitsPerSale;
    if (
      !Number.isInteger(unitsPerSale) ||
      unitsPerSale < 1 ||
      unitsPerSale > MAX_UNITS_PER_SALE ||
      (unit.mirrorsVariant && unitsPerSale !== 1)
    ) {
      return rejected("invalid_units", sellingUnitErrorMessages.invalid_units);
    }
    if (!labelStatesCount(labelAr, unitsPerSale)) {
      return rejected(
        "units_unstated",
        `اسم «${labelAr}» لا يذكر عدد الحبات (${unitsPerSale}). اكتبي العدد في الاسم.`,
      );
    }
    let priceAgorot = unit.priceAgorot;
    if (input.priceIls !== undefined) {
      const price = parseMoneyInput(input.priceIls);
      if (!price.ok) return moneyRejection(input.priceIls);
      priceAgorot = price.agorot;
    }
    const sku = input.sku === undefined ? unit.sku : input.sku?.trim() || null;
    const barcode =
      input.barcode === undefined
        ? unit.barcode
        : input.barcode?.trim() || null;
    const others = active.filter((row) => row.id !== unit.id);
    if (others.some((row) => row.unitsPerSale === unitsPerSale)) {
      return rejected(
        "duplicate_units",
        sellingUnitErrorMessages.duplicate_units,
      );
    }
    if (others.some((row) => normalize(row.labelAr) === normalize(labelAr))) {
      return rejected(
        "duplicate_label",
        sellingUnitErrorMessages.duplicate_label,
      );
    }
    const clash = await this.s.sellingUnits.identifierClash(
      { sku, barcode },
      unit.id,
    );
    if (clash) return rejected(clash, sellingUnitErrorMessages[clash]);
    const rows: ConfirmationCard["rows"] = [];
    if (labelAr !== unit.labelAr)
      rows.push({ label: "الاسم", before: unit.labelAr, after: labelAr });
    if (unitsPerSale !== unit.unitsPerSale)
      rows.push({
        label: "الحبات المخصومة",
        before: piecesText(unit.unitsPerSale),
        after: piecesText(unitsPerSale),
      });
    if (priceAgorot !== unit.priceAgorot)
      rows.push({
        label: "السعر",
        before: formatIls(unit.priceAgorot),
        after: formatIls(priceAgorot),
      });
    if (sku !== unit.sku)
      rows.push({ label: "SKU", before: unit.sku ?? "—", after: sku ?? "—" });
    if (barcode !== unit.barcode)
      rows.push({
        label: "الباركود",
        before: unit.barcode ?? "—",
        after: barcode ?? "—",
      });
    if (!rows.length)
      return rejected("unchanged", "لا يوجد تغيير على طريقة البيع.");
    const warnings: string[] = [];
    if (unit.references > 0 && unitsPerSale !== unit.unitsPerSale) {
      warnings.push(
        "استُخدمت هذه الطريقة في طلبات سابقة؛ تبقى تلك الطلبات بعددها القديم، والسلال المفتوحة تطلب المراجعة.",
      );
    }
    if (unit.mirrorsVariant && priceAgorot !== unit.priceAgorot) {
      warnings.push(
        "هذه طريقة البيع الأساسية؛ تغيير سعرها يغيّر سعر الصنف أيضاً.",
      );
    }
    return {
      status: "ready",
      operation: "sellingUnitUpdate",
      args: { ...base, labelAr, unitsPerSale, priceAgorot, sku, barcode },
      summary: `تعديل «${unit.labelAr}»`,
      card: {
        title: "تعديل طريقة بيع",
        target,
        rows,
        impact: [
          `${deductionText(labelAr, unitsPerSale)} ${stockInterpretation(
            variant.freeBaseMilli,
            labelAr,
            unitsPerSale,
          )}`,
          "الطلبات والفواتير السابقة لا تتغيّر.",
        ],
        warnings,
        confirmLabel: "تأكيد التعديل",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareDelete(
    actor: AdminActor,
    input: { product: string; variant?: string; option: string },
  ): Promise<PrepareResult> {
    const denied = this.ownerOnly(actor);
    if (denied) return denied;
    const found = await this.locate(actor, input.product, input.variant);
    if (!found.ok) return found.result;
    const { product, variant } = found.located;
    const unit = this.findUnit(variant, input.option, "any");
    if ("status" in unit) return unit;
    if (unit.references > 0) {
      return rejected("in_use", sellingUnitErrorMessages.in_use);
    }
    if (unit.isDefault) {
      return rejected(
        "default_archived",
        sellingUnitErrorMessages.default_archived,
      );
    }
    if (
      !unit.archived &&
      !variant.units.some((row) => !row.archived && row.id !== unit.id)
    ) {
      return rejected("last_active", sellingUnitErrorMessages.last_active);
    }
    return {
      status: "ready",
      operation: "sellingUnitDelete",
      args: {
        domainId: product.id,
        variantId: variant.variantId,
        unitId: unit.id,
        unitVersion: unit.version,
      },
      summary: `حذف «${unit.labelAr}» نهائياً`,
      card: {
        title: "حذف طريقة بيع نهائياً",
        target: {
          label: `${product.nameAr} — ${variant.label} — ${unit.labelAr}`,
          href: productHref(product.id),
        },
        rows: [
          { label: "طريقة البيع", before: unitLine(unit), after: "تُحذف" },
        ],
        impact: ["لم تُستخدم في أي طلب أو فاتورة، لذلك يمكن حذفها."],
        warnings: ["لا يمكن التراجع عن الحذف النهائي."],
        confirmLabel: "حذف نهائي",
        destructive: true,
        reversible: false,
      },
    };
  }

  // Confirmed operations ---------------------------------------------------------

  buildHandlers(): Record<SellingUnitOperation, Handler<never>> {
    const units = this.s.sellingUnits;
    const version = (_actor: AdminActor, args: { variantId: string }) =>
      units.variantVersion(args.variantId);
    const done = (message: string, domainId: string): ExecutionResult => ({
      message,
      href: productHref(domainId),
      ref: `product:${domainId}`,
    });
    const target = z.object({
      domainId: z.string().regex(/^[a-z0-9-]{1,80}$/),
      variantId: z.string().regex(/^[a-z0-9-]{1,100}$/),
      unitId: z.uuid(),
      unitVersion: z.number().int().positive(),
    });
    const fields = z.object({
      labelAr: z.string().min(1).max(SELLING_UNIT_LABEL_MAX),
      unitsPerSale: z.number().int().min(1).max(MAX_UNITS_PER_SALE),
      priceAgorot: z.number().int().min(1).max(10_000_000),
      sku: z.string().max(64).nullable(),
      barcode: z.string().max(64).nullable(),
    });

    const sellingUnitsCreate: Handler<{
      domainId: string;
      variantId: string;
      variantVersion: string;
      options: Array<z.infer<typeof fields> & { isDefault: boolean }>;
    }> = {
      args: z.object({
        domainId: z.string().regex(/^[a-z0-9-]{1,80}$/),
        variantId: z.string().regex(/^[a-z0-9-]{1,100}$/),
        variantVersion: z.string().min(1).max(120),
        options: z
          .array(fields.extend({ isDefault: z.boolean() }))
          .min(1)
          .max(MAX_SELLING_UNITS_PER_VARIANT),
      }),
      version,
      async execute(actor, args) {
        await units.createMany(
          actor,
          args.variantId,
          args.options,
          args.variantVersion,
        );
        return done(
          `تمت إضافة ${args.options.length} من طرق البيع.`,
          args.domainId,
        );
      },
    };
    const sellingUnitUpdate: Handler<
      z.infer<typeof target> & z.infer<typeof fields>
    > = {
      args: target.extend(fields.shape),
      version,
      async execute(actor, args) {
        await units.update(actor, args.unitId, args.unitVersion, args);
        return done("تم تعديل طريقة البيع.", args.domainId);
      },
    };
    const state = (
      run: (actor: AdminActor, args: z.infer<typeof target>) => Promise<void>,
      message: string,
    ): Handler<z.infer<typeof target>> => ({
      args: target,
      version,
      async execute(actor, args) {
        await run(actor, args);
        return done(message, args.domainId);
      },
    });
    return {
      sellingUnitsCreate,
      sellingUnitUpdate,
      sellingUnitDefault: state(
        (actor, args) => units.setDefault(actor, args.unitId, args.unitVersion),
        "تم تغيير طريقة البيع الافتراضية.",
      ),
      sellingUnitArchive: state(
        (actor, args) =>
          units.setArchived(actor, args.unitId, args.unitVersion, true),
        "أُرشفت طريقة البيع.",
      ),
      sellingUnitRestore: state(
        (actor, args) =>
          units.setArchived(actor, args.unitId, args.unitVersion, false),
        "أُعيدت طريقة البيع.",
      ),
      sellingUnitDelete: state(
        (actor, args) => units.delete(actor, args.unitId, args.unitVersion),
        "حُذفت طريقة البيع نهائياً.",
      ),
    } as Record<SellingUnitOperation, Handler<never>>;
  }
}
