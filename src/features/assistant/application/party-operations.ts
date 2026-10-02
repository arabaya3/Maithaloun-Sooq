import "server-only";

import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { can, type Permission } from "@/features/admin/domain/permissions";
import {
  offerKinds,
  type OfferKind,
} from "@/features/catalog/domain/offer-pricing";
import type { Product } from "@/features/catalog/domain/product";
import type {
  OfferInput,
  OfferService,
  OfferTargets,
} from "@/features/offers/application/offer-service";
import type { SupplierMaintenanceService } from "@/features/purchasing/application/supplier-maintenance-service";
import type { SupplierService } from "@/features/purchasing/application/supplier-service";
import type { CustomerMaintenanceService } from "@/features/sales/application/customer-maintenance-service";
import type { CustomerService } from "@/features/sales/application/customer-service";
import type { SalesService } from "@/features/sales/application/sales-service";
import { normalizePalestinianPhone } from "@/features/orders/domain/phone";
import { formatIls } from "@/shared/lib/format-currency";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";
import { moneyRejection } from "@/features/assistant/domain/money-rejection";
import {
  addDays,
  startOfStoreDay,
  todayInStoreZone,
} from "@/shared/lib/store-time";

import type { PartyOperation } from "../domain/assistant-policy";
import { canonicalJson, sha256 } from "../domain/confirmation-token";
import type { EntityCandidate } from "../domain/entity-match";
import type {
  ConfirmationCard,
  ExecutionResult,
  Handler,
  PrepareResult,
} from "./assistant-operations";
import type { CatalogOperations } from "./catalog-operations";

const rejected = (code: string, message: string): PrepareResult => ({
  status: "rejected",
  code,
  message,
});
const customerHref = (id: string) => `/admin/customers/${id}`;
const suppliersHref = "/admin/inventory/suppliers";
const offersHref = "/admin/products";
const dateText = (value: string | null) => value ?? "مفتوح";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export interface PartyOperationServices {
  customers: CustomerService;
  customerMaintenance: CustomerMaintenanceService;
  sales: SalesService;
  suppliers: SupplierService;
  supplierMaintenance: SupplierMaintenanceService;
  offers: OfferService;
  catalogOps: CatalogOperations;
  resolveProduct: (
    actor: AdminActor,
    query: string,
    scope: "product" | "variant",
    field: string,
  ) => Promise<
    | { ok: true; match: EntityCandidate; product: Product }
    | { ok: false; result: PrepareResult }
  >;
}

export const offerChangesInput = z
  .object({
    nameAr: z.string().trim().min(2).max(80).optional(),
    displayText: z.string().trim().max(120).nullable().optional(),
    kind: z.enum(offerKinds).optional(),
    value: z.string().trim().max(12).optional(),
    minQuantity: z.number().int().min(1).max(100).optional(),
    startsOn: isoDate.nullable().optional(),
    endsOn: isoDate.nullable().optional(),
    enabled: z.boolean().optional(),
    products: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
    variants: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
    categories: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  })
  .strict();
type OfferChanges = z.infer<typeof offerChangesInput>;

function offerValueLabel(kind: OfferKind, value: number) {
  return kind === "percentage"
    ? `خصم ${value}٪`
    : kind === "amount_off"
      ? `خصم ${formatIls(value)} على الحبة`
      : `سعر ثابت ${formatIls(value)}`;
}

function windowLabel(startsAt: Date | null, endsAt: Date | null) {
  const day = (date: Date | null, shift = 0) =>
    date
      ? addDays(
          date.toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" }),
          shift,
        )
      : null;
  return `${dateText(day(startsAt))} ← ${dateText(day(endsAt, -1))}`;
}

function phoneOf(input: {
  phone?: string;
  countryCode?: "970" | "972";
}): string | null | false {
  if (!input.phone) return null;
  const digits = input.phone.replace(/[^\d+]/g, "");
  const candidate =
    input.countryCode && /^0?5\d{8}$/.test(digits)
      ? `+${input.countryCode}${digits.replace(/^0/, "")}`
      : input.phone;
  return normalizePalestinianPhone(candidate) ?? false;
}

export class PartyOperations {
  constructor(private readonly services: PartyOperationServices) {}

  private denied(
    actor: AdminActor,
    permission: Permission,
    message: string,
  ): PrepareResult | null {
    return can(actor, permission) ? null : rejected("forbidden", message);
  }

  // Offers

  async resolveOffer(
    actor: AdminActor,
    query: string,
    includeArchived = false,
  ) {
    const all = await this.services.offers.list(actor, {
      includeArchived: true,
    });
    const pool = includeArchived ? all : all.filter((row) => !row.archived);
    const text = query.trim();
    const exact = pool.filter((row) => row.id === text || row.nameAr === text);
    const matches = exact.length
      ? exact
      : pool.filter(
          (row) => row.nameAr.includes(text) || text.includes(row.nameAr),
        );
    if (matches.length === 1) return { ok: true as const, offer: matches[0]! };
    if (matches.length > 1) {
      return {
        ok: false as const,
        result: {
          status: "needs_selection",
          field: "offer",
          question: "أي عرض تقصدين؟",
          options: matches
            .slice(0, 6)
            .map((row) => ({ id: row.id, label: row.nameAr })),
        } satisfies PrepareResult,
      };
    }
    return {
      ok: false as const,
      result: rejected(
        "not_found",
        `ما لقيت عرضاً باسم «${text.slice(0, 40)}».`,
      ),
    };
  }

  private async resolveTargets(
    actor: AdminActor,
    changes: Pick<OfferChanges, "products" | "variants" | "categories">,
  ): Promise<
    { ok: true; targets: OfferTargets } | { ok: false; result: PrepareResult }
  > {
    const targets: OfferTargets = {
      productIds: [],
      variantIds: [],
      categoryCodes: [],
    };
    for (const query of changes.products ?? []) {
      const resolved = await this.services.resolveProduct(
        actor,
        query,
        "product",
        "products",
      );
      if (!resolved.ok) return resolved;
      targets.productIds.push(resolved.product.id);
    }
    for (const query of changes.variants ?? []) {
      const resolved = await this.services.resolveProduct(
        actor,
        query,
        "variant",
        "variants",
      );
      if (!resolved.ok) return resolved;
      targets.variantIds.push(resolved.match.variantId);
    }
    for (const query of changes.categories ?? []) {
      const resolved = await this.services.catalogOps.resolveCategory(query, {
        field: "categories",
      });
      if (!resolved.ok) return resolved;
      targets.categoryCodes.push(resolved.category.code);
    }
    return { ok: true, targets };
  }

  private parseValue(kind: OfferKind, value: string): number | null {
    if (kind === "percentage") {
      const percent = Number(value.replace("%", "").replace("٪", "").trim());
      return Number.isInteger(percent) && percent >= 1 && percent <= 90
        ? percent
        : null;
    }
    return parseIlsToAgorot(value);
  }

