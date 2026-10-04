import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, lt, sql } from "drizzle-orm";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertOwnerActor } from "@/features/admin/domain/admin-actor";
import { postStockAdjustment } from "@/features/inventory/application/inventory-service";
import {
  getDefaultLocationId,
  type Database,
} from "@/features/inventory/application/stock-ledger";
import {
  OrderService,
  QA_ORDER_PHONE,
} from "@/features/orders/application/order-service";
import type { CheckoutRequest } from "@/features/orders/domain/checkout-request";
import { ACTIVE_SERVICE_AREA_CODE } from "@/features/delivery/delivery-policy";
import * as schema from "@/server/db/schema";

import { AdminOrderService } from "./admin-order-service";

export const QA_PROBE_PRODUCT_ID = "qa-stock-probe";
export const QA_PROBE_VARIANT_ID = "qa-stock-probe--default";
const TOKEN_TTL_MS = 60_000;
const STUCK_RUN_MS = 120_000;
const RUNS_PER_HOUR = 10;
const UNIT_MILLI = 1_000;

export type QaSimulationErrorCode =
  | "disabled"
  | "forbidden"
  | "not_qa_owned"
  | "rate_limited"
  | "busy"
  | "invalid_token";

export class QaSimulationError extends Error {
  constructor(readonly code: QaSimulationErrorCode) {
    super(code);
    this.name = "QaSimulationError";
  }
}

export interface QaSimulationCheckpoints {
  initialAvailableMilli: number;
  initialOnHandMilli: number;
  seededMilli: number;
  availableAfterOrderMilli: number;
  availableAfterCancelMilli: number;
  onHandAfterDeliveryMilli: number;
  exactVariant: boolean;
  exactPrice: boolean;
  duplicateOrderReplayed: boolean;
  repeatedCancelRejected: boolean;
}

export interface QaSimulationResult {
  passed: boolean;
  checkpoints: QaSimulationCheckpoints | null;
  failedStep: string | null;
  rollbackVerified: boolean;
  durationMs: number;
  supportReference: string;
}

// Thrown on purpose to end the business transaction; drizzle rolls everything back.
class RollbackSignal extends Error {
  constructor(readonly checkpoints: QaSimulationCheckpoints) {
    super("qa_simulation_rollback");
  }
}

