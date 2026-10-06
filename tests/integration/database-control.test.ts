import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Push delivery is stubbed: the test checks who would receive it, never a real push service.
const sent = vi.hoisted(() => [] as string[]);
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (subscription: { endpoint: string }) => {
      sent.push(subscription.endpoint);
    }),
  },
}));

import { AdminStaffService } from "@/features/admin/application/admin-staff-service";
import { AuditLogService } from "@/features/admin/application/audit-log-service";
import { SessionService } from "@/features/admin/auth/session-service";
import {
  AuthorizationError,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { AdminNotificationService } from "@/features/admin/notifications/notification-service";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOperatorActor, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const notifications = new AdminNotificationService(db);
const staff = new AdminStaffService(db);
const audit = new AuditLogService(db);
const sessions = new SessionService(db);

let owner: AdminActor;
let operator: AdminActor;

beforeEach(async () => {
  await resetTestDatabase();
  owner = await createOwnerActor();
  operator = await createOperatorActor();
});

async function publishBoth() {
  await notifications.publish({
    type: "business_summary",
    title: "الملخص الشهري",
    body: "المبيعات 1٬200 ₪، الربح الإجمالي 340 ₪",
    href: "/admin/reports/archive",
    dedupeKey: "summary:test",
  });
  await notifications.publish({
    type: "debt_reminder",
    title: "تذكير بدين",
    body: "على أحمد 50 ₪",
    href: "/admin/customers",
    dedupeKey: "debt:test",
  });
}

describe("notification privacy", () => {
  it("keeps sales and profit summaries away from operators in the list, count and links", async () => {
    await publishBoth();
    const types = async (actor: AdminActor) =>
      (await notifications.list(actor, 50)).map((row) => row.type).sort();
    expect(await types(owner)).toEqual(["business_summary", "debt_reminder"]);
    expect(await types(operator)).toEqual(["debt_reminder"]);
    expect(await notifications.unreadCount(operator)).toBe(1);
    // Asking for the hidden type by name still returns nothing.
    expect(
      await notifications.list(operator, 50, { type: "business_summary" }),
    ).toEqual([]);
    const [summary] = await db
      .select({ id: schema.adminNotifications.id })
      .from(schema.adminNotifications)
      .where(eq(schema.adminNotifications.type, "business_summary"));
    expect(await notifications.open(operator, summary!.id)).toBe(
      "/admin/notifications",
    );
    expect(await notifications.open(owner, summary!.id)).toBe(
      "/admin/reports/archive",
    );
  });

  it("marks all as read only for the person asking and only what they can see", async () => {
    await publishBoth();
    expect(await notifications.markAllRead(operator)).toBe(1);
    expect(await notifications.unreadCount(operator)).toBe(0);
    expect(await notifications.unreadCount(owner)).toBe(2);
    const reads = await db.select().from(schema.adminNotificationReads);
    expect(reads.map((row) => row.adminUserId)).toEqual([operator.id]);
  });
});

describe("push privacy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pushes a summary only to devices of people who can read reports", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "test-public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
    await db.insert(schema.adminPushSubscriptions).values([
      {
        adminUserId: owner.id,
        endpoint: "https://push.example/owner",
        p256dh: "p".repeat(40),
        auth: "a".repeat(20),
      },
      {
        adminUserId: operator.id,
        endpoint: "https://push.example/operator",
        p256dh: "p".repeat(40),
        auth: "a".repeat(20),
      },
    ]);
    sent.length = 0;
    await publishBoth();
    // The summary reaches the owner only; the debt reminder reaches both.
    expect(sent.sort()).toEqual([
      "https://push.example/operator",
      "https://push.example/owner",
      "https://push.example/owner",
    ]);
  });
});