  private async offerCard(
    input: OfferInput,
    before: OfferInput | null,
    title: string,
    offerId: string | null,
  ): Promise<
    { ok: true; card: ConfirmationCard } | { ok: false; result: PrepareResult }
  > {
    const rows = await this.services.offers.preview(input);
    if (!rows.length) {
      return {
        ok: false,
        result: rejected(
          "empty_target",
          "حددي منتجات أو أصنافاً أو أقساماً يشملها العرض.",
        ),
      };
    }
    const invalid = rows.filter((row) => row.finalPriceAgorot === null);
    if (invalid.length) {
      return {
        ok: false,
        result: rejected(
          "invalid_price",
          `العرض لا يخفّض السعر أو يجعله صفراً أو أقل لـ: ${invalid
            .slice(0, 4)
            .map((row) => row.label)
            .join("، ")}.`,
        ),
      };
    }
    if (input.enabled) {
      const conflicts = await this.services.offers.conflicts(
        input,
        offerId ?? undefined,
      );
      if (conflicts.length) {
        return {
          ok: false,
          result: rejected(
            "conflict",
            `يتعارض مع العرض المفعّل «${conflicts[0]!.nameAr}» على: ${conflicts[0]!.variants.slice(0, 3).join("، ")}. عطّلي أحدهما أو غيّري التواريخ.`,
          ),
        };
      }
    }
    const warnings = rows
      .filter(
        (row) =>
          row.avgCostAgorot !== null &&
          row.finalPriceAgorot! < row.avgCostAgorot,
      )
      .slice(0, 4)
      .map(
        (row) =>
          `«${row.label}» سيُباع بأقل من متوسط تكلفته (${formatIls(row.avgCostAgorot!)}).`,
      );
    const summary = (value: OfferInput | null) =>
      value
        ? `${offerValueLabel(value.kind, value.value)}${value.minQuantity > 1 ? ` عند ${value.minQuantity}+` : ""}`
        : null;
    const card: ConfirmationCard = {
      title,
      target: { label: input.nameAr, href: offersHref },
      rows: [
        { label: "العرض", before: summary(before), after: summary(input)! },
        {
          label: "المدة",
          before: before ? windowLabel(before.startsAt, before.endsAt) : null,
          after: windowLabel(input.startsAt, input.endsAt),
        },
        {
          label: "الحالة",
          before: before ? (before.enabled ? "مفعّل" : "غير مفعّل") : null,
          after: input.enabled ? "مفعّل" : "غير مفعّل",
        },
        ...rows.slice(0, 10).map((row) => ({
          label: row.label,
          before: formatIls(row.listPriceAgorot),
          after: formatIls(row.finalPriceAgorot!),
        })),
      ],
      impact: [
        rows.length > 10
          ? `يشمل ${rows.length} صنفاً (أول 10 معروضة).`
          : `يشمل ${rows.length} صنفاً.`,
        "السعر الأصلي في الكتالوج لا يتغيّر؛ سعر العرض يُحسب عند الطلب ويُحفظ في الطلب.",
        input.enabled
          ? "سيظهر للزبائن خلال مدة العرض."
          : "لن يظهر للزبائن حتى يُفعَّل.",
      ],
      warnings,
      confirmLabel: "تأكيد العرض",
      destructive: false,
      reversible: true,
    };
    return { ok: true, card };
  }

  private toOfferInput(
    base: OfferInput | null,
    changes: OfferChanges,
    targets: OfferTargets | null,
  ): { ok: true; input: OfferInput } | { ok: false; result: PrepareResult } {
    const kind = changes.kind ?? base?.kind;
    const nameAr = changes.nameAr ?? base?.nameAr;
    if (!kind || !nameAr)
      return {
        ok: false,
        result: rejected("invalid_input", "حددي اسم العرض ونوعه."),
      };
    let value = base?.value ?? null;
    if (changes.value !== undefined || changes.kind !== undefined) {
      if (changes.value === undefined) {
        return {
          ok: false,
          result: rejected("invalid_input", "حددي قيمة الخصم أو سعر العرض."),
        };
      }
      value = this.parseValue(kind, changes.value);
    }
    if (!value) {
      return {
        ok: false,
        result: rejected(
          "invalid_input",
          kind === "percentage"
            ? "النسبة يجب أن تكون بين 1 و90."
            : "المبلغ غير مفهوم.",
        ),
      };
    }
    const startsAt =
      changes.startsOn === undefined
        ? (base?.startsAt ?? null)
        : changes.startsOn
          ? startOfStoreDay(changes.startsOn)
          : null;
    const endsAt =
      changes.endsOn === undefined
        ? (base?.endsAt ?? null)
        : changes.endsOn
          ? startOfStoreDay(addDays(changes.endsOn, 1))
          : null;
    if (startsAt && endsAt && endsAt <= startsAt) {
      return {
        ok: false,
        result: rejected("invalid_input", "تاريخ النهاية قبل تاريخ البداية."),
      };
    }
    return {
      ok: true,
      input: {
        nameAr,
        displayText:
          changes.displayText === undefined
            ? (base?.displayText ?? null)
            : changes.displayText || null,
        kind,
        value,
        minQuantity: changes.minQuantity ?? base?.minQuantity ?? 1,
        startsAt,
        endsAt,
        enabled: changes.enabled ?? base?.enabled ?? false,
        targets: targets ??
          base?.targets ?? {
            productIds: [],
            variantIds: [],
            categoryCodes: [],
          },
      },
    };
  }

  async prepareOfferCreation(
    actor: AdminActor,
    changes: OfferChanges,
  ): Promise<PrepareResult> {
    const denied = this.denied(actor, "settings.manage", "العروض للمالك فقط.");
    if (denied) return denied;
    const targets = await this.resolveTargets(actor, changes);
    if (!targets.ok) return targets.result;
    const built = this.toOfferInput(null, changes, targets.targets);
    if (!built.ok) return built.result;
    const card = await this.offerCard(built.input, null, "إضافة عرض", null);
    if (!card.ok) return card.result;
    return {
      status: "ready",
      operation: "offerCreate",
      args: { input: serializeOffer(built.input) },
      summary: `إضافة عرض ${built.input.nameAr}`,
      card: card.card,
    };
  }

  async prepareOfferUpdate(
    actor: AdminActor,
    input: { offer: string; changes: OfferChanges },
  ): Promise<PrepareResult> {
    const denied = this.denied(actor, "settings.manage", "العروض للمالك فقط.");
    if (denied) return denied;
    const resolved = await this.resolveOffer(actor, input.offer);
    if (!resolved.ok) return resolved.result;
    const base = await this.services.offers.inputOf(resolved.offer.id);
    if (!base) return rejected("not_found", "العرض غير موجود.");
    const retarget =
      input.changes.products ||
      input.changes.variants ||
      input.changes.categories;
    const targets = retarget
      ? await this.resolveTargets(actor, input.changes)
      : null;
    if (targets && !targets.ok) return targets.result;
    const built = this.toOfferInput(
      base,
      input.changes,
      targets?.targets ?? null,
    );
    if (!built.ok) return built.result;
    if (
      canonicalJson(serializeOffer(built.input)) ===
      canonicalJson(serializeOffer(base))
    ) {
      return rejected("no_change", "لا يوجد ما يتغيّر في العرض.");
    }
    const title =
      input.changes.enabled !== undefined &&
      Object.keys(input.changes).length === 1
        ? input.changes.enabled
          ? "تفعيل عرض"
          : "إيقاف عرض"
        : "تعديل عرض";
    const card = await this.offerCard(
      built.input,
      base,
      title,
      resolved.offer.id,
    );
    if (!card.ok) return card.result;
    return {
      status: "ready",
      operation: "offerUpdate",
      args: { offerId: resolved.offer.id, input: serializeOffer(built.input) },
      summary: `${title}: ${built.input.nameAr}`,
      card: card.card,
    };
  }

  async prepareOfferArchive(
    actor: AdminActor,
    input: { offer: string; mode: "archive" | "restore" | "delete" },
  ): Promise<PrepareResult> {
    const denied = this.denied(actor, "settings.manage", "العروض للمالك فقط.");
    if (denied) return denied;
    const resolved = await this.resolveOffer(
      actor,
      input.offer,
      input.mode !== "archive",
    );
    if (!resolved.ok) return resolved.result;
    const { offer } = resolved;
    if (input.mode === "delete") {
      if (offer.usage > 0) {
        return rejected(
          "in_use",
          `العرض مستخدم في ${offer.usage} سطر طلب، لذلك لا يُحذف نهائياً. يمكن أرشفته.`,
        );
      }
      return {
        status: "ready",
        operation: "offerDelete",
        args: { offerId: offer.id },
        summary: `حذف عرض ${offer.nameAr} نهائياً`,
        card: {
          title: "حذف عرض نهائياً",
          target: { label: offer.nameAr, href: offersHref },
          rows: [{ label: "العرض", before: offer.nameAr, after: "يُحذف" }],
          impact: ["لا توجد طلبات استخدمت هذا العرض."],
          warnings: ["لا يمكن التراجع عن الحذف النهائي."],
          dependencies: ["أسطر طلبات 0"],
          confirmLabel: "حذف نهائي",
          destructive: true,
          reversible: false,
        },
      };
    }
    if ((input.mode === "archive") === offer.archived) {
      return rejected(
        "no_change",
        offer.archived ? "العرض مؤرشف أصلاً." : "العرض غير مؤرشف.",
      );
    }
    return {
      status: "ready",
      operation: input.mode === "archive" ? "offerArchive" : "offerRestore",
      args: { offerId: offer.id },
      summary: `${input.mode === "archive" ? "أرشفة" : "استرجاع"} عرض ${offer.nameAr}`,
      card: {
        title: input.mode === "archive" ? "أرشفة عرض" : "استرجاع عرض",
        target: { label: offer.nameAr, href: offersHref },
        rows: [
          {
            label: "الحالة",
            before: offer.archived
              ? "مؤرشف"
              : offer.enabled
                ? "مفعّل"
                : "غير مفعّل",
            after: input.mode === "archive" ? "مؤرشف" : "غير مفعّل",
          },
        ],
        impact:
          input.mode === "archive"
            ? [
                "يتوقف العرض فوراً عن الظهور والتطبيق على الطلبات الجديدة؛ الطلبات السابقة لا تتغيّر.",
              ]
            : ["يعود العرض غير مفعّل؛ فعّليه لاحقاً إذا أردتِ."],
        warnings: [],
        confirmLabel: "تأكيد",
        destructive: false,
        reversible: true,
      },
    };
  }

