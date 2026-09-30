import "server-only";

import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import webpush from "web-push";
import { z } from "zod";

import {
  assertOperationsActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import type { PushDeliveryStatus } from "@/features/reminders/domain/schedule-constants";
import * as schema from "@/server/db/schema";

const subscriptionSchema = z
  .object({
    endpoint: z.url().max(2_048),
    expirationTime: z.number().nullable(),
    keys: z.object({
      p256dh: z.string().min(20).max(180),
      auth: z.string().min(10).max(80),
    }),
  })
  .strict();

function pushConfiguration() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export class AdminNotificationService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  getPublicKey(): string | null {
    return pushConfiguration()?.publicKey ?? null;
  }

  async list(actor: AdminActor, limit = 20) {
    assertOperationsActor(actor);
    return this.database
      .select({
        id: schema.adminNotifications.id,
        title: schema.adminNotifications.title,
        body: schema.adminNotifications.body,
        href: schema.adminNotifications.href,
        createdAt: schema.adminNotifications.createdAt,
        readAt: schema.adminNotificationReads.readAt,
      })
      .from(schema.adminNotifications)
      .leftJoin(
        schema.adminNotificationReads,
        and(
          eq(
            schema.adminNotificationReads.notificationId,
            schema.adminNotifications.id,
          ),
          eq(schema.adminNotificationReads.adminUserId, actor.id),
        ),
      )
      .orderBy(desc(schema.adminNotifications.createdAt))
      .limit(Math.min(Math.max(limit, 1), 50));
  }

  async unreadCount(actor: AdminActor): Promise<number> {
    const rows = await this.list(actor, 50);
    return rows.filter((row) => row.readAt === null).length;
  }

  async markRead(actor: AdminActor, notificationId: string): Promise<void> {
    assertOperationsActor(actor);
    if (!z.string().uuid().safeParse(notificationId).success) return;
    await this.database
      .insert(schema.adminNotificationReads)
      .values({ notificationId, adminUserId: actor.id })
      .onConflictDoNothing();
  }

  async open(actor: AdminActor, notificationId: string): Promise<string> {
    assertOperationsActor(actor);
    const parsed = z.string().uuid().safeParse(notificationId);
    if (!parsed.success) return "/admin/notifications";
    const [notification] = await this.database
      .select({ href: schema.adminNotifications.href })
      .from(schema.adminNotifications)
      .where(eq(schema.adminNotifications.id, parsed.data))
      .limit(1);
    if (!notification) return "/admin/notifications";
    await this.markRead(actor, parsed.data);
    return notification.href.startsWith("/admin/")
      ? notification.href
      : "/admin/notifications";
  }

  async saveSubscription(actor: AdminActor, input: unknown): Promise<void> {
    assertOperationsActor(actor);
    const subscription = subscriptionSchema.parse(input);
    const expiresAt = subscription.expirationTime
      ? new Date(subscription.expirationTime)
      : null;
    await this.database
      .insert(schema.adminPushSubscriptions)
      .values({
        adminUserId: actor.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: schema.adminPushSubscriptions.endpoint,
        set: {
          adminUserId: actor.id,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          expiresAt,
          updatedAt: new Date(),
        },
      });
  }

  async removeSubscription(actor: AdminActor, endpoint: string): Promise<void> {
    assertOperationsActor(actor);
    const parsed = z.url().max(2_048).safeParse(endpoint);
    if (!parsed.success) return;
    await this.database
      .delete(schema.adminPushSubscriptions)
      .where(
        and(
          eq(schema.adminPushSubscriptions.adminUserId, actor.id),
          eq(schema.adminPushSubscriptions.endpoint, parsed.data),
        ),
      );
  }

  async dispatchOrderNotification(publicReference: string): Promise<void> {
    const [notification] = await this.database
      .select({
        title: schema.adminNotifications.title,
        body: schema.adminNotifications.body,
        href: schema.adminNotifications.href,
      })
      .from(schema.adminNotifications)
      .innerJoin(
        schema.orders,
        eq(schema.adminNotifications.orderId, schema.orders.id),
      )
      .where(eq(schema.orders.publicReference, publicReference))
      .limit(1);
    if (!notification) return;
    await this.pushToAll(notification);
  }

  // The dedupe key makes scheduled notifications safe to retry: a second attempt creates nothing.
  async publish(input: {
    type: string;
    title: string;
    body: string;
    href: string;
    dedupeKey: string;
  }): Promise<{
    notificationId: string | null;
    created: boolean;
    pushStatus: PushDeliveryStatus | null;
  }> {
    const [created] = await this.database
      .insert(schema.adminNotifications)
      .values({
        type: input.type,
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 240),
        href: input.href,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing({ target: schema.adminNotifications.dedupeKey })
      .returning({ id: schema.adminNotifications.id });
    if (!created) {
      return { notificationId: null, created: false, pushStatus: null };
    }
    const pushStatus = await this.pushToAll({
      title: input.title,
      body: input.body,
      href: input.href,
    });
    return { notificationId: created.id, created: true, pushStatus };
  }

  private async pushToAll(payload: {
    title: string;
    body: string;
    href: string;
  }): Promise<PushDeliveryStatus> {
    const config = pushConfiguration();
    if (!config) return "not_configured";
    webpush.setVapidDetails(
      config.subject,
      config.publicKey,
      config.privateKey,
    );
    const subscriptions = await this.database
      .select()
      .from(schema.adminPushSubscriptions)
      .innerJoin(
        schema.adminUsers,
        eq(schema.adminPushSubscriptions.adminUserId, schema.adminUsers.id),
      )
      .where(
        and(
          eq(schema.adminUsers.active, true),
          or(
            isNull(schema.adminPushSubscriptions.expiresAt),
            gt(schema.adminPushSubscriptions.expiresAt, new Date()),
          ),
        ),
      );
    if (!subscriptions.length) return "no_subscribers";

    const results = await Promise.allSettled(
      subscriptions.map(async ({ admin_push_subscriptions: subscription }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              expirationTime: subscription.expiresAt?.getTime() ?? null,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify(payload),
          );
        } catch (error) {
          const statusCode =
            typeof error === "object" && error && "statusCode" in error
              ? Number(error.statusCode)
              : 0;
          if (statusCode === 404 || statusCode === 410) {
            await this.database
              .delete(schema.adminPushSubscriptions)
              .where(eq(schema.adminPushSubscriptions.id, subscription.id));
          }
          throw error;
        }
      }),
    );

    await this.database
      .delete(schema.adminPushSubscriptions)
      .where(lt(schema.adminPushSubscriptions.expiresAt, new Date()));
    return results.some((result) => result.status === "fulfilled")
      ? "sent"
      : "failed";
  }
}