class StepFailure extends Error {
  constructor(readonly step: string) {
    super(step);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Owner-only, flag-gated proof of the real order → reserve → cancel → restock and
// fulfil paths on a dedicated QA variant. Every business write is rolled back.
export class QaStockSimulationService {
  constructor(
    private readonly database: Database,
    private readonly options: {
      enabled: () => boolean;
      // Test seam: fail after the cancellation to prove nothing survives a mid-run failure.
      faultAfterCancel?: boolean;
    },
  ) {}

  private guard(actor: AdminActor) {
    if (!this.options.enabled()) throw new QaSimulationError("disabled");
    try {
      assertOwnerActor(actor);
    } catch {
      throw new QaSimulationError("forbidden");
    }
  }

  async probes(actor: AdminActor) {
    this.guard(actor);
    return this.database
      .select({
        variantId: schema.productVariants.domainId,
        label: sql<string>`${schema.products.nameAr} || ' — ' || ${schema.productVariants.labelAr}`,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(
        and(
          eq(schema.productVariants.qaOwned, true),
          sql`${schema.productVariants.archivedAt} is null`,
          sql`${schema.products.publication} <> 'published'`,
        ),
      );
  }

  // The probe is a hidden product that customers never see and checkout refuses.
  async ensureProbe(actor: AdminActor): Promise<void> {
    this.guard(actor);
    await this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.domainId, QA_PROBE_PRODUCT_ID));
      if (existing) return;
      const [category] = await transaction
        .select({ code: schema.productCategories.code })
        .from(schema.productCategories)
        .where(sql`${schema.productCategories.archivedAt} is null`)
        .orderBy(schema.productCategories.sortOrder)
        .limit(1);
      if (!category) throw new QaSimulationError("not_qa_owned");
      const [product] = await transaction
        .insert(schema.products)
        .values({
          domainId: QA_PROBE_PRODUCT_ID,
          slug: QA_PROBE_PRODUCT_ID,
          nameAr: "منتج فحص المخزون (QA)",
          priceAgorot: 100,
          sortOrder: 9_999,
          categoryId: category.code,
          availability: "available",
          publication: "hidden",
          imageKind: "placeholder",
          placeholderVariant: "general-cleaner",
          detailsStatus: "placeholder",
        })
        .returning({ id: schema.products.id });
      await transaction.insert(schema.productVariants).values({
        productId: product!.id,
        domainId: QA_PROBE_VARIANT_ID,
        labelAr: "الأساسي",
        attributes: {},
        priceAgorot: 100,
        availability: "available",
        imageKind: "placeholder",
        placeholderVariant: "general-cleaner",
        sortOrder: 0,
        isDefault: true,
        qaOwned: true,
      });
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "qa_probe_create",
        entityType: "product",
        entityId: QA_PROBE_PRODUCT_ID,
        beforeState: null,
        afterState: { qaOwned: true, publication: "hidden" },
      });
    });
  }

  private async qaVariant(variantDomainId: string) {
    const [row] = await this.database
      .select({
        variant: schema.productVariants,
        publication: schema.products.publication,
        productDomainId: schema.products.domainId,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId),
      )
      .where(eq(schema.productVariants.domainId, variantDomainId))
      .limit(1);
    // Fail closed: only an explicitly QA-owned, unpublished variant may be simulated.
    if (
      !row ||
      !row.variant.qaOwned ||
      row.variant.archivedAt ||
      row.publication === "published"
    ) {
      throw new QaSimulationError("not_qa_owned");
    }
    return row;
  }

  async issue(
    actor: AdminActor,
    variantDomainId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    this.guard(actor);
    const { variant } = await this.qaVariant(variantDomainId);
    const now = new Date();
    await this.database
      .update(schema.qaSimulationRuns)
      .set({ status: "failed", finishedAt: now })
      .where(
        and(
          eq(schema.qaSimulationRuns.status, "running"),
          lt(
            schema.qaSimulationRuns.startedAt,
            new Date(now.getTime() - STUCK_RUN_MS),
          ),
        ),
      );
    const [recent] = await this.database
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.qaSimulationRuns)
      .where(
        and(
          eq(schema.qaSimulationRuns.adminUserId, actor.id),
          gt(
            schema.qaSimulationRuns.createdAt,
            new Date(now.getTime() - 3_600_000),
          ),
        ),
      );
    if ((recent?.total ?? 0) >= RUNS_PER_HOUR) {
      throw new QaSimulationError("rate_limited");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
    await this.database.insert(schema.qaSimulationRuns).values({
      adminUserId: actor.id,
      variantId: variant.id,
      tokenHash: hashToken(token),
      supportReference: randomBytes(4).toString("hex").toUpperCase(),
      expiresAt,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async run(actor: AdminActor, token: string): Promise<QaSimulationResult> {
    this.guard(actor);
    if (typeof token !== "string" || token.length < 20 || token.length > 100) {
      throw new QaSimulationError("invalid_token");
    }
    const started = Date.now();
    const tokenHash = hashToken(token);
    let claimed;
    try {
      // Single use: only an unexpired, still-issued token of this owner can start a run.
      [claimed] = await this.database
        .update(schema.qaSimulationRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(
          and(
            eq(schema.qaSimulationRuns.tokenHash, tokenHash),
            eq(schema.qaSimulationRuns.adminUserId, actor.id),
            eq(schema.qaSimulationRuns.status, "issued"),
            gt(schema.qaSimulationRuns.expiresAt, new Date()),
          ),
        )
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        await this.database
          .update(schema.qaSimulationRuns)
          .set({ status: "failed", finishedAt: new Date() })
          .where(eq(schema.qaSimulationRuns.tokenHash, tokenHash));
        throw new QaSimulationError("busy");
      }
      throw error;
    }
    if (!claimed) throw new QaSimulationError("invalid_token");

    const [variantRow] = await this.database
      .select({ domainId: schema.productVariants.domainId })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, claimed.variantId));
    const probe = await this.qaVariant(variantRow!.domainId);
    const before = await this.fingerprint(probe.variant.id);

    let checkpoints: QaSimulationCheckpoints | null = null;
    let failedStep: string | null = null;
    try {
      await this.database.transaction(async (transaction) => {
        throw new RollbackSignal(
          await this.simulate(transaction as unknown as Database, actor, probe),
        );
      });
      failedStep = "rollback_not_reached";
    } catch (error) {
      if (error instanceof RollbackSignal) checkpoints = error.checkpoints;
      else failedStep = error instanceof StepFailure ? error.step : "error";
    }
    const after = await this.fingerprint(probe.variant.id);
    const rollbackVerified = before === after;
    const passed = Boolean(checkpoints) && !failedStep && rollbackVerified;
    const durationMs = Date.now() - started;

    await this.database.transaction(async (transaction) => {
      await transaction
        .update(schema.qaSimulationRuns)
        .set({
          status: passed ? "passed" : "failed",
          finishedAt: new Date(),
          durationMs,
        })
        .where(eq(schema.qaSimulationRuns.id, claimed.id));
      // Minimal audit: who, which QA variant, outcome, duration, reference. No prices or contact data.
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "qa_stock_simulation",
        entityType: "product_variant",
        entityId: probe.variant.domainId,
        beforeState: null,
        afterState: {
          passed,
          durationMs,
          supportReference: claimed.supportReference,
        },
      });
    });
    return {
      passed,
      checkpoints: passed ? checkpoints : null,
      failedStep: passed ? null : (failedStep ?? "rollback_not_verified"),
      rollbackVerified,
      durationMs,
      supportReference: claimed.supportReference,
    };
  }

  private async stock(transaction: Database, variantUuid: string) {
    const locationId = await getDefaultLocationId(transaction);
    const [item] = await transaction
      .select({
        onHandMilli: schema.inventoryItems.onHandMilli,
        reservedMilli: schema.inventoryItems.reservedMilli,
      })
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.variantId, variantUuid),
          eq(schema.inventoryItems.locationId, locationId),
        ),
      );
    const onHandMilli = item?.onHandMilli ?? 0;
    const reservedMilli = item?.reservedMilli ?? 0;
    return {
      tracked: Boolean(item),
      onHandMilli,
      availableMilli: onHandMilli - reservedMilli,
    };
  }

  // Runs the authoritative services on the outer transaction; their own transactions become savepoints.
  private async simulate(
    transaction: Database,
    actor: AdminActor,
    probe: Awaited<ReturnType<QaStockSimulationService["qaVariant"]>>,
  ): Promise<QaSimulationCheckpoints> {
    const step = (name: string, ok: boolean) => {
      if (!ok) throw new StepFailure(name);
    };
    await transaction.execute(
      sql`select set_config('app.qa_stock_simulation', 'on', true)`,
    );
    const orders = new OrderService(transaction);
    const adminOrders = new AdminOrderService(transaction, {
      qaStockSimulation: true,
    });
    const variant = probe.variant;

    const initial = await this.stock(transaction, variant.id);
    // Two orders need two sellable units; they exist only inside this transaction.
    let seededMilli = 0;
    if (!initial.tracked || initial.availableMilli < 2 * UNIT_MILLI) {
      seededMilli = 2 * UNIT_MILLI;
      // opening_balance adds a delta through the real stock ledger.
      await postStockAdjustment(transaction, actor, {
        idempotencyKey: randomUUID(),
        variantId: variant.domainId,
        reason: "opening_balance",
        quantityMilli: seededMilli,
        unitCostAgorot: 0,
        note: "QA simulation (rolled back)",
      });
    }
    const seeded = await this.stock(transaction, variant.id);
    step("seed_stock", seeded.availableMilli >= 2 * UNIT_MILLI);

    const request = (): CheckoutRequest => ({
      idempotencyKey: randomUUID(),
      customerName: "محاكاة مخزون QA",
      whatsappCountryCode: "970",
      whatsappNationalNumber: "",
      whatsappPhoneE164: QA_ORDER_PHONE,
      serviceAreaCode: ACTIVE_SERVICE_AREA_CODE,
      deliveryAddress: "محاكاة داخلية — لا توصيل",
      customerNote: undefined,
      paymentMethod: "cash_on_delivery",
      honeypot: "",
      items: [
        {
          productId: probe.productDomainId,
          variantId: variant.domainId,
          quantity: 1,
        },
      ],
      normalizedPhone: QA_ORDER_PHONE,
      address: "محاكاة داخلية — لا توصيل",
      landmark: undefined,
    });
    const place = (input: CheckoutRequest) =>
      orders.create(
        input,
        { customerAccountId: null },
        { test: true, allowQaProbe: true },
      );
    const advance = async (
      reference: string,
      nextStatus:
        | "confirmed"
        | "preparing"
        | "out_for_delivery"
        | "delivered"
        | "cancelled",
    ) => {
      const detail = await adminOrders.getByPublicReference(actor, reference);
      step(`load_${nextStatus}`, Boolean(detail));
      await adminOrders.changeStatus(actor, {
        publicReference: reference,
        nextStatus,
        expectedVersion: detail!.version,
        reason: "QA simulation",
      });
    };

    // 1. Order the exact QA variant through the checkout order service.
    const first = request();
    const order = await place(first);
    const [line] = await transaction
      .select({
        variantDomainId: schema.orderItems.variantDomainId,
        unitPriceAgorot: schema.orderItems.unitPriceAgorot,
        listUnitPriceAgorot: schema.orderItems.listUnitPriceAgorot,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(eq(schema.orders.publicReference, order.publicReference));
    const exactVariant =
      line?.variantDomainId === variant.domainId && line.quantity === 1;
    const exactPrice =
      line?.listUnitPriceAgorot === variant.priceAgorot &&
      line.unitPriceAgorot <= variant.priceAgorot &&
      line.unitPriceAgorot > 0;
    step("exact_variant", exactVariant);
    step("exact_price", exactPrice);

    // 2. Idempotency: the same request returns the same order, nothing new.
    const replay = await place(first);
    const duplicateOrderReplayed =
      replay.publicReference === order.publicReference;
    step("idempotent_order", duplicateOrderReplayed);

    // 3. Confirmation reserves exactly one unit through the order status service.
    await advance(order.publicReference, "confirmed");
    const afterOrder = await this.stock(transaction, variant.id);
    step(
      "stock_reserved",
      afterOrder.availableMilli === seeded.availableMilli - UNIT_MILLI,
    );

    // 4. Cancellation restores it exactly; a second cancellation is refused.
    await advance(order.publicReference, "cancelled");
    const afterCancel = await this.stock(transaction, variant.id);
    step(
      "stock_restored",
      afterCancel.availableMilli === seeded.availableMilli &&
        afterCancel.onHandMilli === seeded.onHandMilli,
    );
    if (this.options.faultAfterCancel) throw new StepFailure("injected_fault");
    let repeatedCancelRejected = false;
    try {
      await advance(order.publicReference, "cancelled");
    } catch {
      repeatedCancelRejected = true;
    }
    step("repeat_cancel_rejected", repeatedCancelRejected);
    const afterRepeat = await this.stock(transaction, variant.id);
    step(
      "stock_unchanged_after_repeat",
      afterRepeat.availableMilli === seeded.availableMilli,
    );

    // 5. Delivery deducts on-hand stock through the fulfilment path.
    const second = await place(request());
    for (const next of [
      "confirmed",
      "preparing",
      "out_for_delivery",
      "delivered",
    ] as const) {
      await advance(second.publicReference, next);
    }
    const afterDelivery = await this.stock(transaction, variant.id);
    step(
      "stock_deducted_on_delivery",
      afterDelivery.onHandMilli === seeded.onHandMilli - UNIT_MILLI,
    );

    return {
      initialAvailableMilli: initial.availableMilli,
      initialOnHandMilli: initial.onHandMilli,
      seededMilli,
      availableAfterOrderMilli: afterOrder.availableMilli,
      availableAfterCancelMilli: afterCancel.availableMilli,
      onHandAfterDeliveryMilli: afterDelivery.onHandMilli,
      exactVariant,
      exactPrice,
      duplicateOrderReplayed,
      repeatedCancelRejected,
    };
  }

  // Everything a run could touch: if this is unchanged afterwards, nothing persisted.
  private async fingerprint(variantUuid: string): Promise<string> {
    const result = await this.database.execute<{ value: string }>(sql`
      select json_build_object(
        'inventory', (select coalesce(json_agg(row_to_json(i) order by i.id), '[]'::json)
                        from inventory_items i where i.variant_id = ${variantUuid}),
        'orders', (select count(*) from orders),
        'order_items', (select count(*) from order_items),
        'order_status_history', (select count(*) from order_status_history),
        'customer_order_links', (select count(*) from customer_order_links),
        'stock_reservations', (select count(*) from stock_reservations),
        'stock_movements', (select count(*) from stock_movements),
        'inventory_adjustments', (select count(*) from inventory_adjustments),
        'admin_notifications', (select count(*) from admin_notifications),
        'customer_ledger_entries', (select count(*) from customer_ledger_entries),
        'supplier_ledger_entries', (select count(*) from supplier_ledger_entries),
        'rate_limit_buckets', (select count(*) from rate_limit_buckets)
      )::text as value
    `);
    return result[0]!.value;
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
