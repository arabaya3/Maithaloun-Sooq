import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { missingAmountClarification } from "./amount-refusal";
import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { can } from "@/features/admin/domain/permissions";
import { offerKinds } from "@/features/catalog/domain/offer-pricing";
import { formatIls } from "@/shared/lib/format-currency";
import { addDays, todayInStoreZone } from "@/shared/lib/store-time";

import type { PrepareResult } from "./assistant-operations";
import type {
  AssistantToolContext,
  PrepareToolOutput,
} from "./assistant-tools";
import { offerChangesInput } from "./party-operations";

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
const money = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .describe(
    'المبلغ كما كتبته المستخدمة حرفياً، مثل "15" أو "15 شيكل" أو "خمستعش". لا تحوّله ولا تحسبه؛ الخادم يقرؤه.',
  );
const customer = text(100).describe(
  "اسم الزبون كما قالته المستخدمة أو customerId",
);
const supplier = text(120).describe("اسم المورد أو supplierId");
const offer = text(80).describe("اسم العرض أو offerId");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("تاريخ بصيغة YYYY-MM-DD");
const forbidden = {
  status: "forbidden" as const,
  message: "هذه المعلومة للمالك فقط.",
};

function range(input: { from?: string; to?: string }) {
  const to = input.to ?? todayInStoreZone();
  return { from: input.from ?? addDays(to, -30), to };
}

// Bundles, single-price sets, draws and prizes are not offers; the owner's own words decide, not the model's.
const BUNDLE_OR_DRAW =
  /(?:^|\s)(?:ب|ال)?(?:بكج|بكجات|باكج|باكيج|بكيج|بوكس|سحب|سحوبات|جايزه|جائزه|جوائز|جوايز|مسابقه)(?=\s|$)|مجموعه بسعر/u;

function asksForBundleOrDraw(ownerText: string): boolean {
  return BUNDLE_OR_DRAW.test(normalizeArabicText(ownerText));
}

// "خصم 10% على مبيض": built from the owner's own kind, value and targets so the model never has to make a name up.
function defaultOfferName(input: {
  kind?: string;
  value?: string;
  products?: string[];
  variants?: string[];
  categories?: string[];
}): string | undefined {
  const target = [
    ...(input.products ?? []),
    ...(input.variants ?? []),
    ...(input.categories ?? []),
  ][0];
  if (!input.kind || !input.value || !target) return undefined;
  const value =
    input.kind === "percentage" ? `${input.value}%` : `${input.value} ₪`;
  const label = input.kind === "fixed_price" ? `سعر ${value}` : `خصم ${value}`;
  return `${label} على ${target}`.slice(0, 80);
}

