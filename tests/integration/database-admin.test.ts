import { count, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminCatalogService } from "@/features/admin/application/admin-catalog-service";
import { AdminDashboardService } from "@/features/admin/application/admin-dashboard-service";
import { AdminDeliveryService } from "@/features/admin/application/admin-delivery-service";
import {
  AdminOrderError,
  AdminOrderService,
} from "@/features/admin/application/admin-order-service";
import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { OwnerService } from "@/features/admin/auth/owner-service";
import { PostgresRateLimiter } from "@/features/admin/auth/postgres-rate-limiter";
import { SessionService } from "@/features/admin/auth/session-service";
import { SESSION_IDLE_MS } from "@/features/admin/auth/session-absolute";
import { LoginService } from "@/features/admin/auth/login-service";
import { LOGIN_FAILURE_MESSAGE } from "@/features/admin/auth/login-policy";
import { createPostgresOrderSubmissionGuard } from "@/features/orders/infrastructure/postgres-order-submission-guard";
import { OrderService } from "@/features/orders/application/order-service";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import {
  adminAuditEvents,
  adminUsers,
  orderStatusHistory,
  orders,
  products,
  serviceAreas,
} from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";
import { parseTestAdminEnv } from "@/test/test-admin";

const { db, client } = testDatabaseConnection;
const ownerService = new OwnerService(db);
const sessionService = new SessionService(db);
const loginService = new LoginService(db, "x".repeat(32));
const limiter = new PostgresRateLimiter(db);
const orderService = new OrderService(db);
const adminOrderService = new AdminOrderService(db);
const adminCatalogService = new AdminCatalogService(db);
const adminDeliveryService = new AdminDeliveryService(db);
const adminDashboardService = new AdminDashboardService(db);
const orderGuard = createPostgresOrderSubmissionGuard(db, "x".repeat(32));

let actor: AdminActor;

function createRequest(
  overrides: Partial<{
    idempotencyKey: string;
    deliveryAddress: string;
    address: string;
    serviceAreaCode: string;
    whatsappCountryCode: "970" | "972";
    whatsappNationalNumber: string;
    items: { productId: string; quantity: number }[];
  }> = {},
) {
  return checkoutRequestSchema.parse({
    idempotencyKey: overrides.idempotencyKey ?? crypto.randomUUID(),
    customerName: "عميل تجريبي",
    whatsappCountryCode: overrides.whatsappCountryCode ?? "970",
    whatsappNationalNumber: overrides.whatsappNationalNumber ?? "0591234567",
    serviceAreaCode: overrides.serviceAreaCode ?? "maythalun",
    deliveryAddress:
      overrides.deliveryAddress ??
      overrides.address ??
      "عنوان محلي مفصل للاختبار",
    paymentMethod: "cash_on_delivery",
    honeypot: "",
    items: overrides.items ?? [{ productId: "general-cleaner", quantity: 2 }],
  });
}

async function createOwnerActor(): Promise<AdminActor> {
  const admin = parseTestAdminEnv({
    TEST_ADMIN_USERNAME: process.env.TEST_ADMIN_USERNAME,
    TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD,
    TEST_ADMIN_DISPLAY_NAME: process.env.TEST_ADMIN_DISPLAY_NAME,
  });
  const created = await ownerService.createTestOwner({
    username: admin.TEST_ADMIN_USERNAME,
    displayName: admin.TEST_ADMIN_DISPLAY_NAME,
    password: admin.TEST_ADMIN_PASSWORD,
    databaseName: "maithalun_test",
  });
  return {
    id: created.id,
    username: created.username,
    displayName: admin.TEST_ADMIN_DISPLAY_NAME,
    role: "owner",
    active: true,
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  actor = await createOwnerActor();
});

beforeEach(async () => {
  await client.unsafe(
    "TRUNCATE TABLE order_status_history, admin_audit_events, admin_sessions, orders CASCADE",
  );
  await db
    .update(products)
    .set({
      availability: "available",
      priceAgorot: 700,
    })
    .where(eq(products.domainId, "general-cleaner"));
  await db.update(serviceAreas).set({ enabled: true, deliveryFeeAgorot: null });
});

