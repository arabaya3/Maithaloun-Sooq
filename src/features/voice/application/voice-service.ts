import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { assertPermission, can } from "@/features/admin/domain/permissions";
import type {
  InventoryService,
  StockListItem,
} from "@/features/inventory/application/inventory-service";
import {
  InventoryError,
  type Database,
} from "@/features/inventory/application/stock-ledger";
import { formatQuantity } from "@/features/inventory/domain/quantity";
import { stockUnitLabels } from "@/features/inventory/domain/stock-constants";
import type { SupplierService } from "@/features/purchasing/application/supplier-service";
import { matchLine } from "@/features/purchasing/domain/line-matching";
import {
  NEW_SUPPLIER,
  type PurchaseDraft,
} from "@/features/purchasing/domain/purchase-draft";
import type { ReportService } from "@/features/reports/application/report-service";
import {
  reportPresetLabels,
  resolvePeriod,
} from "@/features/reports/domain/report-calculation";
import type { CustomerService } from "@/features/sales/application/customer-service";
import { mapSalesError } from "@/features/sales/application/sales-action-errors";
import {
  SalesError,
  type SaleInput,
  type SalePreview,
  type SalesService,
} from "@/features/sales/application/sales-service";
import { calculateSale } from "@/features/sales/domain/sale-calculation";
import {
  saleLineFrom,
  type SaleDraft,
} from "@/features/sales/domain/sale-draft";
import {
  toVoiceCommand,
  voiceInterpretationSchema,
  type VoiceCommand,
  type VoiceItem,
} from "@/features/voice/domain/voice-command";
import {
  MAX_TRANSCRIPT_LENGTH,
  VOICE_PROMPT_VERSION,
  type VoiceCommandStatus,
  type VoiceTranscriptSource,
} from "@/features/voice/domain/voice-constants";
import { formatIls } from "@/shared/lib/format-currency";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";
import { formatAgorotAsIlsInput } from "@/shared/lib/parse-ils";
import { todayInStoreZone } from "@/shared/lib/store-time";
import type { VoiceInterpreter } from "@/server/ai/voice-interpreter";
import * as schema from "@/server/db/schema";

export interface ClarifyOption {
  label: string;
  value: string;
}

export type VoiceOutcome =
  | {
      kind: "clarify";
      commandId: string;
      field: string;
      question: string;
      options: ClarifyOption[];
      allowText: boolean;
    }
  | {
      kind: "sale";
      commandId: string;
      payload: SaleInput;
      preview: SalePreview;
      draft: SaleDraft;
    }
  | {
      kind: "payment";
      commandId: string;
      customerId: string;
      customerName: string;
      amountAgorot: number;
      balanceBeforeAgorot: number;
      balanceAfterAgorot: number;
    }
  | { kind: "purchase"; commandId: string; draft: PurchaseDraft }
  | {
      kind: "adjust";
      commandId: string;
      name: string;
      reasonLabel: string;
      quantityMilli: number;
      onHandMilli: number;
      onHandAfterMilli: number;
    }
  | { kind: "answer"; commandId: string; text: string; href: string | null }
  | { kind: "failed"; message: string };

type Choices = Record<string, string>;
interface StoredInterpretation {
  command: VoiceCommand;
  choices: Choices;
}

const NEW_CUSTOMER = "__new__";
const OWNER_ONLY = "هذه المعلومة متاحة للمالك فقط.";
const adjustmentLabels = {
  damaged: "تالف",
  expired: "منتهي الصلاحية",
  correction: "تصحيح جرد",
} as const;

export class VoiceService {
  constructor(
    private readonly database: Database,
    private readonly interpreter: () => VoiceInterpreter,
    private readonly inventory: InventoryService,
    private readonly sales: SalesService,
    private readonly customers: CustomerService,
    private readonly suppliers: SupplierService,
    private readonly reports: ReportService,
  ) {}

