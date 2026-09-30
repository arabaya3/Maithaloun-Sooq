import "server-only";

import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import type { AdminNotificationService } from "@/features/admin/notifications/notification-service";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission } from "@/features/admin/domain/permissions";
import type { Database } from "@/features/inventory/application/stock-ledger";
import {
  reminderDecision,
  reminderMessage,
} from "@/features/reminders/domain/reminder-rules";
import type { PushDeliveryStatus } from "@/features/reminders/domain/schedule-constants";
import type { CustomerService } from "@/features/sales/application/customer-service";
import { addDays, toStoreDate } from "@/shared/lib/store-time";
import * as schema from "@/server/db/schema";

export class ReminderError extends Error {
  constructor(readonly code: "invalid_input" | "not_found") {
    super(code);
    this.name = "ReminderError";
  }
}

export interface ReminderView {
  snoozedUntil: string | null;
  disputed: boolean;
  disputeNote: string | null;
  history: Array<{
    reminderDate: string;
    balanceAgorot: number;
    daysOutstanding: number;
    pushStatus: PushDeliveryStatus;
  }>;
}

export class ReminderService {
  constructor(
    private readonly database: Database,
    private readonly customers: CustomerService,
    private readonly notifications: AdminNotificationService,
  ) {}

  // Notifies the shop staff only; nothing is ever sent to the customer from here.
  async runDaily(
    actor: AdminActor,
    today: string,
  ): Promise<{ checked: number; sent: number }> {
    assertPermission(actor, "reminders.manage");
    const owing = await this.customers.list(actor, { onlyOwing: true });
    let sent = 0;

    for (const customer of owing) {
      const detail = await this.customers.getDetail(actor, customer.id);
      if (!detail) continue;
      const [state] = await this.database
        .select()
        .from(schema.customerReminderState)
        .where(eq(schema.customerReminderState.customerId, customer.id))
        .limit(1);
      const [lastPayment] = await this.database
        .select({ createdAt: schema.customerPayments.createdAt })
        .from(schema.customerPayments)
        .where(
          and(
            eq(schema.customerPayments.customerId, customer.id),
            gt(schema.customerPayments.amountAgorot, 0),
          ),
        )
        .orderBy(desc(schema.customerPayments.createdAt))
        .limit(1);

      const decision = reminderDecision({
        balanceAgorot: detail.summary.balanceAgorot,
        oldestUnpaidDate: detail.summary.oldestUnpaid?.date ?? null,
        lastPaymentDate: lastPayment
          ? toStoreDate(lastPayment.createdAt)
          : null,
        lastRemindedOn: state?.lastRemindedOn ?? null,
        snoozedUntil: state?.snoozedUntil ?? null,
        disputed: state?.disputed ?? false,
        today,
      });
      if (!decision.eligible) continue;

      // The unique (customer, date) row is claimed first, so a retried run cannot notify twice.
      const [reminder] = await this.database
        .insert(schema.customerReminders)
        .values({
          customerId: customer.id,
          reminderDate: today,
          balanceAgorot: detail.summary.balanceAgorot,
          daysOutstanding: decision.daysOutstanding,
          pushStatus: "not_configured",
        })
        .onConflictDoNothing({
          target: [
            schema.customerReminders.customerId,
            schema.customerReminders.reminderDate,
          ],
        })
        .returning({ id: schema.customerReminders.id });
      if (!reminder) continue;

      const published = await this.notifications.publish({
        type: "debt_reminder",
        title: "تذكير بدين",
        body: reminderMessage(
          detail.name,
          detail.summary.balanceAgorot,
          decision.daysOutstanding,
        ),
        href: `/admin/customers/${customer.id}`,
        dedupeKey: `debt-reminder:${customer.id}:${today}`,
      });
      await this.database
        .update(schema.customerReminders)
        .set({
          notificationId: published.notificationId,
          pushStatus: published.pushStatus ?? "failed",
        })
        .where(eq(schema.customerReminders.id, reminder.id));
      await this.database
        .insert(schema.customerReminderState)
        .values({ customerId: customer.id, lastRemindedOn: today })
        .onConflictDoUpdate({
          target: schema.customerReminderState.customerId,
          set: { lastRemindedOn: today, updatedAt: new Date() },
        });
      sent += 1;
    }
    return { checked: owing.length, sent };
  }

  async getView(actor: AdminActor, customerId: string): Promise<ReminderView> {
    assertPermission(actor, "customers.view");
    const [state] = await this.database
      .select()
      .from(schema.customerReminderState)
      .where(eq(schema.customerReminderState.customerId, customerId))
      .limit(1);
    const history = await this.database
      .select({
        reminderDate: schema.customerReminders.reminderDate,
        balanceAgorot: schema.customerReminders.balanceAgorot,
        daysOutstanding: schema.customerReminders.daysOutstanding,
        pushStatus: schema.customerReminders.pushStatus,
      })
      .from(schema.customerReminders)
      .where(eq(schema.customerReminders.customerId, customerId))
      .orderBy(desc(schema.customerReminders.reminderDate))
      .limit(20);
    return {
      snoozedUntil: state?.snoozedUntil ?? null,
      disputed: state?.disputed ?? false,
      disputeNote: state?.disputeNote ?? null,
      history,
    };
  }

  async snooze(
    actor: AdminActor,
    input: { customerId: string; days: number; today: string },
  ): Promise<void> {
    assertPermission(actor, "reminders.manage");
    if (
      !z.uuid().safeParse(input.customerId).success ||
      !Number.isInteger(input.days) ||
      input.days < 0 ||
      input.days > 90
    ) {
      throw new ReminderError("invalid_input");
    }
    await this.upsertState(actor, input.customerId, {
      snoozedUntil: input.days === 0 ? null : addDays(input.today, input.days),
    });
  }

  async setDisputed(
    actor: AdminActor,
    input: { customerId: string; disputed: boolean; note?: string },
  ): Promise<void> {
    assertPermission(actor, "reminders.manage");
    const note = input.note?.trim() ?? "";
    if (!z.uuid().safeParse(input.customerId).success || note.length > 240) {
      throw new ReminderError("invalid_input");
    }
    await this.upsertState(actor, input.customerId, {
      disputed: input.disputed,
      disputeNote: input.disputed ? note || null : null,
    });
  }

  private async upsertState(
    actor: AdminActor,
    customerId: string,
    patch: Partial<typeof schema.customerReminderState.$inferInsert>,
  ) {
    const [customer] = await this.database
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);
    if (!customer) throw new ReminderError("not_found");
    const now = new Date();
    await this.database
      .insert(schema.customerReminderState)
      .values({ customerId, ...patch, updatedBy: actor.id, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.customerReminderState.customerId,
        set: { ...patch, updatedBy: actor.id, updatedAt: now },
      });
    await this.database.insert(schema.adminAuditEvents).values({
      adminUserId: actor.id,
      actionType: "reminder_state_update",
      entityType: "customer",
      entityId: customerId,
      beforeState: null,
      afterState: {
        snoozed: Boolean(patch.snoozedUntil),
        disputed: patch.disputed ?? null,
      },
    });
  }
}