  // Customers

  async resolveCustomer(actor: AdminActor, query: string, field = "customer") {
    const text = query.trim();
    if (z.uuid().safeParse(text).success) {
      const detail = await this.services.customers.getDetail(actor, text);
      return detail
        ? { ok: true as const, id: detail.id, name: detail.name }
        : {
            ok: false as const,
            result: rejected("not_found", "الزبون غير موجود."),
          };
    }
    const matches = await this.services.customers.findByName(actor, text);
    const exact = matches.filter((row) => row.exact);
    if (exact.length === 1)
      return { ok: true as const, id: exact[0]!.id, name: exact[0]!.name };
    if (!matches.length) {
      return {
        ok: false as const,
        result: rejected(
          "not_found",
          `ما لقيت زبوناً باسم «${text.slice(0, 40)}».`,
        ),
      };
    }
    if (matches.length === 1 && !exact.length) {
      return { ok: true as const, id: matches[0]!.id, name: matches[0]!.name };
    }
    return {
      ok: false as const,
      result: {
        status: "needs_selection",
        field,
        question: "لقيت أكثر من زبون، أي واحد؟",
        options: (exact.length ? exact : matches).map((row) => ({
          id: row.id,
          label: row.name,
        })),
      } satisfies PrepareResult,
    };
  }