  async interpret(
    actor: AdminActor,
    input: { transcript: string; source: VoiceTranscriptSource },
  ): Promise<VoiceOutcome> {
    assertPermission(actor, "sales.record");
    const transcript = input.transcript.replace(/\s+/g, " ").trim();
    if (transcript.length < 2 || transcript.length > MAX_TRANSCRIPT_LENGTH) {
      return { kind: "failed", message: "قولي أو اكتبي العملية بجملة قصيرة." };
    }

    const interpreter = this.interpreter();
    let command: VoiceCommand;
    try {
      // The model output is untrusted until it passes the schema.
      const parsed = voiceInterpretationSchema.safeParse(
        await interpreter.interpret(transcript),
      );
      if (!parsed.success) throw new Error("INVALID_INTERPRETATION");
      command = toVoiceCommand(parsed.data);
    } catch {
      await this.database.insert(schema.voiceCommands).values({
        transcript,
        transcriptSource: input.source,
        aiModel: interpreter.model,
        promptVersion: VOICE_PROMPT_VERSION,
        status: "failed",
        createdBy: actor.id,
      });
      return {
        kind: "failed",
        message: "تعذّر فهم العملية الآن. أعيدي المحاولة أو أدخليها يدوياً.",
      };
    }

    const [row] = await this.database
      .insert(schema.voiceCommands)
      .values({
        transcript,
        transcriptSource: input.source,
        intent: command.intent,
        interpretation: { command, choices: {} },
        aiModel: interpreter.model,
        promptVersion: VOICE_PROMPT_VERSION,
        status: "review",
        createdBy: actor.id,
      })
      .returning({ id: schema.voiceCommands.id });
    return this.resolveAndStore(actor, row!.id, { command, choices: {} });
  }

  async answerClarification(
    actor: AdminActor,
    input: { commandId: string; field: string; value: string },
  ): Promise<VoiceOutcome> {
    const stored = await this.load(actor, input.commandId);
    if (!stored || stored.status !== "needs_clarification") {
      return { kind: "failed", message: "هذه العملية لم تعد متاحة." };
    }
    const value = input.value.trim().slice(0, 160);
    if (!value || !/^[a-zA-Z:]{1,30}\d{0,2}$/.test(input.field)) {
      return { kind: "failed", message: "اختاري إجابة." };
    }
    const interpretation: StoredInterpretation = {
      command: stored.interpretation.command,
      choices: { ...stored.interpretation.choices, [input.field]: value },
    };
    return this.resolveAndStore(actor, input.commandId, interpretation);
  }

  async confirmPayment(
    actor: AdminActor,
    commandId: string,
  ): Promise<VoiceOutcome> {
    const stored = await this.load(actor, commandId);
    const command = stored?.interpretation.command;
    const customerId = stored?.interpretation.choices.customer;
    if (
      !stored ||
      stored.status !== "review" ||
      command?.intent !== "record_payment" ||
      !customerId
    ) {
      return { kind: "failed", message: "هذه العملية لم تعد متاحة." };
    }
    try {
      // The command id is the idempotency key, so a double tap records one payment.
      const result = await this.sales.recordPayment(actor, {
        customerId,
        amountAgorot: command.amountAgorot,
        idempotencyKey: commandId,
      });
      await this.finish(commandId, "confirmed", "customer", customerId);
      return {
        kind: "answer",
        commandId,
        text: `تم تسجيل الدفعة. الرصيد الآن ${formatIls(result.balanceAgorot)}.`,
        href: `/admin/customers/${customerId}`,
      };
    } catch (error) {
      return { kind: "failed", message: mapSalesError(error) };
    }
  }