describe("users and sessions", () => {
  it("lists accounts and live sessions for the owner without any hash", async () => {
    const ownerDevice = await sessions.create(owner.id);
    await sessions.create(operator.id);
    const list = await staff.list(owner, ownerDevice.rawToken);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toMatch(/hash/i);
    expect(serialized).not.toContain(ownerDevice.rawToken);
    expect(serialized).not.toContain("not-a-login-hash");
    const me = list.find((member) => member.id === owner.id)!;
    expect(me.sessions.map((session) => session.current)).toEqual([true]);
    const them = list.find((member) => member.id === operator.id)!;
    expect(them.sessions.map((session) => session.current)).toEqual([false]);
    await expect(staff.list(operator, null)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("signs one device out, refuses the owner's current device and records it", async () => {
    const ownerDevice = await sessions.create(owner.id);
    const phone = await sessions.create(operator.id);
    const [phoneRow] = (await staff.list(owner, ownerDevice.rawToken)).find(
      (member) => member.id === operator.id,
    )!.sessions;
    await staff.revokeSession(owner, phoneRow!.id, ownerDevice.rawToken);
    expect(await sessions.lookup(phone.rawToken)).toBeNull();

    const [mine] = (await staff.list(owner, ownerDevice.rawToken)).find(
      (member) => member.id === owner.id,
    )!.sessions;
    await expect(
      staff.revokeSession(owner, mine!.id, ownerDevice.rawToken),
    ).rejects.toMatchObject({ code: "own_session" });
    await expect(
      staff.revokeSession(operator, mine!.id, null),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const events = await db
      .select()
      .from(schema.adminAuditEvents)
      .where(eq(schema.adminAuditEvents.actionType, "session_revoke"));
    expect(events).toHaveLength(1);
  });

  it("stopping an operator ends every session at once; the owner cannot be stopped", async () => {
    const first = await sessions.create(operator.id);
    const second = await sessions.create(operator.id);
    await staff.setOperatorActive(owner, operator.id, false);
    expect(await sessions.lookup(first.rawToken)).toBeNull();
    expect(await sessions.lookup(second.rawToken)).toBeNull();
    await expect(
      staff.setOperatorActive(owner, owner.id, false),
    ).rejects.toMatchObject({ code: "owner_protected" });
    await expect(
      staff.setOperatorActive(operator, operator.id, true),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await staff.setOperatorActive(owner, operator.id, true);
    const fresh = await sessions.create(operator.id);
    expect(await sessions.lookup(fresh.rawToken)).toMatchObject({
      id: operator.id,
    });
  });
});

describe("audit log", () => {
  it("is for the owner only, filters by account and type, and pages backwards", async () => {
    const base = Date.parse("2026-10-01T08:00:00Z");
    await db.insert(schema.adminAuditEvents).values(
      Array.from({ length: 45 }, (_, index) => ({
        adminUserId: index % 3 === 0 ? operator.id : owner.id,
        actionType: index % 2 ? "product_update" : "stock_adjustment",
        entityType: index % 2 ? "product" : "inventory_item",
        entityId: `row-${index}`,
        beforeState: null,
        afterState: { index },
        createdAt: new Date(base + index * 60_000),
      })),
    );
    await expect(audit.list(operator)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    const first = await audit.list(owner);
    expect(first.entries).toHaveLength(40);
    expect(first.entries[0]!.entityId).toBe("row-44");
    expect(first.entries[0]!.label).toBe("تعديل مخزون");
    const rest = await audit.list(owner, { before: first.nextCursor! });
    expect(rest.entries.map((entry) => entry.entityId)).toEqual([
      "row-4",
      "row-3",
      "row-2",
      "row-1",
      "row-0",
    ]);
    expect(rest.nextCursor).toBeNull();
    const byOperator = await audit.list(owner, { actorId: operator.id });
    expect(byOperator.entries).toHaveLength(15);
    const products = await audit.list(owner, { entityType: "product" });
    expect(
      products.entries.every((entry) => entry.entityType === "product"),
    ).toBe(true);
    // Unknown filter values are ignored rather than passed to the query.
    const loose = await audit.list(owner, { entityType: "x'; drop" });
    expect(loose.entries).toHaveLength(40);
  });
});