  async prepareCustomerCreation(
    actor: AdminActor,
    input: {
      name: string;
      phone?: string;
      countryCode?: "970" | "972";
      address?: string;
      landmark?: string;
      notes?: string;
      duplicateDecision?: "create_new";
    },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "sales.record",
      "ليست لديك صلاحية إضافة زبائن.",
    );
    if (denied) return denied;
    const name = input.name.trim();
    if (name.length < 2) return rejected("invalid_input", "اكتبي اسم الزبون.");
    const phone = phoneOf(input);
    if (phone === false)
      return rejected(
        "invalid_phone",
        "رقم الواتساب غير صحيح. اكتبيه مثل 0591234567.",
      );
    const all = await this.services.customers.list(actor);
    const normalized = normalizeArabicText(name);
    const sameName = all.filter(
      (row) => normalizeArabicText(row.name) === normalized,
    );
    if (sameName.length) {
      return rejected(
        "duplicate",
        `يوجد زبون بنفس الاسم «${sameName[0]!.name}». استخدميه أو أضيفي تمييزاً للاسم (مثل اسم العائلة).`,
      );
    }
    const similar = (
      await this.services.customers.findByName(actor, name)
    ).filter((row) => !row.exact);
    if (similar.length && input.duplicateDecision !== "create_new") {
      return {
        status: "needs_selection",
        field: "duplicateDecision",
        question: "لقيت زبائن بأسماء قريبة. هل هو واحد منهم أم زبون جديد؟",
        options: [
          ...similar.map((row) => ({
            id: row.id,
            label: `الموجود: ${row.name}`,
          })),
          { id: "create_new", label: "زبون جديد" },
        ],
      };
    }
    const details = {
      name,
      phone: phone ?? undefined,
      address: input.address?.trim() || undefined,
      landmark: input.landmark?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
    };
    return {
      status: "ready",
      operation: "customerCreate",
      args: { details },
      summary: `إضافة زبون ${name}`,
      card: {
        title: "إضافة زبون",
        target: { label: name, href: "/admin/customers" },
        rows: [
          { label: "الاسم", before: null, after: name },
          { label: "واتساب", before: null, after: phone ?? "—" },
          { label: "العنوان", before: null, after: details.address ?? "—" },
          { label: "أقرب معلم", before: null, after: details.landmark ?? "—" },
        ],
        impact: ["رصيد الزبون يبدأ من صفر."],
        warnings: similar.length
          ? [
              `يوجد زبائن بأسماء قريبة: ${similar.map((row) => row.name).join("، ")}.`,
            ]
          : [],
        confirmLabel: "تأكيد الإضافة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareCustomerUpdate(
    actor: AdminActor,
    input: {
      customer: string;
      changes: {
        name?: string;
        phone?: string | null;
        countryCode?: "970" | "972";
        address?: string | null;
        landmark?: string | null;
        notes?: string | null;
      };
    },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "sales.record",
      "ليست لديك صلاحية تعديل الزبائن.",
    );
    if (denied) return denied;
    const resolved = await this.resolveCustomer(actor, input.customer);
    if (!resolved.ok) return resolved.result;
    const current = await this.services.customers.getDetail(actor, resolved.id);
    const extra = await this.services.customerMaintenance.contact(resolved.id);
    if (!current || !extra) return rejected("not_found", "الزبون غير موجود.");
    const { changes } = input;
    const next = {
      name: changes.name?.trim() || current.name,
      phone: current.phoneE164 ?? undefined,
      notes:
        changes.notes === undefined
          ? (current.notes ?? undefined)
          : changes.notes?.trim() || undefined,
      address:
        changes.address === undefined
          ? (extra.address ?? undefined)
          : changes.address?.trim() || "",
      landmark:
        changes.landmark === undefined
          ? (extra.landmark ?? undefined)
          : changes.landmark?.trim() || "",
    };
    if (changes.phone !== undefined) {
      const phone = changes.phone
        ? phoneOf({ phone: changes.phone, countryCode: changes.countryCode })
        : null;
      if (phone === false)
        return rejected("invalid_phone", "رقم الواتساب غير صحيح.");
      next.phone = phone ?? undefined;
    }
    const rows: ConfirmationCard["rows"] = [];
    const push = (
      label: string,
      before: string | null,
      after: string | undefined,
    ) => {
      if ((before ?? "") !== (after ?? ""))
        rows.push({ label, before: before || "—", after: after || "—" });
    };
    push("الاسم", current.name, next.name);
    push("واتساب", current.phoneE164, next.phone);
    push("العنوان", extra.address, next.address);
    push("أقرب معلم", extra.landmark, next.landmark);
    push("ملاحظات", current.notes, next.notes);
    if (!rows.length) return rejected("no_change", "لا يوجد ما يتغيّر.");
    return {
      status: "ready",
      operation: "customerUpdate",
      args: { customerId: resolved.id, details: next },
      summary: `تعديل بيانات ${current.name}`,
      card: {
        title: "تعديل بيانات زبون",
        target: { label: current.name, href: customerHref(resolved.id) },
        rows,
        impact: ["الطلبات والفواتير السابقة تبقى بالبيانات التي سُجّلت بها."],
        warnings: [],
        confirmLabel: "تأكيد التعديل",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareCustomerArchive(
    actor: AdminActor,
    input: { customer: string; mode: "archive" | "restore" | "delete" },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "settings.manage",
      "أرشفة وحذف الزبائن للمالك فقط.",
    );
    if (denied) return denied;
    const resolved =
      input.mode === "archive"
        ? await this.resolveCustomer(actor, input.customer)
        : await this.services.customerMaintenance.findAny(input.customer);
    if (!resolved.ok)
      return resolved.result ?? rejected("not_found", "الزبون غير موجود.");
    const references = await this.services.customerMaintenance.references(
      resolved.id,
    );
    const balance = await this.services.customerMaintenance.balance(
      resolved.id,
    );
    if (!references) return rejected("not_found", "الزبون غير موجود.");
    const usage = `فواتير ${references.invoices} · دفعات ${references.payments} · قيود ${references.ledgerEntries} · تذكيرات ${references.reminders}`;
    if (input.mode === "delete") {
      if (
        references.invoices +
          references.payments +
          references.ledgerEntries +
          references.reminders >
        0
      ) {
        return rejected(
          "in_use",
          `الزبون مرتبط بسجلات (${usage})، لذلك لا يُحذف نهائياً. يمكن أرشفته.`,
        );
      }
      return {
        status: "ready",
        operation: "customerDelete",
        args: { customerId: resolved.id },
        summary: `حذف ${resolved.name} نهائياً`,
        card: {
          title: "حذف زبون نهائياً",
          target: { label: resolved.name, href: customerHref(resolved.id) },
          rows: [{ label: "الزبون", before: resolved.name, after: "يُحذف" }],
          impact: ["لا توجد فواتير أو دفعات أو قيود لهذا الزبون."],
          warnings: ["لا يمكن التراجع عن الحذف النهائي."],
          dependencies: usage.split(" · "),
          confirmLabel: "حذف نهائي",
          destructive: true,
          reversible: false,
        },
      };
    }
    const archive = input.mode === "archive";
    return {
      status: "ready",
      operation: archive ? "customerArchive" : "customerRestore",
      args: { customerId: resolved.id },
      summary: `${archive ? "أرشفة" : "استرجاع"} ${resolved.name}`,
      card: {
        title: archive ? "أرشفة زبون" : "استرجاع زبون",
        target: { label: resolved.name, href: customerHref(resolved.id) },
        rows: [
          {
            label: "الحالة",
            before: archive ? "نشط" : "مؤرشف",
            after: archive ? "مؤرشف" : "نشط",
          },
          { label: "الرصيد", before: null, after: formatIls(balance) },
        ],
        impact: archive
          ? ["يختفي من قوائم الزبائن والبحث، وتبقى فواتيره ودفعاته كما هي."]
          : ["يعود للقوائم والبحث."],
        warnings:
          archive && balance > 0
            ? [
                `عليه دين ${formatIls(balance)}؛ الأرشفة لا تلغي الدين ولا التذكيرات المسجلة.`,
              ]
            : [],
        confirmLabel: "تأكيد",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareCustomerMerge(
    actor: AdminActor,
    input: { duplicate: string; target: string },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "settings.manage",
      "دمج الزبائن للمالك فقط.",
    );
    if (denied) return denied;
    const source = await this.resolveCustomer(
      actor,
      input.duplicate,
      "duplicate",
    );
    if (!source.ok) return source.result;
    const target = await this.resolveCustomer(actor, input.target, "target");
    if (!target.ok) return target.result;
    if (source.id === target.id)
      return rejected("same_customer", "الزبونان نفس الشخص في النظام.");
    const [refs, sourceBalance, targetBalance] = await Promise.all([
      this.services.customerMaintenance.references(source.id),
      this.services.customerMaintenance.balance(source.id),
      this.services.customerMaintenance.balance(target.id),
    ]);
    if (!refs) return rejected("not_found", "الزبون غير موجود.");
    return {
      status: "ready",
      operation: "customerMerge",
      args: { sourceId: source.id, targetId: target.id },
      summary: `دمج ${source.name} في ${target.name}`,
      card: {
        title: "دمج زبونين",
        target: {
          label: `${source.name} ← ${target.name}`,
          href: customerHref(target.id),
        },
        rows: [
          {
            label: `رصيد ${target.name}`,
            before: formatIls(targetBalance),
            after: formatIls(targetBalance + sourceBalance),
          },
          {
            label: `رصيد ${source.name}`,
            before: formatIls(sourceBalance),
            after: formatIls(0),
          },
          {
            label: "سجل المكرر",
            before: null,
            after: `فواتير ${refs.invoices} · دفعات ${refs.payments} · قيود ${refs.ledgerEntries} (تبقى كما هي)`,
          },
        ],
        impact: [
          "الفواتير والدفعات سجلات ثابتة لا تُنقل؛ يُنقل الرصيد فقط بقيدي تسوية متقابلين.",
          `يُؤرشف «${source.name}» ويُربط بالزبون الصحيح، ويُضاف اسمه كاسم بديل للبحث.`,
        ],
        warnings: ["الدمج لا يُلغى تلقائياً."],
        confirmLabel: "تأكيد الدمج",
        destructive: true,
        reversible: false,
      },
    };
  }

  async prepareCustomerPaymentReversal(
    actor: AdminActor,
    input: { customer: string; paymentId?: string; reason: string },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "ledger.correct",
      "إلغاء الدفعات للمالك فقط.",
    );
    if (denied) return denied;
    const resolved = await this.resolveCustomer(actor, input.customer);
    if (!resolved.ok) return resolved.result;
    const detail = await this.services.customers.getDetail(actor, resolved.id);
    if (!detail) return rejected("not_found", "الزبون غير موجود.");
    const open = detail.payments.filter(
      (row) => !row.reversed && !row.isReversal && !row.atSale,
    );
    const payment = input.paymentId
      ? open.find((row) => row.id === input.paymentId)
      : open.length === 1
        ? open[0]
        : undefined;
    if (!payment) {
      if (!open.length)
        return rejected("not_found", "لا توجد دفعات يمكن إلغاؤها لهذا الزبون.");
      return {
        status: "needs_selection",
        field: "paymentId",
        question: "أي دفعة تريدين إلغاءها؟",
        options: open.slice(0, 6).map((row) => ({
          id: row.id,
          label: `${formatIls(row.amountAgorot)} — ${row.createdAt.slice(0, 10)}`,
        })),
      };
    }
    const reason = input.reason.trim();
    if (reason.length < 2)
      return rejected("invalid_input", "اكتبي سبب الإلغاء.");
    const balance = detail.summary.balanceAgorot;
    return {
      status: "ready",
      operation: "customerPaymentReversal",
      args: {
        customerId: resolved.id,
        paymentId: payment.id,
        reason: reason.slice(0, 240),
      },
      summary: `إلغاء دفعة ${formatIls(payment.amountAgorot)} لـ ${detail.name}`,
      card: {
        title: "إلغاء دفعة زبون",
        target: { label: detail.name, href: customerHref(resolved.id) },
        rows: [
          {
            label: "الدفعة",
            before: null,
            after: `${formatIls(payment.amountAgorot)} بتاريخ ${payment.createdAt.slice(0, 10)}`,
          },
          {
            label: "الرصيد",
            before: formatIls(balance),
            after: formatIls(balance + payment.amountAgorot),
          },
          { label: "السبب", before: null, after: reason },
        ],
        impact: ["يُضاف قيد عكسي؛ الدفعة الأصلية تبقى في السجل."],
        warnings: [],
        confirmLabel: "تأكيد الإلغاء",
        destructive: false,
        reversible: false,
      },
    };
  }

  async prepareCustomerBalanceAdjustment(
    actor: AdminActor,
    input: {
      customer: string;
      amountIls: string;
      direction: "increase_debt" | "reduce_debt";
      reason: string;
    },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "ledger.correct",
      "تسويات الرصيد للمالك فقط.",
    );
    if (denied) return denied;
    const resolved = await this.resolveCustomer(actor, input.customer);
    if (!resolved.ok) return resolved.result;
    const amount = parseIlsToAgorot(input.amountIls);
    if (!amount) return moneyRejection(input.amountIls);
    const reason = input.reason.trim();
    if (reason.length < 2)
      return rejected("invalid_input", "اكتبي سبب التسوية.");
    const signed = input.direction === "increase_debt" ? amount : -amount;
    const balance = await this.services.customerMaintenance.balance(
      resolved.id,
    );
    return {
      status: "ready",
      operation: "customerBalanceAdjustment",
      args: {
        customerId: resolved.id,
        amountAgorot: signed,
        reason: reason.slice(0, 240),
      },
      summary: `تسوية رصيد ${resolved.name}`,
      card: {
        title: "تسوية رصيد زبون",
        target: { label: resolved.name, href: customerHref(resolved.id) },
        rows: [
          {
            label: "التسوية",
            before: null,
            after: `${input.direction === "increase_debt" ? "زيادة الدين" : "تخفيض الدين"} ${formatIls(amount)}`,
          },
          {
            label: "الرصيد",
            before: formatIls(balance),
            after: formatIls(balance + signed),
          },
          { label: "السبب", before: null, after: reason },
        ],
        impact: ["يُضاف قيد تسوية جديد؛ لا يُعدَّل أي قيد سابق."],
        warnings:
          balance + signed < 0
            ? ["سيصبح للزبون رصيد دائن (المتجر مدين له)."]
            : [],
        confirmLabel: "تأكيد التسوية",
        destructive: false,
        reversible: false,
      },
    };
  }

  async prepareCustomerReminder(
    actor: AdminActor,
    input: {
      customer: string;
      mode: "date" | "pause" | "resume" | "handled";
      date?: string;
    },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "reminders.manage",
      "ليست لديك صلاحية التذكيرات.",
    );
    if (denied) return denied;
    const resolved = await this.resolveCustomer(actor, input.customer);
    if (!resolved.ok) return resolved.result;
    const today = todayInStoreZone();
    if (
      input.mode === "date" &&
      (!input.date ||
        !isoDate.safeParse(input.date).success ||
        input.date < today)
    ) {
      return rejected(
        "invalid_input",
        "اكتبي تاريخ التذكير بصيغة 2026-10-15، ولا يكون في الماضي.",
      );
    }
    const labels = {
      date: `تذكير بتاريخ ${input.date}`,
      pause: "إيقاف التذكيرات",
      resume: "استئناف التذكيرات",
      handled: `تمت المتابعة؛ التذكير التالي ${addDays(today, 7)}`,
    };
    return {
      status: "ready",
      operation: "reminderSchedule",
      args: {
        customerId: resolved.id,
        mode: input.mode,
        date: input.date ?? null,
      },
      summary: `${labels[input.mode]} — ${resolved.name}`,
      card: {
        title: "تذكير الدين",
        target: { label: resolved.name, href: customerHref(resolved.id) },
        rows: [{ label: "التذكير", before: null, after: labels[input.mode] }],
        impact: ["التذكير يصل لفريق المتجر فقط ولا يُرسل شيء للزبون."],
        warnings: [],
        confirmLabel: "تأكيد",
        destructive: false,
        reversible: true,
      },
    };
  }

  // Suppliers

  async resolveSupplier(
    actor: AdminActor,
    query: string,
    field = "supplier",
    includeInactive = false,
  ) {
    const all = await this.services.suppliers.list(actor);
    const pool = includeInactive ? all : all.filter((row) => row.active);
    const text = query.trim();
    const needle = normalizeArabicText(text);
    const exact = pool.filter(
      (row) => row.id === text || normalizeArabicText(row.nameAr) === needle,
    );
    const matches = exact.length
      ? exact
      : pool.filter((row) => {
          const name = normalizeArabicText(row.nameAr);
          return (
            needle.length >= 2 &&
            (name.includes(needle) || needle.includes(name))
          );
        });
    if (matches.length === 1)
      return { ok: true as const, supplier: matches[0]! };
    if (!matches.length) {
      return {
        ok: false as const,
        result: rejected(
          "not_found",
          `ما لقيت مورداً باسم «${text.slice(0, 40)}».`,
        ),
      };
    }
    return {
      ok: false as const,
      result: {
        status: "needs_selection",
        field,
        question: "أي مورد تقصدين؟",
        options: matches
          .slice(0, 6)
          .map((row) => ({ id: row.id, label: row.nameAr })),
      } satisfies PrepareResult,
    };
  }

  async prepareSupplierCreation(
    actor: AdminActor,
    input: { nameAr: string; phone?: string; notes?: string },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "suppliers.manage",
      "ليست لديك صلاحية الموردين.",
    );
    if (denied) return denied;
    const nameAr = input.nameAr.trim();
    if (nameAr.length < 2)
      return rejected("invalid_input", "اكتبي اسم المورد.");
    const existing = await this.resolveSupplier(
      actor,
      nameAr,
      "supplier",
      true,
    );
    if (
      existing.ok &&
      normalizeArabicText(existing.supplier.nameAr) ===
        normalizeArabicText(nameAr)
    ) {
      return rejected(
        "duplicate",
        `المورد «${existing.supplier.nameAr}» موجود${existing.supplier.active ? "" : " (مؤرشف)"}.`,
      );
    }
    return {
      status: "ready",
      operation: "supplierCreate",
      args: {
        details: {
          nameAr,
          phone: input.phone?.trim() || undefined,
          notes: input.notes?.trim() || undefined,
        },
      },
      summary: `إضافة مورد ${nameAr}`,
      card: {
        title: "إضافة مورد",
        target: { label: nameAr, href: suppliersHref },
        rows: [
          { label: "الاسم", before: null, after: nameAr },
          { label: "الهاتف", before: null, after: input.phone?.trim() || "—" },
        ],
        impact: ["رصيد المورد يبدأ من صفر."],
        warnings: existing.ok
          ? [`يوجد مورد باسم قريب: ${existing.supplier.nameAr}.`]
          : [],
        confirmLabel: "تأكيد الإضافة",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareSupplierUpdate(
    actor: AdminActor,
    input: {
      supplier: string;
      changes: {
        nameAr?: string;
        phone?: string | null;
        notes?: string | null;
      };
    },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "suppliers.manage",
      "ليست لديك صلاحية الموردين.",
    );
    if (denied) return denied;
    const resolved = await this.resolveSupplier(actor, input.supplier);
    if (!resolved.ok) return resolved.result;
    const { supplier } = resolved;
    const next = {
      nameAr: input.changes.nameAr?.trim() || supplier.nameAr,
      phone:
        input.changes.phone === undefined
          ? (supplier.phone ?? undefined)
          : input.changes.phone?.trim() || undefined,
      notes:
        input.changes.notes === undefined
          ? (supplier.notes ?? undefined)
          : input.changes.notes?.trim() || undefined,
    };
    const rows: ConfirmationCard["rows"] = [];
    if (next.nameAr !== supplier.nameAr)
      rows.push({
        label: "الاسم",
        before: supplier.nameAr,
        after: next.nameAr,
      });
    if ((next.phone ?? "") !== (supplier.phone ?? ""))
      rows.push({
        label: "الهاتف",
        before: supplier.phone ?? "—",
        after: next.phone ?? "—",
      });
    if ((next.notes ?? "") !== (supplier.notes ?? ""))
      rows.push({
        label: "ملاحظات",
        before: supplier.notes ?? "—",
        after: next.notes ?? "—",
      });
    if (!rows.length) return rejected("no_change", "لا يوجد ما يتغيّر.");
    return {
      status: "ready",
      operation: "supplierUpdate",
      args: {
        supplierId: supplier.id,
        details: { ...next, active: supplier.active },
      },
      summary: `تعديل المورد ${supplier.nameAr}`,
      card: {
        title: "تعديل مورد",
        target: { label: supplier.nameAr, href: suppliersHref },
        rows,
        impact: ["فواتير الشراء السابقة لا تتغيّر."],
        warnings: [],
        confirmLabel: "تأكيد التعديل",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareSupplierArchive(
    actor: AdminActor,
    input: { supplier: string; mode: "archive" | "restore" | "delete" },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "settings.manage",
      "أرشفة وحذف الموردين للمالك فقط.",
    );
    if (denied) return denied;
    const resolved = await this.resolveSupplier(
      actor,
      input.supplier,
      "supplier",
      input.mode !== "archive",
    );
    if (!resolved.ok) return resolved.result;
    const { supplier } = resolved;
    const refs = await this.services.supplierMaintenance.references(
      supplier.id,
    );
    if (!refs) return rejected("not_found", "المورد غير موجود.");
    const usage = [
      `فواتير شراء ${refs.invoices}`,
      `قيود ${refs.ledgerEntries}`,
      `أسماء بديلة ${refs.aliases}`,
    ];
    if (input.mode === "delete") {
      if (refs.invoices + refs.ledgerEntries > 0) {
        return rejected(
          "in_use",
          `المورد مرتبط بسجلات (${usage.join("، ")})، لذلك لا يُحذف نهائياً. يمكن أرشفته.`,
        );
      }
      return {
        status: "ready",
        operation: "supplierDelete",
        args: { supplierId: supplier.id },
        summary: `حذف المورد ${supplier.nameAr} نهائياً`,
        card: {
          title: "حذف مورد نهائياً",
          target: { label: supplier.nameAr, href: suppliersHref },
          rows: [{ label: "المورد", before: supplier.nameAr, after: "يُحذف" }],
          impact: ["لا توجد فواتير شراء أو قيود لهذا المورد."],
          warnings: ["لا يمكن التراجع عن الحذف النهائي."],
          dependencies: usage,
          confirmLabel: "حذف نهائي",
          destructive: true,
          reversible: false,
        },
      };
    }
    const archive = input.mode === "archive";
    if (archive !== supplier.active) {
      return rejected(
        "no_change",
        archive ? "المورد مؤرشف أصلاً." : "المورد نشط أصلاً.",
      );
    }
    return {
      status: "ready",
      operation: archive ? "supplierArchive" : "supplierRestore",
      args: { supplierId: supplier.id },
      summary: `${archive ? "أرشفة" : "استرجاع"} المورد ${supplier.nameAr}`,
      card: {
        title: archive ? "أرشفة مورد" : "استرجاع مورد",
        target: { label: supplier.nameAr, href: suppliersHref },
        rows: [
          {
            label: "الحالة",
            before: archive ? "نشط" : "مؤرشف",
            after: archive ? "مؤرشف" : "نشط",
          },
        ],
        impact: archive
          ? ["يختفي من اختيار المورد في المشتريات، وتبقى فواتيره وقيوده."]
          : ["يعود لقوائم الموردين."],
        warnings:
          archive && (supplier.balanceAgorot ?? 0) > 0
            ? [`للمورد رصيد مستحق ${formatIls(supplier.balanceAgorot!)}.`]
            : [],
        confirmLabel: "تأكيد",
        destructive: false,
        reversible: true,
      },
    };
  }

  async prepareSupplierMerge(
    actor: AdminActor,
    input: { duplicate: string; target: string },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "settings.manage",
      "دمج الموردين للمالك فقط.",
    );
    if (denied) return denied;
    const source = await this.resolveSupplier(
      actor,
      input.duplicate,
      "duplicate",
    );
    if (!source.ok) return source.result;
    const target = await this.resolveSupplier(actor, input.target, "target");
    if (!target.ok) return target.result;
    if (source.supplier.id === target.supplier.id)
      return rejected("same_supplier", "المورّدان نفس المورد.");
    const refs = await this.services.supplierMaintenance.references(
      source.supplier.id,
    );
    if (!refs) return rejected("not_found", "المورد غير موجود.");
    const sourceBalance = source.supplier.balanceAgorot ?? 0;
    const targetBalance = target.supplier.balanceAgorot ?? 0;
    return {
      status: "ready",
      operation: "supplierMerge",
      args: { sourceId: source.supplier.id, targetId: target.supplier.id },
      summary: `دمج ${source.supplier.nameAr} في ${target.supplier.nameAr}`,
      card: {
        title: "دمج موردين",
        target: {
          label: `${source.supplier.nameAr} ← ${target.supplier.nameAr}`,
          href: suppliersHref,
        },
        rows: [
          {
            label: `مستحقات ${target.supplier.nameAr}`,
            before: formatIls(targetBalance),
            after: formatIls(targetBalance + sourceBalance),
          },
          {
            label: `مستحقات ${source.supplier.nameAr}`,
            before: formatIls(sourceBalance),
            after: formatIls(0),
          },
          {
            label: "سجل المكرر",
            before: null,
            after: `فواتير شراء ${refs.invoices} · قيود ${refs.ledgerEntries} (تبقى) · أسماء بديلة ${refs.aliases} (تنتقل)`,
          },
        ],
        impact: [
          "فواتير الشراء والقيود ثابتة لا تُنقل؛ يُنقل المستحق فقط بقيدي تصحيح متقابلين.",
          `يُؤرشف «${source.supplier.nameAr}» ويُربط بالمورد الصحيح.`,
        ],
        warnings: ["الدمج لا يُلغى تلقائياً."],
        confirmLabel: "تأكيد الدمج",
        destructive: true,
        reversible: false,
      },
    };
  }

  async prepareSupplierPayment(
    actor: AdminActor,
    input: { supplier: string; amountIls: string; note?: string },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "suppliers.balances",
      "دفعات الموردين للمالك فقط.",
    );
    if (denied) return denied;
    const resolved = await this.resolveSupplier(actor, input.supplier);
    if (!resolved.ok) return resolved.result;
    const amount = parseIlsToAgorot(input.amountIls);
    if (!amount) return moneyRejection(input.amountIls);
    const balance = resolved.supplier.balanceAgorot ?? 0;
    if (amount > balance) {
      return rejected(
        "payment_exceeds_balance",
        `المستحق للمورد ${formatIls(balance)} فقط.`,
      );
    }
    return {
      status: "ready",
      operation: "supplierPayment",
      args: {
        supplierId: resolved.supplier.id,
        amountAgorot: amount,
        note: input.note?.trim().slice(0, 240) || null,
      },
      summary: `دفعة ${formatIls(amount)} لـ ${resolved.supplier.nameAr}`,
      card: {
        title: "دفعة لمورد",
        target: { label: resolved.supplier.nameAr, href: suppliersHref },
        rows: [
          { label: "المبلغ", before: null, after: formatIls(amount) },
          {
            label: "المستحق للمورد",
            before: formatIls(balance),
            after: formatIls(balance - amount),
          },
        ],
        impact: ["يُسجَّل قيد دفعة في حساب المورد."],
        warnings: [],
        confirmLabel: "تأكيد الدفعة",
        destructive: false,
        reversible: false,
      },
    };
  }

  async prepareSupplierCorrection(
    actor: AdminActor,
    input: {
      supplier: string;
      amountIls: string;
      direction: "increase_payable" | "reduce_payable";
      reason: string;
    },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "suppliers.balances",
      "تصحيح حسابات الموردين للمالك فقط.",
    );
    if (denied) return denied;
    const resolved = await this.resolveSupplier(actor, input.supplier);
    if (!resolved.ok) return resolved.result;
    const amount = parseIlsToAgorot(input.amountIls);
    if (!amount) return moneyRejection(input.amountIls);
    const reason = input.reason.trim();
    if (reason.length < 2)
      return rejected("invalid_input", "اكتبي سبب التصحيح.");
    const signed = input.direction === "increase_payable" ? amount : -amount;
    const balance = resolved.supplier.balanceAgorot ?? 0;
    return {
      status: "ready",
      operation: "supplierCorrection",
      args: {
        supplierId: resolved.supplier.id,
        amountAgorot: signed,
        reason: reason.slice(0, 240),
      },
      summary: `تصحيح حساب ${resolved.supplier.nameAr}`,
      card: {
        title: "تصحيح حساب مورد",
        target: { label: resolved.supplier.nameAr, href: suppliersHref },
        rows: [
          {
            label: "التصحيح",
            before: null,
            after: `${signed > 0 ? "زيادة المستحق" : "تخفيض المستحق"} ${formatIls(amount)}`,
          },
          {
            label: "المستحق للمورد",
            before: formatIls(balance),
            after: formatIls(balance + signed),
          },
          { label: "السبب", before: null, after: reason },
        ],
        impact: ["يُضاف قيد تصحيح جديد؛ لا يُعدَّل أي قيد سابق."],
        warnings:
          balance + signed < 0 ? ["سيصبح للمتجر رصيد دائن عند المورد."] : [],
        confirmLabel: "تأكيد التصحيح",
        destructive: false,
        reversible: false,
      },
    };
  }

  async prepareSupplierAlias(
    actor: AdminActor,
    input: { supplier: string; product: string; alias: string },
  ): Promise<PrepareResult> {
    const denied = this.denied(
      actor,
      "suppliers.manage",
      "ليست لديك صلاحية الموردين.",
    );
    if (denied) return denied;
    const supplier = await this.resolveSupplier(actor, input.supplier);
    if (!supplier.ok) return supplier.result;
    const product = await this.services.resolveProduct(
      actor,
      input.product,
      "variant",
      "product",
    );
    if (!product.ok) return product.result;
    const alias = input.alias.trim().slice(0, 280);
    if (alias.length < 2)
      return rejected(
        "invalid_input",
        "اكتبي الاسم كما يظهر في فاتورة المورد.",
      );
    return {
      status: "ready",
      operation: "supplierAlias",
      args: {
        supplierId: supplier.supplier.id,
        variantDomainId: product.match.variantId,
        aliasText: alias,
      },
      summary: `اسم «${alias}» لـ ${product.match.label}`,
      card: {
        title: "ربط اسم المورد بمنتج",
        target: { label: supplier.supplier.nameAr, href: suppliersHref },
        rows: [{ label: alias, before: null, after: product.match.label }],
        impact: [
          "فواتير هذا المورد القادمة ستطابق هذا الاسم بالمنتج تلقائياً.",
        ],
        warnings: [],
        confirmLabel: "تأكيد الربط",
        destructive: false,
        reversible: true,
      },
    };
  }

  buildHandlers(): Record<PartyOperation, Handler<never>> {
    const s = this.services;
    const done = (
      message: string,
      href: string | null,
      ref: string,
    ): ExecutionResult => ({ message, href, ref });
    const offerVersion = async (
      _actor: AdminActor,
      args: { offerId: string },
    ) => s.offers.version(args.offerId);
    const customerVersion = async (
      _actor: AdminActor,
      args: { customerId: string },
    ) => s.customerMaintenance.version(args.customerId);
    const supplierVersion = async (
      _actor: AdminActor,
      args: { supplierId: string },
    ) => s.supplierMaintenance.version(args.supplierId);
    const offerArgs = z.object({ input: z.record(z.string(), z.unknown()) });

    const handlers = {
      offerCreate: {
        args: offerArgs,
        // Targets' prices and competing offers are part of the version, so a changed catalog makes the card stale.
        version: async (
          _actor: AdminActor,
          args: z.infer<typeof offerArgs>,
        ) => {
          const input = deserializeOffer(args.input);
          const [preview, conflicts] = await Promise.all([
            s.offers.preview(input),
            input.enabled ? s.offers.conflicts(input) : [],
          ]);
          return sha256(
            canonicalJson({
              preview,
              conflicts: conflicts.map((row) => row.offerId),
            }),
          );
        },
        async execute(actor: AdminActor, args: z.infer<typeof offerArgs>) {
          const result = await s.offers.create(
            actor,
            deserializeOffer(args.input),
          );
          return done("تم حفظ العرض.", offersHref, `offer:${result.id}`);
        },
      },
      offerUpdate: {
        args: z.object({
          offerId: z.uuid(),
          input: z.record(z.string(), z.unknown()),
        }),
        async version(
          _actor: AdminActor,
          args: { offerId: string; input: Record<string, unknown> },
        ) {
          const [version, preview] = await Promise.all([
            s.offers.version(args.offerId),
            s.offers.preview(deserializeOffer(args.input)),
          ]);
          return version ? sha256(canonicalJson({ version, preview })) : null;
        },
        async execute(
          actor: AdminActor,
          args: { offerId: string; input: Record<string, unknown> },
        ) {
          await s.offers.update(
            actor,
            args.offerId,
            deserializeOffer(args.input),
          );
          return done("تم تعديل العرض.", offersHref, `offer:${args.offerId}`);
        },
      },
      offerArchive: {
        args: z.object({ offerId: z.uuid() }),
        version: offerVersion,
        async execute(actor: AdminActor, args: { offerId: string }) {
          await s.offers.setArchived(actor, args.offerId, true);
          return done("تمت أرشفة العرض.", offersHref, `offer:${args.offerId}`);
        },
      },
      offerRestore: {
        args: z.object({ offerId: z.uuid() }),
        version: offerVersion,
        async execute(actor: AdminActor, args: { offerId: string }) {
          await s.offers.setArchived(actor, args.offerId, false);
          return done(
            "تم استرجاع العرض غير مفعّل.",
            offersHref,
            `offer:${args.offerId}`,
          );
        },
      },
      offerDelete: {
        args: z.object({ offerId: z.uuid() }),
        version: offerVersion,
        async execute(actor: AdminActor, args: { offerId: string }) {
          await s.offers.deleteUnused(actor, args.offerId);
          return done(
            "تم حذف العرض نهائياً.",
            offersHref,
            `offer:${args.offerId}`,
          );
        },
      },
      customerCreate: {
        args: z.object({ details: z.record(z.string(), z.unknown()) }),
        async version(
          _actor: AdminActor,
          args: { details: Record<string, unknown> },
        ) {
          const taken = await s.customerMaintenance.nameTaken(
            String(args.details.name ?? ""),
          );
          return taken ? null : "new";
        },
        async execute(
          actor: AdminActor,
          args: { details: Record<string, unknown> },
        ) {
          const created = await s.customers.create(
            actor,
            args.details as never,
          );
          return done(
            `تمت إضافة الزبون ${String(args.details.name)}.`,
            customerHref(created.id),
            `customer:${created.id}`,
          );
        },
      },
      customerUpdate: {
        args: z.object({
          customerId: z.uuid(),
          details: z.record(z.string(), z.unknown()),
        }),
        version: customerVersion,
        async execute(
          actor: AdminActor,
          args: { customerId: string; details: Record<string, unknown> },
        ) {
          await s.customers.update(actor, {
            id: args.customerId,
            ...(args.details as { name: string }),
          });
          return done(
            "تم تعديل بيانات الزبون.",
            customerHref(args.customerId),
            `customer:${args.customerId}`,
          );
        },
      },
      customerArchive: {
        args: z.object({ customerId: z.uuid() }),
        version: customerVersion,
        async execute(actor: AdminActor, args: { customerId: string }) {
          await s.customerMaintenance.setActive(actor, args.customerId, false);
          return done(
            "تمت أرشفة الزبون.",
            customerHref(args.customerId),
            `customer:${args.customerId}`,
          );
        },
      },
      customerRestore: {
        args: z.object({ customerId: z.uuid() }),
        version: customerVersion,
        async execute(actor: AdminActor, args: { customerId: string }) {
          await s.customerMaintenance.setActive(actor, args.customerId, true);
          return done(
            "تم استرجاع الزبون.",
            customerHref(args.customerId),
            `customer:${args.customerId}`,
          );
        },
      },
      customerMerge: {
        args: z.object({ sourceId: z.uuid(), targetId: z.uuid() }),
        async version(
          _actor: AdminActor,
          args: { sourceId: string; targetId: string },
        ) {
          const [source, target] = await Promise.all([
            s.customerMaintenance.version(args.sourceId),
            s.customerMaintenance.version(args.targetId),
          ]);
          return source && target ? sha256(`${source}|${target}`) : null;
        },
        async execute(
          actor: AdminActor,
          args: { sourceId: string; targetId: string },
          key: string,
        ) {
          const merged = await s.customerMaintenance.merge(actor, {
            ...args,
            idempotencyKey: key,
          });
          return done(
            `تم الدمج ونقل رصيد ${formatIls(merged.transferredAgorot)}.`,
            customerHref(args.targetId),
            `customer:${args.targetId}`,
          );
        },
      },
      customerDelete: {
        args: z.object({ customerId: z.uuid() }),
        async version(_actor: AdminActor, args: { customerId: string }) {
          const [version, refs] = await Promise.all([
            s.customerMaintenance.version(args.customerId),
            s.customerMaintenance.references(args.customerId),
          ]);
          return version && refs
            ? sha256(`${version}|${canonicalJson(refs)}`)
            : null;
        },
        async execute(actor: AdminActor, args: { customerId: string }) {
          await s.customerMaintenance.deleteUnused(actor, args.customerId);
          return done(
            "تم حذف الزبون نهائياً.",
            "/admin/customers",
            `customer:${args.customerId}`,
          );
        },
      },
      customerPaymentReversal: {
        args: z.object({
          customerId: z.uuid(),
          paymentId: z.uuid(),
          reason: z.string().max(240),
        }),
        version: customerVersion,
        async execute(
          actor: AdminActor,
          args: { customerId: string; paymentId: string; reason: string },
        ) {
          const result = await s.sales.reversePayment(actor, {
            paymentId: args.paymentId,
            reason: args.reason,
          });
          return done(
            `تم إلغاء الدفعة. الرصيد الآن ${formatIls(result.balanceAgorot)}.`,
            customerHref(args.customerId),
            `customer:${args.customerId}`,
          );
        },
      },
      customerBalanceAdjustment: {
        args: z.object({
          customerId: z.uuid(),
          amountAgorot: z.number().int(),
          reason: z.string().max(240),
        }),
        version: customerVersion,
        async execute(
          actor: AdminActor,
          args: { customerId: string; amountAgorot: number; reason: string },
          key: string,
        ) {
          const result = await s.customerMaintenance.adjustBalance(actor, {
            ...args,
            idempotencyKey: key,
          });
          return done(
            `تمت التسوية. الرصيد الآن ${formatIls(result.balanceAgorot)}.`,
            customerHref(args.customerId),
            `customer:${args.customerId}`,
          );
        },
      },
      reminderSchedule: {
        args: z.object({
          customerId: z.uuid(),
          mode: z.enum(["date", "pause", "resume", "handled"]),
          date: isoDate.nullable(),
        }),
        version: customerVersion,
        async execute(
          actor: AdminActor,
          args: {
            customerId: string;
            mode: "date" | "pause" | "resume" | "handled";
            date: string | null;
          },
        ) {
          await s.customerMaintenance.scheduleReminder(actor, {
            customerId: args.customerId,
            mode: args.mode,
            date: args.date ?? undefined,
            today: todayInStoreZone(),
          });
          return done(
            "تم حفظ التذكير.",
            customerHref(args.customerId),
            `customer:${args.customerId}`,
          );
        },
      },
      supplierCreate: {
        args: z.object({ details: z.record(z.string(), z.unknown()) }),
        async version() {
          return "new";
        },
        async execute(
          actor: AdminActor,
          args: { details: Record<string, unknown> },
        ) {
          const created = await s.suppliers.create(
            actor,
            args.details as never,
          );
          return done(
            `تمت إضافة المورد ${String(args.details.nameAr)}.`,
            suppliersHref,
            `supplier:${created.id}`,
          );
        },
      },
      supplierUpdate: {
        args: z.object({
          supplierId: z.uuid(),
          details: z.record(z.string(), z.unknown()),
        }),
        version: supplierVersion,
        async execute(
          actor: AdminActor,
          args: { supplierId: string; details: Record<string, unknown> },
        ) {
          await s.suppliers.update(actor, {
            id: args.supplierId,
            ...(args.details as { nameAr: string; active: boolean }),
          });
          return done(
            "تم تعديل المورد.",
            suppliersHref,
            `supplier:${args.supplierId}`,
          );
        },
      },
      supplierArchive: {
        args: z.object({ supplierId: z.uuid() }),
        version: supplierVersion,
        async execute(actor: AdminActor, args: { supplierId: string }) {
          await s.supplierMaintenance.setActive(actor, args.supplierId, false);
          return done(
            "تمت أرشفة المورد.",
            suppliersHref,
            `supplier:${args.supplierId}`,
          );
        },
      },
      supplierRestore: {
        args: z.object({ supplierId: z.uuid() }),
        version: supplierVersion,
        async execute(actor: AdminActor, args: { supplierId: string }) {
          await s.supplierMaintenance.setActive(actor, args.supplierId, true);
          return done(
            "تم استرجاع المورد.",
            suppliersHref,
            `supplier:${args.supplierId}`,
          );
        },
      },
      supplierMerge: {
        args: z.object({ sourceId: z.uuid(), targetId: z.uuid() }),
        async version(
          _actor: AdminActor,
          args: { sourceId: string; targetId: string },
        ) {
          const [source, target] = await Promise.all([
            s.supplierMaintenance.version(args.sourceId),
            s.supplierMaintenance.version(args.targetId),
          ]);
          return source && target ? sha256(`${source}|${target}`) : null;
        },
        async execute(
          actor: AdminActor,
          args: { sourceId: string; targetId: string },
          key: string,
        ) {
          const merged = await s.supplierMaintenance.merge(actor, {
            ...args,
            idempotencyKey: key,
          });
          return done(
            `تم الدمج ونقل مستحق ${formatIls(merged.transferredAgorot)}.`,
            suppliersHref,
            `supplier:${args.targetId}`,
          );
        },
      },
      supplierDelete: {
        args: z.object({ supplierId: z.uuid() }),
        async version(_actor: AdminActor, args: { supplierId: string }) {
          const [version, refs] = await Promise.all([
            s.supplierMaintenance.version(args.supplierId),
            s.supplierMaintenance.references(args.supplierId),
          ]);
          return version && refs
            ? sha256(`${version}|${canonicalJson(refs)}`)
            : null;
        },
        async execute(actor: AdminActor, args: { supplierId: string }) {
          await s.supplierMaintenance.deleteUnused(actor, args.supplierId);
          return done(
            "تم حذف المورد نهائياً.",
            suppliersHref,
            `supplier:${args.supplierId}`,
          );
        },
      },
      supplierPayment: {
        args: z.object({
          supplierId: z.uuid(),
          amountAgorot: z.number().int().positive(),
          note: z.string().max(240).nullable(),
        }),
        version: supplierVersion,
        async execute(
          actor: AdminActor,
          args: {
            supplierId: string;
            amountAgorot: number;
            note: string | null;
          },
          key: string,
        ) {
          const result = await s.suppliers.recordPayment(actor, {
            supplierId: args.supplierId,
            amountAgorot: args.amountAgorot,
            note: args.note ?? undefined,
            idempotencyKey: key,
          });
          return done(
            `تم تسجيل الدفعة. المستحق الآن ${formatIls(result.balanceAgorot)}.`,
            suppliersHref,
            `supplier:${args.supplierId}`,
          );
        },
      },
      supplierCorrection: {
        args: z.object({
          supplierId: z.uuid(),
          amountAgorot: z.number().int(),
          reason: z.string().max(240),
        }),
        version: supplierVersion,
        async execute(
          actor: AdminActor,
          args: { supplierId: string; amountAgorot: number; reason: string },
          key: string,
        ) {
          const result = await s.supplierMaintenance.correction(actor, {
            ...args,
            idempotencyKey: key,
          });
          return done(
            `تم التصحيح. المستحق الآن ${formatIls(result.balanceAgorot)}.`,
            suppliersHref,
            `supplier:${args.supplierId}`,
          );
        },
      },
      supplierAlias: {
        args: z.object({
          supplierId: z.uuid(),
          variantDomainId: z.string(),
          aliasText: z.string().max(280),
        }),
        version: supplierVersion,
        async execute(
          actor: AdminActor,
          args: {
            supplierId: string;
            variantDomainId: string;
            aliasText: string;
          },
        ) {
          await s.supplierMaintenance.addProductAlias(actor, args);
          return done(
            "تم ربط الاسم بالمنتج.",
            suppliersHref,
            `supplier:${args.supplierId}`,
          );
        },
      },
    };
    return handlers as unknown as Record<PartyOperation, Handler<never>>;
  }
}

export function serializeOffer(input: OfferInput) {
  return {
    ...input,
    startsAt: input.startsAt?.toISOString() ?? null,
    endsAt: input.endsAt?.toISOString() ?? null,
  };
}

export function deserializeOffer(value: Record<string, unknown>): OfferInput {
  const raw = value as ReturnType<typeof serializeOffer>;
  return {
    ...raw,
    startsAt: raw.startsAt ? new Date(raw.startsAt) : null,
    endsAt: raw.endsAt ? new Date(raw.endsAt) : null,
  };
}