  async confirmAdjustment(
    actor: AdminActor,
    commandId: string,
  ): Promise<VoiceOutcome> {
    const stored = await this.load(actor, commandId);
    const command = stored?.interpretation.command;
    const variantId = stored?.interpretation.choices["item:0"];
    if (
      !stored ||
      stored.status !== "review" ||
      command?.intent !== "adjust_stock" ||
      !variantId
    ) {
      return { kind: "failed", message: "هذه العملية لم تعد متاحة." };
    }
    try {
      const result = await this.inventory.adjust(actor, {
        idempotencyKey: commandId,
        variantId,
        reason: command.reason,
        quantityMilli: command.item.quantityMilli,
      });
      await this.finish(commandId, "confirmed", "inventory_item", variantId);
      return {
        kind: "answer",
        commandId,
        text: `تم تعديل المخزون. الكمية الآن ${formatQuantity(result.onHandMilli)}.`,
        href: `/admin/inventory/stock/${variantId}`,
      };
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return { kind: "failed", message: "تعديل المخزون للمالك فقط." };
      }
      return {
        kind: "failed",
        message:
          error instanceof InventoryError && error.code === "insufficient_stock"
            ? "الكمية المتوفرة لا تكفي لهذا التعديل."
            : "تعذّر تعديل المخزون.",
      };
    }
  }

  async markConfirmed(
    actor: AdminActor,
    input: {
      commandId: string;
      entityType: "customer_invoice" | "purchase_invoice";
      entityId: string;
      edited: boolean;
    },
  ): Promise<void> {
    const stored = await this.load(actor, input.commandId);
    if (!stored || !z.uuid().safeParse(input.entityId).success) return;
    await this.finish(
      input.commandId,
      "confirmed",
      input.entityType,
      input.entityId,
      { edited: input.edited },
    );
  }

  async cancel(actor: AdminActor, commandId: string): Promise<void> {
    const stored = await this.load(actor, commandId);
    if (!stored || stored.status === "confirmed") return;
    await this.finish(commandId, "cancelled", null, null);
  }

  private async resolveAndStore(
    actor: AdminActor,
    commandId: string,
    interpretation: StoredInterpretation,
  ): Promise<VoiceOutcome> {
    let outcome: VoiceOutcome;
    try {
      outcome = await this.resolve(actor, commandId, interpretation);
    } catch (error) {
      outcome = {
        kind: "failed",
        message:
          error instanceof AuthorizationError
            ? "ليست لديك صلاحية لهذه العملية."
            : error instanceof SalesError
              ? mapSalesError(error)
              : "تعذّر تجهيز العملية. أدخليها يدوياً.",
      };
    }
    const status: VoiceCommandStatus =
      outcome.kind === "clarify"
        ? "needs_clarification"
        : outcome.kind === "answer"
          ? "answered"
          : outcome.kind === "failed"
            ? "failed"
            : "review";
    await this.database
      .update(schema.voiceCommands)
      .set({
        status,
        interpretation: interpretation as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.voiceCommands.id, commandId));
    return outcome;
  }

  private async resolve(
    actor: AdminActor,
    commandId: string,
    interpretation: StoredInterpretation,
  ): Promise<VoiceOutcome> {
    const { command, choices } = interpretation;
    switch (command.intent) {
      case "unknown":
        return { kind: "failed", message: command.question };
      case "create_sale":
        return this.resolveSale(actor, commandId, command, choices);
      case "record_payment":
        return this.resolvePayment(actor, commandId, command, choices);
      case "record_purchase":
        return this.resolvePurchase(actor, commandId, command, choices);
      case "adjust_stock":
        return this.resolveAdjustment(actor, commandId, command, choices);
      case "query_report":
        return this.answerReport(actor, commandId, command);
      case "query_customer_balance":
        return this.answerBalance(actor, commandId, command, choices);
    }
  }

  // Returns the chosen variant for every spoken item, or the one question needed to get there.
  private async matchItems(
    actor: AdminActor,
    commandId: string,
    items: VoiceItem[],
    choices: Choices,
  ): Promise<
    { ok: true; stock: StockListItem[] } | { ok: false; outcome: VoiceOutcome }
  > {
    const catalog = await this.inventory.listStock(actor);
    const byId = new Map(catalog.map((item) => [item.variantId, item]));
    const matched: StockListItem[] = [];
    for (const [index, item] of items.entries()) {
      const field = `item:${index}`;
      const chosen = choices[field] ? byId.get(choices[field]!) : undefined;
      if (chosen) {
        matched.push(chosen);
        continue;
      }
      const match = matchLine(
        { name: item.name },
        catalog.map((entry) => ({
          variantId: entry.variantId,
          productName: entry.name,
          variantLabel: entry.variantLabel,
          sku: entry.sku,
          barcode: entry.barcode,
        })),
        new Map(),
      );
      if (match.status === "matched" && match.variantId) {
        choices[field] = match.variantId;
        matched.push(byId.get(match.variantId)!);
        continue;
      }
      // Partial-name lookups cover spoken short names such as "كلور".
      const needle = normalizeArabicText(item.name);
      const contains = catalog
        .filter((entry) => normalizeArabicText(entry.name).includes(needle))
        .slice(0, 4)
        .map((entry) => ({ variantId: entry.variantId }));
      const candidates = [
        ...new Set([
          ...match.candidates.map((candidate) => candidate.variantId),
          ...contains.map((candidate) => candidate.variantId),
        ]),
      ].slice(0, 4);
      if (!candidates.length) {
        return {
          ok: false,
          outcome: {
            kind: "failed",
            message: `لم أجد منتجاً باسم «${item.name}». أدخلي العملية يدوياً أو أضيفي المنتج أولاً.`,
          },
        };
      }
      return {
        ok: false,
        outcome: {
          kind: "clarify",
          commandId,
          field,
          question: `أي منتج تقصدين بـ «${item.name}»؟`,
          options: candidates.map((variantId) => {
            const entry = byId.get(variantId)!;
            return {
              value: variantId,
              label: `${entry.name}${entry.variantLabel ? ` — ${entry.variantLabel}` : ""} · ${formatIls(entry.salePriceAgorot)}`,
            };
          }),
          allowText: false,
        },
      };
    }
    return { ok: true, stock: matched };
  }

  private async matchCustomer(
    actor: AdminActor,
    commandId: string,
    name: string,
    choices: Choices,
    allowNew: boolean,
  ): Promise<
    | { ok: true; customer: { id: string; name: string } | null }
    | { ok: false; outcome: VoiceOutcome }
  > {
    if (choices.customer === NEW_CUSTOMER) return { ok: true, customer: null };
    const candidates = await this.customers.findByName(actor, name);
    const chosen = candidates.find((item) => item.id === choices.customer);
    if (chosen) return { ok: true, customer: chosen };
    const exact = candidates.filter((item) => item.exact);
    if (exact.length === 1) {
      choices.customer = exact[0]!.id;
      return { ok: true, customer: exact[0]! };
    }
    if (!candidates.length) {
      if (allowNew) return { ok: true, customer: null };
      return {
        ok: false,
        outcome: {
          kind: "failed",
          message: `لا يوجد زبون باسم «${name}».`,
        },
      };
    }
    return {
      ok: false,
      outcome: {
        kind: "clarify",
        commandId,
        field: "customer",
        question: `أي زبون تقصدين بـ «${name}»؟`,
        options: [
          ...candidates.map((item) => ({ value: item.id, label: item.name })),
          ...(allowNew
            ? [{ value: NEW_CUSTOMER, label: `زبون جديد باسم ${name}` }]
            : []),
        ],
        allowText: false,
      },
    };
  }

  private async resolveSale(
    actor: AdminActor,
    commandId: string,
    command: Extract<VoiceCommand, { intent: "create_sale" }>,
    choices: Choices,
  ): Promise<VoiceOutcome> {
    const items = await this.matchItems(
      actor,
      commandId,
      command.items,
      choices,
    );
    if (!items.ok) return items.outcome;

    const customerName = choices.customerName ?? command.customerName;
    if (!customerName && command.payment !== "full") {
      return {
        kind: "clarify",
        commandId,
        field: "customerName",
        question: "على حساب مَن أسجّل هذا البيع؟",
        options: [],
        allowText: true,
      };
    }
    let customer: { id: string; name: string } | null = null;
    if (customerName) {
      const resolved = await this.matchCustomer(
        actor,
        commandId,
        customerName,
        choices,
        true,
      );
      if (!resolved.ok) return resolved.outcome;
      customer = resolved.customer;
    }

    const merged = new Map<string, SaleInput["lines"][number]>();
    command.items.forEach((item, index) => {
      const stock = items.stock[index]!;
      const existing = merged.get(stock.variantId);
      merged.set(stock.variantId, {
        variantId: stock.variantId,
        quantityMilli: (existing?.quantityMilli ?? 0) + item.quantityMilli,
        unitPriceAgorot: item.unitPriceAgorot ?? stock.salePriceAgorot,
      });
    });
    const lines = [...merged.values()];
    const hasCustomer = Boolean(customerName);
    const total = calculateSale({
      lines,
      discountAgorot: 0,
      paidAgorot: 0,
      hasCustomer: true,
    }).totalAgorot;
    const paidAgorot =
      command.payment === "full"
        ? total
        : command.payment === "partial"
          ? (command.paidAgorot ?? 0)
          : 0;

    const payload: SaleInput = {
      idempotencyKey: commandId,
      customerId: customer?.id,
      customerName: customer ? undefined : (customerName ?? undefined),
      source: "voice",
      lines,
      discountAgorot: 0,
      paidAgorot,
    };
    const preview = await this.sales.preview(actor, payload);
    const draft: SaleDraft = {
      customerMode: customer ? "existing" : hasCustomer ? "new" : "cash",
      customerId: customer?.id ?? "",
      newCustomerName: customer ? "" : (customerName ?? ""),
      lines: lines.map((line) =>
        saleLineFrom({
          ...line,
          spokenText: command.items.find(
            (_, index) => items.stock[index]!.variantId === line.variantId,
          )?.name,
        }),
      ),
      discount: "",
      payment:
        command.payment === "full"
          ? "paid"
          : command.payment === "partial"
            ? "partial"
            : "unpaid",
      paid:
        command.payment === "partial" ? formatAgorotAsIlsInput(paidAgorot) : "",
      note: "",
    };
    return { kind: "sale", commandId, payload, preview, draft };
  }

  private async resolvePayment(
    actor: AdminActor,
    commandId: string,
    command: Extract<VoiceCommand, { intent: "record_payment" }>,
    choices: Choices,
  ): Promise<VoiceOutcome> {
    assertPermission(actor, "payments.record");
    const resolved = await this.matchCustomer(
      actor,
      commandId,
      command.customerName,
      choices,
      false,
    );
    if (!resolved.ok) return resolved.outcome;
    const customer = resolved.customer!;
    const balance = await this.sales.customerBalance(
      this.database,
      customer.id,
    );
    if (command.amountAgorot > balance) {
      return {
        kind: "failed",
        message: `المبلغ أكبر من رصيد ${customer.name} (${formatIls(balance)}).`,
      };
    }
    return {
      kind: "payment",
      commandId,
      customerId: customer.id,
      customerName: customer.name,
      amountAgorot: command.amountAgorot,
      balanceBeforeAgorot: balance,
      balanceAfterAgorot: balance - command.amountAgorot,
    };
  }

  private async resolvePurchase(
    actor: AdminActor,
    commandId: string,
    command: Extract<VoiceCommand, { intent: "record_purchase" }>,
    choices: Choices,
  ): Promise<VoiceOutcome> {
    assertPermission(actor, "purchase.record");
    const items = await this.matchItems(
      actor,
      commandId,
      command.items,
      choices,
    );
    if (!items.ok) return items.outcome;
    const suppliers = await this.suppliers.list(actor);
    const supplier = command.supplierName
      ? suppliers.find(
          (item) =>
            normalizeArabicText(item.nameAr) ===
            normalizeArabicText(command.supplierName!),
        )
      : undefined;
    return {
      kind: "purchase",
      commandId,
      draft: {
        supplierId: supplier?.id ?? (command.supplierName ? NEW_SUPPLIER : ""),
        newSupplierName: supplier ? "" : (command.supplierName ?? ""),
        reference: "",
        invoiceDate: todayInStoreZone(),
        lines: command.items.map((item, index) => ({
          key: `voice-${index}`,
          variantId: items.stock[index]!.variantId,
          quantity: formatQuantity(item.quantityMilli),
          unit: item.unit ?? items.stock[index]!.unit,
          packQuantity: "1",
          unitCost:
            item.unitPriceAgorot === null
              ? ""
              : formatAgorotAsIlsInput(item.unitPriceAgorot),
          lineDiscount: "",
          sourceText: item.name,
        })),
        discount: "",
        tax: "",
        printedTotal: "",
        payment: "paid",
        paid: "",
        notes: "",
      },
    };
  }

  private async resolveAdjustment(
    actor: AdminActor,
    commandId: string,
    command: Extract<VoiceCommand, { intent: "adjust_stock" }>,
    choices: Choices,
  ): Promise<VoiceOutcome> {
    if (!can(actor, "stock.adjust")) {
      return { kind: "failed", message: "تعديل المخزون للمالك فقط." };
    }
    const items = await this.matchItems(
      actor,
      commandId,
      [command.item],
      choices,
    );
    if (!items.ok) return items.outcome;
    const stock = items.stock[0]!;
    if (!stock.tracked) {
      return {
        kind: "failed",
        message: `«${stock.name}» غير متتبَّع في المخزون بعد.`,
      };
    }
    const after =
      command.reason === "correction"
        ? command.item.quantityMilli
        : stock.onHandMilli - command.item.quantityMilli;
    return {
      kind: "adjust",
      commandId,
      name: stock.name,
      reasonLabel: adjustmentLabels[command.reason],
      quantityMilli: command.item.quantityMilli,
      onHandMilli: stock.onHandMilli,
      onHandAfterMilli: after,
    };
  }

  // Answers are assembled from database figures with fixed wording; the model never computes them.
  private async answerReport(
    actor: AdminActor,
    commandId: string,
    command: Extract<VoiceCommand, { intent: "query_report" }>,
  ): Promise<VoiceOutcome> {
    const answer = (text: string, href: string | null): VoiceOutcome => ({
      kind: "answer",
      commandId,
      text,
      href,
    });
    if (command.metric === "low_stock") {
      const low = await this.inventory.listStock(actor, {
        filter: "attention",
      });
      return answer(
        low.length
          ? `يحتاج إعادة طلب: ${low
              .slice(0, 8)
              .map(
                (item) =>
                  `${item.name} (${formatQuantity(item.availableMilli)} ${stockUnitLabels[item.unit]})`,
              )
              .join("، ")}.`
          : "لا توجد نواقص في الأصناف المتتبَّعة.",
        "/admin/inventory/stock?filter=attention",
      );
    }
    if (!can(actor, "reports.view")) return answer(OWNER_ONLY, null);

    const period = resolvePeriod(command.period, todayInStoreZone());
    const report = await this.reports.getReport(actor, period);
    const label = reportPresetLabels[command.period];
    const href = `/admin/reports?preset=${command.period}`;
    const { metrics } = report;
    if (command.metric === "top_product") {
      const top = report.byQuantity[0];
      return answer(
        top
          ? `أكثر منتج انباع (${label}): ${top.name} — ${formatQuantity(top.quantityMilli)} بقيمة ${formatIls(top.netSalesAgorot)}.`
          : `لا توجد مبيعات مسجّلة (${label}).`,
        href,
      );
    }
    const incomplete = metrics.costComplete
      ? ""
      : ` الربح غير مكتمل: مبيعات بقيمة ${formatIls(metrics.uncostedSalesAgorot)} بلا تكلفة مسجّلة.`;
    return answer(
      command.metric === "profit"
        ? `الربح الإجمالي (${label}): ${formatIls(metrics.grossProfitAgorot)} من صافي مبيعات ${formatIls(metrics.netSalesAgorot)}.${incomplete}`
        : `صافي المبيعات (${label}): ${formatIls(metrics.netSalesAgorot)} في ${metrics.orderCount} عملية.`,
      href,
    );
  }

  private async answerBalance(
    actor: AdminActor,
    commandId: string,
    command: Extract<VoiceCommand, { intent: "query_customer_balance" }>,
    choices: Choices,
  ): Promise<VoiceOutcome> {
    assertPermission(actor, "customers.view");
    if (!command.customerName) {
      const debtors = await this.reports.listDebtors(actor);
      return {
        kind: "answer",
        commandId,
        text: debtors.length
          ? `عليهم ديون: ${debtors
              .slice(0, 10)
              .map((item) => `${item.name} ${formatIls(item.balanceAgorot)}`)
              .join("، ")}.`
          : "لا أحد عليه ديون.",
        href: "/admin/customers?filter=owing",
      };
    }
    const resolved = await this.matchCustomer(
      actor,
      commandId,
      command.customerName,
      choices,
      false,
    );
    if (!resolved.ok) return resolved.outcome;
    const customer = resolved.customer!;
    const balance = await this.sales.customerBalance(
      this.database,
      customer.id,
    );
    return {
      kind: "answer",
      commandId,
      text:
        balance > 0
          ? `على ${customer.name} ${formatIls(balance)}.`
          : `لا ديون على ${customer.name}.`,
      href: `/admin/customers/${customer.id}`,
    };
  }

  private async load(actor: AdminActor, commandId: string) {
    assertPermission(actor, "sales.record");
    if (!z.uuid().safeParse(commandId).success) return null;
    // Commands are private to the person who spoke them.
    const [row] = await this.database
      .select()
      .from(schema.voiceCommands)
      .where(
        and(
          eq(schema.voiceCommands.id, commandId),
          eq(schema.voiceCommands.createdBy, actor.id),
        ),
      )
      .limit(1);
    if (!row?.interpretation) return null;
    return {
      status: row.status,
      interpretation: row.interpretation as unknown as StoredInterpretation,
    };
  }

  private async finish(
    commandId: string,
    status: VoiceCommandStatus,
    entityType: string | null,
    entityId: string | null,
    corrections?: Record<string, unknown>,
  ) {
    await this.database
      .update(schema.voiceCommands)
      .set({
        status,
        resultEntityType: entityType,
        resultEntityId: entityId,
        corrections: corrections ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.voiceCommands.id, commandId));
  }
}