describe("admin database operations", () => {
  it("creates an owner and rejects a duplicate normalized username", async () => {
    const [{ ownerCount }] = await db
      .select({ ownerCount: count() })
      .from(adminUsers);
    expect(ownerCount).toBe(1);
    await expect(
      db.insert(adminUsers).values({
        username: actor.username,
        displayName: "آخر",
        passwordHash:
          "v1$scrypt$n=16384,r=8,p=1,dk=32$aaaaaaaaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        role: "owner",
      }),
    ).rejects.toBeDefined();
  });

  it("creates, looks up, rotates, expires, and revokes sessions", async () => {
    const created = await sessionService.create(actor.id);
    await expect(
      sessionService.lookup(created.rawToken),
    ).resolves.toMatchObject({
      username: actor.username,
      active: true,
    });

    const rotated = await sessionService.create(actor.id);
    await sessionService.revokeByToken(created.rawToken);
    await expect(sessionService.lookup(created.rawToken)).resolves.toBeNull();
    await expect(
      sessionService.lookup(rotated.rawToken),
    ).resolves.toMatchObject({
      username: actor.username,
    });

    const idle = await sessionService.create(actor.id);
    await expect(
      sessionService.lookup(
        idle.rawToken,
        new Date(Date.now() + SESSION_IDLE_MS + 1_000),
      ),
    ).resolves.toBeNull();

    const absolute = await sessionService.create(actor.id);
    await expect(
      sessionService.lookup(
        absolute.rawToken,
        new Date(absolute.expiresAt.getTime() + 1_000),
      ),
    ).resolves.toBeNull();

    await sessionService.revokeAllForUser(actor.id);
    await expect(sessionService.lookup(rotated.rawToken)).resolves.toBeNull();
  });

  it("enforces concurrent login and order rate limits", async () => {
    const loginHits = await Promise.all(
      Array.from({ length: 20 }, () =>
        limiter.hit({
          scope: "login-user",
          keyHash: "a".repeat(64),
          limit: 8,
          windowMs: 15 * 60 * 1000,
        }),
      ),
    );
    expect(loginHits.filter((hit) => hit.allowed)).toHaveLength(8);

    const key = crypto.randomUUID();
    const orderHits = await Promise.all(
      Array.from({ length: 10 }, () =>
        orderGuard.check({
          idempotencyKey: key,
          honeypot: "",
          requestSize: 100,
        }),
      ),
    );
    expect(orderHits.filter((hit) => hit.allowed)).toHaveLength(3);
  });

  it("keeps login failures generic", async () => {
    const unknown = await loginService.login({
      username: "missing-user",
      password: "incorrect-password-value",
      honeypot: "",
      requestSize: 40,
      networkKey: null,
      currentToken: null,
    });
    const wrong = await loginService.login({
      username: actor.username,
      password: "incorrect-password-value",
      honeypot: "",
      requestSize: 40,
      networkKey: null,
      currentToken: null,
    });
    expect(unknown).toEqual({ ok: false, message: LOGIN_FAILURE_MESSAGE });
    expect(wrong).toEqual({ ok: false, message: LOGIN_FAILURE_MESSAGE });
  });

  it("rejects unauthorized admin operations", async () => {
    const inactive = { ...actor, active: false };
    await expect(
      adminDashboardService.getSummary(inactive),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(adminCatalogService.list(inactive)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(adminDeliveryService.list(inactive)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      adminOrderService.list(inactive, { page: 1 }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("updates products and service areas with audit events", async () => {
    const { product } = await adminCatalogService.update(actor, {
      domainId: "general-cleaner",
      nameAr: "منظف عام",
      latinName: "Secret",
      priceAgorot: 850,
      categoryId: "home",
      availability: "unavailable",
      sortOrder: 1,
      detailsStatus: "verified",
      placeholderVariant: "general-cleaner",
      description: "وصف معتمد للاختبار",
      unit: "لتر",
    });
    expect(product.priceAgorot).toBe(850);
    expect(product.availability).toBe("unavailable");

    const area = await adminDeliveryService.update(actor, {
      code: "maythalun",
      enabled: true,
      sortOrder: 1,
      deliveryFeeAgorot: 300,
    });
    expect(area.deliveryFeeAgorot).toBe(300);

    const auditRows = await db.select().from(adminAuditEvents);
    expect(auditRows.map((row) => row.actionType).sort()).toEqual([
      "product_update",
      "service_area_update",
    ]);
    expect(JSON.stringify(auditRows)).not.toContain("password");
    expect(JSON.stringify(auditRows)).not.toContain("0591234567");
  });

  it("snapshots delivery fees and keeps existing orders immutable", async () => {
    const before = await orderService.create(createRequest());
    expect(before.deliveryFeeAgorot).toBeNull();
    expect(before.finalTotalAgorot).toBeNull();

    await adminDeliveryService.update(actor, {
      code: "maythalun",
      enabled: true,
      sortOrder: 1,
      deliveryFeeAgorot: 400,
    });

    const after = await orderService.create(createRequest());
    expect(after.deliveryFeeAgorot).toBe(400);
    expect(after.finalTotalAgorot).toBe(1800);

    const [original] = await db
      .select()
      .from(orders)
      .where(eq(orders.publicReference, before.publicReference));
    expect(original.deliveryFeeAgorot).toBeNull();
    expect(original.finalTotalAgorot).toBeNull();
    expect(original.address).toBe("عنوان محلي مفصل للاختبار");
    expect(original.deliveryAddress).toBe("عنوان محلي مفصل للاختبار");
    expect(original.whatsappPhoneE164).toBe("+970591234567");
  });

  it("exposes a WhatsApp contact URL on owner order details only", async () => {
    const created = await orderService.create(createRequest());
    const detail = await adminOrderService.getByPublicReference(
      actor,
      created.publicReference,
    );
    expect(detail?.whatsappPhoneE164).toBe("+970591234567");
    expect(detail?.whatsappContactUrl).toContain("https://wa.me/970591234567");
    expect(detail?.whatsappContactUrl).toContain(created.publicReference);
    expect(detail?.whatsappContactUrl).not.toContain("عنوان");

    await expect(
      adminOrderService.getByPublicReference(
        { ...actor, active: false },
        created.publicReference,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("handles historical orders with null WhatsApp snapshot columns", async () => {
    const created = await orderService.create(createRequest());
    await db
      .update(orders)
      .set({
        customerFullName: null,
        deliveryAddress: null,
        whatsappPhoneE164: null,
      })
      .where(eq(orders.publicReference, created.publicReference));

    const detail = await adminOrderService.getByPublicReference(
      actor,
      created.publicReference,
    );
    expect(detail?.customerName).toBe("عميل تجريبي");
    expect(detail?.address).toBe("عنوان محلي مفصل للاختبار");
    expect(detail?.whatsappPhoneE164).toBe("+970591234567");
    expect(detail?.whatsappContactUrl).toContain("wa.me/970591234567");
  });

  it("changes status with history in the same transaction and rolls back invalid transitions", async () => {
    const created = await orderService.create(createRequest());
    const pending = await adminOrderService.getByPublicReference(
      actor,
      created.publicReference,
    );
    if (!pending) throw new Error("missing order");

    await adminOrderService.changeStatus(actor, {
      publicReference: pending.publicReference,
      nextStatus: "confirmed",
      expectedVersion: pending.version,
    });

    const [historyCount] = await db
      .select({ total: count() })
      .from(orderStatusHistory);
    const [auditCount] = await db
      .select({ total: count() })
      .from(adminAuditEvents)
      .where(eq(adminAuditEvents.actionType, "order_status_change"));
    expect(historyCount.total).toBe(1);
    expect(auditCount.total).toBe(1);

    const confirmed = await adminOrderService.getByPublicReference(
      actor,
      pending.publicReference,
    );
    if (!confirmed) throw new Error("missing confirmed order");
    await expect(
      adminOrderService.changeStatus(actor, {
        publicReference: confirmed.publicReference,
        nextStatus: "delivered",
        expectedVersion: confirmed.version,
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });

    const unchanged = await adminOrderService.getByPublicReference(
      actor,
      pending.publicReference,
    );
    expect(unchanged?.status).toBe("confirmed");
    expect(unchanged?.version).toBe(confirmed.version);
  });

  it("rejects concurrent status transitions with optimistic concurrency", async () => {
    const created = await orderService.create(createRequest());
    const pending = await adminOrderService.getByPublicReference(
      actor,
      created.publicReference,
    );
    if (!pending) throw new Error("missing order");

    const results = await Promise.allSettled([
      adminOrderService.changeStatus(actor, {
        publicReference: pending.publicReference,
        nextStatus: "confirmed",
        expectedVersion: pending.version,
      }),
      adminOrderService.changeStatus(actor, {
        publicReference: pending.publicReference,
        nextStatus: "cancelled",
        expectedVersion: pending.version,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      rejected[0] && rejected[0].status === "rejected"
        ? rejected[0].reason
        : null,
    ).toBeInstanceOf(AdminOrderError);
  });
});