export function createPartyTools(
  context: AssistantToolContext,
  run: Run,
  prepare: Prepare,
) {
  const { actor } = context;
  const ops = context.operations.partyOps;

  const read = {
    searchOffers: tool({
      description:
        "ابحث في العروض والخصومات (الحالية والمجدولة، ومع includeArchived المؤرشفة).",
      inputSchema: z
        .object({
          query: z.string().trim().max(80).optional(),
          includeArchived: z.boolean().optional(),
        })
        .strict(),
      execute: (input) =>
        run("searchOffers", input, async () => {
          if (!can(actor, "settings.manage")) return forbidden;
          const rows = await context.offers.list(actor, {
            search: input.query,
            includeArchived: input.includeArchived,
          });
          return {
            count: rows.length,
            offers: rows.slice(0, 10).map((row) => ({
              offerId: row.id,
              name: row.nameAr,
              kind: row.kind,
              value:
                row.kind === "percentage"
                  ? `${row.value}٪`
                  : formatIls(row.value),
              minQuantity: row.minQuantity,
              live: row.live,
              enabled: row.enabled,
              archived: row.archived,
              startsAt: row.startsAt,
              endsAt: row.endsAt,
              usedInOrders: row.usage,
            })),
          };
        }),
    }),
    getOfferDetails: tool({
      description:
        "تفاصيل عرض: الأصناف التي يشملها وسعر كل منها قبل وبعد العرض.",
      inputSchema: z.object({ offer }).strict(),
      execute: (input) =>
        run("getOfferDetails", input, async () => {
          if (!can(actor, "settings.manage")) return forbidden;
          const resolved = await ops.resolveOffer(actor, input.offer, true);
          if (!resolved.ok) return resolved.result;
          const offerInput = await context.offers.inputOf(resolved.offer.id);
          const preview = offerInput
            ? await context.offers.preview(offerInput)
            : [];
          return {
            status: "found" as const,
            offerId: resolved.offer.id,
            name: resolved.offer.nameAr,
            live: resolved.offer.live,
            enabled: resolved.offer.enabled,
            archived: resolved.offer.archived,
            startsAt: resolved.offer.startsAt,
            endsAt: resolved.offer.endsAt,
            minQuantity: resolved.offer.minQuantity,
            variants: preview.slice(0, 15).map((row) => ({
              label: row.label,
              listPrice: formatIls(row.listPriceAgorot),
              offerPrice:
                row.finalPriceAgorot === null
                  ? null
                  : formatIls(row.finalPriceAgorot),
            })),
            totalVariants: preview.length,
          };
        }),
    }),
    getCustomerDetails: tool({
      description:
        "تفاصيل زبون: الرصيد، آخر الفواتير والدفعات، وحالة التذكير. لا يعيد رقم الهاتف أو العنوان نفسه.",
      inputSchema: z.object({ customer }).strict(),
      execute: (input) =>
        run("getCustomerDetails", input, async () => {
          const resolved = await ops.resolveCustomer(actor, input.customer);
          if (!resolved.ok) return resolved.result;
          const [detail, contact] = await Promise.all([
            context.customers.getDetail(actor, resolved.id),
            context.customerMaintenance.contact(resolved.id),
          ]);
          if (!detail) return { status: "not_found" as const };
          return {
            status: "found" as const,
            customerId: detail.id,
            name: detail.name,
            balance: formatIls(detail.summary.balanceAgorot),
            hasWhatsapp: Boolean(detail.phoneE164),
            hasAddress: Boolean(contact?.address),
            oldestUnpaidDays: detail.summary.oldestUnpaid?.ageDays ?? null,
            invoices: detail.invoices.slice(0, 5).map((row) => ({
              number: row.invoiceNumber,
              date: row.date,
              total: formatIls(row.totalAgorot),
              remaining: formatIls(row.remainingAgorot),
            })),
            payments: detail.payments.slice(0, 5).map((row) => ({
              amount: formatIls(row.amountAgorot),
              date: row.createdAt.slice(0, 10),
              reversed: row.reversed,
            })),
            href: `/admin/customers/${detail.id}`,
          };
        }),
    }),
    getCustomerStatement: tool({
      description:
        "كشف حساب زبون لفترة (افتراضياً آخر 30 يوماً): الرصيد الافتتاحي والحركات والرصيد الختامي.",
      inputSchema: z
        .object({ customer, from: day.optional(), to: day.optional() })
        .strict(),
      execute: (input) =>
        run(
          "getCustomerStatement",
          { from: input.from, to: input.to },
          async () => {
            const resolved = await ops.resolveCustomer(actor, input.customer);
            if (!resolved.ok) return resolved.result;
            const period = range(input);
            const statement = await context.customerMaintenance.statement(
              resolved.id,
              period.from,
              period.to,
            );
            return {
              status: "found" as const,
              customer: resolved.name,
              from: period.from,
              to: period.to,
              opening: formatIls(statement.openingAgorot),
              closing: formatIls(statement.closingAgorot),
              lines: statement.lines.slice(-30).map((row) => ({
                date: row.date.slice(0, 10),
                type: row.label,
                amount: formatIls(row.amountAgorot),
                balance: formatIls(row.balanceAgorot),
              })),
              truncated: statement.truncated || statement.lines.length > 30,
              href: `/admin/customers/${resolved.id}`,
            };
          },
        ),
    }),
    searchSuppliers: tool({
      description: "ابحث عن مورد بالاسم مع المستحق له وعدد فواتير الشراء.",
      inputSchema: z.object({ name: text(120) }).strict(),
      execute: (input) =>
        run("searchSuppliers", input, async () => {
          const rows = await context.suppliers.list(actor);
          const needle = input.name.trim();
          const found = rows.filter(
            (row) => row.nameAr.includes(needle) || needle.includes(row.nameAr),
          );
          const customers = found.length
            ? []
            : (await context.customers.list(actor, { search: needle }))
                .slice(0, 5)
                .map((row) => ({ customerId: row.id, name: row.name }));
          return {
            status:
              found.length > 1
                ? ("ambiguous" as const)
                : found.length
                  ? ("found" as const)
                  : ("not_found" as const),
            ...(customers.length
              ? {
                  customers,
                  note: "لا يوجد مورد بهذا الاسم، لكنه اسم زبون. استعمل أدوات الزبائن.",
                }
              : {}),
            suppliers: found.slice(0, 8).map((row) => ({
              supplierId: row.id,
              name: row.nameAr,
              active: row.active,
              payable:
                row.balanceAgorot === null
                  ? null
                  : formatIls(row.balanceAgorot),
              invoices: row.invoiceCount,
            })),
            href: "/admin/inventory/suppliers",
          };
        }),
    }),
    getSupplierDetails: tool({
      description: "تفاصيل مورد: المستحق له وآخر فواتير الشراء.",
      inputSchema: z.object({ supplier }).strict(),
      execute: (input) =>
        run("getSupplierDetails", input, async () => {
          const resolved = await ops.resolveSupplier(
            actor,
            input.supplier,
            "supplier",
            true,
          );
          if (!resolved.ok) return resolved.result;
          const history = await context.supplierMaintenance.purchaseHistory(
            resolved.supplier.id,
            8,
          );
          return {
            status: "found" as const,
            supplierId: resolved.supplier.id,
            name: resolved.supplier.nameAr,
            active: resolved.supplier.active,
            payable:
              resolved.supplier.balanceAgorot === null
                ? null
                : formatIls(resolved.supplier.balanceAgorot),
            purchases: history.map((row) => ({
              reference: row.reference,
              date: row.invoiceDate,
              total:
                row.totalAgorot === null ? null : formatIls(row.totalAgorot),
              href: `/admin/inventory/purchases/${row.id}`,
            })),
            href: "/admin/inventory/suppliers",
          };
        }),
    }),
    getSupplierStatement: tool({
      description: "كشف حساب مورد لفترة (افتراضياً آخر 30 يوماً).",
      inputSchema: z
        .object({ supplier, from: day.optional(), to: day.optional() })
        .strict(),
      execute: (input) =>
        run(
          "getSupplierStatement",
          { from: input.from, to: input.to },
          async () => {
            if (!can(actor, "suppliers.balances")) return forbidden;
            const resolved = await ops.resolveSupplier(
              actor,
              input.supplier,
              "supplier",
              true,
            );
            if (!resolved.ok) return resolved.result;
            const period = range(input);
            const statement = await context.supplierMaintenance.statement(
              resolved.supplier.id,
              period.from,
              period.to,
            );
            return {
              status: "found" as const,
              supplier: resolved.supplier.nameAr,
              from: period.from,
              to: period.to,
              opening: formatIls(statement.openingAgorot),
              closing: formatIls(statement.closingAgorot),
              lines: statement.lines.slice(-30).map((row) => ({
                date: row.date.slice(0, 10),
                type: row.label,
                amount: formatIls(row.amountAgorot),
                balance: formatIls(row.balanceAgorot),
              })),
              truncated: statement.truncated || statement.lines.length > 30,
            };
          },
        ),
    }),
  };

  if (context.mode !== "full") return { read, mutate: {} };

  const offerFields = offerChangesInput.describe(
    'kind: percentage نسبة، amount_off خصم مبلغ، fixed_price سعر ثابت. value نص: النسبة مثل "15" أو المبلغ بالشيكل. products/variants/categories أسماء كما قالتها المستخدمة.',
  );

  const mutate = {
    prepareOfferCreation: tool({
      description:
        "جهّز بطاقة إنشاء عرض خصم على منتجات أو أصناف أو أقسام (كل صنف بخصمه). ليست للبكجات أو المجموعات بسعر واحد أو السحوبات والجوائز؛ هذه غير متاحة عبر المساعد فلا تستدعِ الأداة لها. أرسل فقط ما قالته المستخدمة؛ إذا نقص اسم العرض أو نوعه أو قيمته يعيد الخادم ما ينقص. لا تخترع النسبة أو السعر أو التواريخ.",
      inputSchema: offerFields.extend({ kind: z.enum(offerKinds).optional() }),
      execute: (input) =>
        prepare("prepareOfferCreation", input, async () => {
          if (asksForBundleOrDraw(context.ownerText?.() ?? "")) {
            return {
              status: "rejected" as const,
              code: "unsupported",
              message:
                "البكجات والمجموعات بسعر واحد والسحوبات والجوائز غير متاحة عبر المساعد حالياً. أقدر أجهّز عرض خصم عادي على منتجات أو أقسام.",
            };
          }
          // Missing details come back as a server clarification rather than a guess.
          const nameAr = input.nameAr ?? defaultOfferName(input);
          const missing = [
            input.kind ? null : "نوع الخصم (نسبة أو مبلغ أو سعر ثابت)",
            input.value ? null : "قيمة الخصم",
            nameAr || !input.kind || !input.value
              ? null
              : "المنتجات أو الأقسام التي يشملها العرض",
          ].filter((item): item is string => item !== null);
          if (!nameAr || !input.kind || !input.value) {
            return {
              status: "rejected" as const,
              code: "missing_required_field",
              message: `ناقص للعرض: ${missing.join("، ")}.`,
              values: missing,
            };
          }
          return ops.prepareOfferCreation(actor, {
            ...input,
            nameAr,
            kind: input.kind,
            value: input.value,
          });
        }),
    }),
    prepareOfferUpdate: tool({
      description:
        "جهّز بطاقة تعديل عرض: القيمة، الأصناف، التواريخ، أو التفعيل والإيقاف (enabled).",
      inputSchema: z.object({ offer, changes: offerFields }).strict(),
      execute: (input) =>
        prepare("prepareOfferUpdate", input, () =>
          ops.prepareOfferUpdate(actor, input),
        ),
    }),
    prepareOfferArchive: tool({
      description:
        "جهّز بطاقة أرشفة عرض (mode=archive) أو استرجاعه غير مفعّل (mode=restore).",
      inputSchema: z
        .object({ offer, mode: z.enum(["archive", "restore"]) })
        .strict(),
      execute: (input) =>
        prepare("prepareOfferArchive", input, () =>
          ops.prepareOfferArchive(actor, input),
        ),
    }),
    prepareUnusedOfferDeletion: tool({
      description: "جهّز بطاقة حذف نهائي لعرض لم يُستخدم في أي طلب.",
      inputSchema: z.object({ offer }).strict(),
      execute: (input) =>
        prepare("prepareUnusedOfferDeletion", input, () =>
          ops.prepareOfferArchive(actor, {
            offer: input.offer,
            mode: "delete",
          }),
        ),
    }),
    prepareCustomerCreation: tool({
      description: "جهّز بطاقة إضافة زبون. يتحقق من الأسماء المكررة أولاً.",
      inputSchema: z
        .object({
          name: text(100),
          phone: z
            .string()
            .trim()
            .max(20)
            .optional()
            .describe("رقم الواتساب مثل 0591234567"),
          countryCode: z.enum(["970", "972"]).optional(),
          address: z.string().trim().max(300).optional(),
          landmark: z.string().trim().max(160).optional(),
          notes: z.string().trim().max(500).optional(),
          duplicateDecision: z.enum(["create_new"]).optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareCustomerCreation", input, () =>
          ops.prepareCustomerCreation(actor, input),
        ),
    }),
    prepareCustomerUpdate: tool({
      description:
        "جهّز بطاقة تعديل بيانات زبون: الاسم، الواتساب، العنوان، أقرب معلم، الملاحظات.",
      inputSchema: z
        .object({
          customer,
          changes: z
            .object({
              name: z.string().trim().max(100).optional(),
              phone: z.string().trim().max(20).nullable().optional(),
              countryCode: z.enum(["970", "972"]).optional(),
              address: z.string().trim().max(300).nullable().optional(),
              landmark: z.string().trim().max(160).nullable().optional(),
              notes: z.string().trim().max(500).nullable().optional(),
            })
            .strict(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareCustomerUpdate", input, () =>
          ops.prepareCustomerUpdate(actor, input),
        ),
    }),
    prepareCustomerArchive: tool({
      description:
        "جهّز بطاقة أرشفة زبون (mode=archive) أو استرجاعه (mode=restore).",
      inputSchema: z
        .object({ customer, mode: z.enum(["archive", "restore"]) })
        .strict(),
      execute: (input) =>
        prepare("prepareCustomerArchive", input, () =>
          ops.prepareCustomerArchive(actor, input),
        ),
    }),
    prepareUnusedCustomerDeletion: tool({
      description:
        "جهّز بطاقة حذف نهائي لزبون بلا فواتير أو دفعات أو قيود أو تذكيرات.",
      inputSchema: z.object({ customer }).strict(),
      execute: (input) =>
        prepare("prepareUnusedCustomerDeletion", input, () =>
          ops.prepareCustomerArchive(actor, {
            customer: input.customer,
            mode: "delete",
          }),
        ),
    }),
    prepareCustomerMerge: tool({
      description:
        "جهّز بطاقة دمج زبون مكرر (duplicate) في الزبون الصحيح (target) مع نقل فواتيره ودفعاته وقيوده.",
      inputSchema: z.object({ duplicate: customer, target: customer }).strict(),
      execute: (input) =>
        prepare("prepareCustomerMerge", input, () =>
          ops.prepareCustomerMerge(actor, input),
        ),
    }),
    prepareCustomerPaymentReversal: tool({
      description: "جهّز بطاقة إلغاء دفعة زبون بقيد عكسي، مع السبب.",
      inputSchema: z
        .object({ customer, paymentId: z.uuid().optional(), reason: text(240) })
        .strict(),
      execute: (input) =>
        prepare("prepareCustomerPaymentReversal", input, () =>
          ops.prepareCustomerPaymentReversal(actor, input),
        ),
    }),
    prepareCustomerBalanceAdjustment: tool({
      description:
        "جهّز بطاقة تسوية رصيد زبون بقيد جديد: increase_debt يزيد دينه، reduce_debt يخفّضه. السبب مطلوب.",
      inputSchema: z
        .object({
          customer,
          amountIls: money,
          direction: z.enum(["increase_debt", "reduce_debt"]),
          reason: text(240),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareCustomerBalanceAdjustment", input, () =>
          ops.prepareCustomerBalanceAdjustment(actor, input),
        ),
    }),
    prepareCustomerReminder: tool({
      description:
        "جهّز بطاقة تذكير دين: date تذكير بتاريخ، pause إيقاف، resume استئناف، handled تمت المتابعة.",
      inputSchema: z
        .object({
          customer,
          mode: z.enum(["date", "pause", "resume", "handled"]),
          date: day.optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareCustomerReminder", input, () =>
          ops.prepareCustomerReminder(actor, input),
        ),
    }),
    prepareSupplierCreation: tool({
      description: "جهّز بطاقة إضافة مورد.",
      inputSchema: z
        .object({
          nameAr: text(120),
          phone: z.string().trim().max(20).optional(),
          notes: z.string().trim().max(500).optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareSupplierCreation", input, () =>
          ops.prepareSupplierCreation(actor, input),
        ),
    }),
    prepareSupplierUpdate: tool({
      description: "جهّز بطاقة تعديل مورد: الاسم، الهاتف، الملاحظات.",
      inputSchema: z
        .object({
          supplier,
          changes: z
            .object({
              nameAr: z.string().trim().max(120).optional(),
              phone: z.string().trim().max(20).nullable().optional(),
              notes: z.string().trim().max(500).nullable().optional(),
            })
            .strict(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareSupplierUpdate", input, () =>
          ops.prepareSupplierUpdate(actor, input),
        ),
    }),
    prepareSupplierArchive: tool({
      description:
        "جهّز بطاقة أرشفة مورد (mode=archive) أو استرجاعه (mode=restore).",
      inputSchema: z
        .object({ supplier, mode: z.enum(["archive", "restore"]) })
        .strict(),
      execute: (input) =>
        prepare("prepareSupplierArchive", input, () =>
          ops.prepareSupplierArchive(actor, input),
        ),
    }),
    prepareUnusedSupplierDeletion: tool({
      description: "جهّز بطاقة حذف نهائي لمورد بلا فواتير شراء أو قيود.",
      inputSchema: z.object({ supplier }).strict(),
      execute: (input) =>
        prepare("prepareUnusedSupplierDeletion", input, () =>
          ops.prepareSupplierArchive(actor, {
            supplier: input.supplier,
            mode: "delete",
          }),
        ),
    }),
    prepareSupplierMerge: tool({
      description: "جهّز بطاقة دمج مورد مكرر في المورد الصحيح.",
      inputSchema: z.object({ duplicate: supplier, target: supplier }).strict(),
      execute: (input) =>
        prepare("prepareSupplierMerge", input, () =>
          ops.prepareSupplierMerge(actor, input),
        ),
    }),
    prepareSupplierPayment: tool({
      description:
        "جهّز بطاقة تسجيل دفعة لمورد (لا تتجاوز المستحق له). إذا لم يُذكر المبلغ أو ذُكر أكثر من مبلغ أو كان غير مؤكد، استدعها بدون amountIls؛ الخادم يعيد ما يجب السؤال عنه.",
      inputSchema: z
        .object({
          supplier,
          amountIls: money.optional(),
          note: z.string().trim().max(240).optional(),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareSupplierPayment", input, async () =>
          input.amountIls
            ? ops.prepareSupplierPayment(actor, {
                ...input,
                amountIls: input.amountIls,
              })
            : missingAmountClarification(context, "اكتبي مبلغ الدفعة للمورد."),
        ),
    }),
    prepareSupplierCorrection: tool({
      description:
        "جهّز بطاقة تصحيح حساب مورد بقيد جديد: increase_payable يزيد المستحق، reduce_payable يخفّضه.",
      inputSchema: z
        .object({
          supplier,
          amountIls: money,
          direction: z.enum(["increase_payable", "reduce_payable"]),
          reason: text(240),
        })
        .strict(),
      execute: (input) =>
        prepare("prepareSupplierCorrection", input, () =>
          ops.prepareSupplierCorrection(actor, input),
        ),
    }),
    prepareSupplierProductAlias: tool({
      description:
        "جهّز بطاقة ربط اسم صنف كما يكتبه المورد في فواتيره بمنتج في المتجر.",
      inputSchema: z
        .object({ supplier, product: text(160), alias: text(280) })
        .strict(),
      execute: (input) =>
        prepare("prepareSupplierProductAlias", input, () =>
          ops.prepareSupplierAlias(actor, input),
        ),
    }),
  };

  return { read, mutate };
}
