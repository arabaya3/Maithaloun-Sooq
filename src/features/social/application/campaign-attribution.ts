import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/server/db/schema";
import { todayInStoreZone } from "@/shared/lib/store-time";

type Database = PostgresJsDatabase<typeof schema>;

/**
 * Privacy-conscious campaign attribution. A tracked link carries `utm_campaign=mc-<12 hex>`, a
 * prefix of the campaign post's id. A landing counts once per browser session (no visitor data
 * is stored, only a daily count), and a first-party cookie holding the code links a later order
 * to the campaign. Codes that do not resolve to exactly one campaign post are ignored.
 */
export const CAMPAIGN_COOKIE = "maytha_campaign";
export const CAMPAIGN_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const CODE = /^mc-[0-9a-f]{12}$/;
/** Below this many tracked visits a conversion rate would mislead, so none is shown. */
export const MIN_VISITS_FOR_RATE = 20;

export function campaignCode(postId: string): string {
  return `mc-${postId.replace(/-/g, "").slice(0, 12)}`;
}

/** Crawlers and link previews (Facebook's included) load the page without being a visitor. */
const AUTOMATED =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;

export function isAutomatedVisit(userAgent: string | null): boolean {
  return !userAgent || AUTOMATED.test(userAgent);
}

export function isCampaignCode(value: unknown): value is string {
  return typeof value === "string" && CODE.test(value);
}

export interface CampaignResult {
  postId: string;
  code: string;
  angleId: string | null;
  type: string | null;
  status: string;
  /** null when no landing was ever counted for this campaign. */
  visits: number;
  /** Attributed orders that were not cancelled. */
  orders: number;
  /** Delivered attributed orders only: sales that actually happened. */
  deliveredOrders: number;
  verifiedSalesAgorot: number;
  /** orders ÷ visits, only when visits reach MIN_VISITS_FOR_RATE; otherwise null («بيانات غير كافية»). */
  conversionRate: number | null;
}

export class CampaignAttribution {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The campaign post a code names, or null when it names none or more than one. */
  async resolve(code: unknown): Promise<string | null> {
    if (!isCampaignCode(code)) return null;
    const hex = code.slice(3);
    const rows = await this.db
      .select({ id: schema.socialPosts.id })
      .from(schema.socialPosts)
      .where(
        and(
          eq(schema.socialPosts.kind, "campaign"),
          // Only a campaign that is out on the Page can bring visitors; a draft's link opened in
          // review or testing never counts.
          eq(schema.socialPosts.status, "published"),
          sql`replace(${schema.socialPosts.id}::text, '-', '') like ${`${hex}%`}`,
        ),
      )
      .limit(2);
    return rows.length === 1 ? rows[0]!.id : null;
  }

  /** Counts one landing; returns the campaign it belongs to, or null for an unknown code. */
  async recordVisit(code: unknown): Promise<string | null> {
    const postId = await this.resolve(code);
    if (!postId) return null;
    await this.db
      .insert(schema.socialCampaignVisits)
      .values({ postId, day: todayInStoreZone(this.now()), visits: 1 })
      .onConflictDoUpdate({
        target: [
          schema.socialCampaignVisits.postId,
          schema.socialCampaignVisits.day,
        ],
        set: { visits: sql`${schema.socialCampaignVisits.visits} + 1` },
      });
    return postId;
  }

  /**
   * Links a newly created order to the campaign in the visitor's cookie. Never changes the order;
   * an unknown code, a missing order or an order already attributed leaves everything as it is.
   */
  async attributeOrder(
    publicReference: string,
    code: unknown,
  ): Promise<boolean> {
    const postId = await this.resolve(code);
    if (!postId) return false;
    const [order] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.publicReference, publicReference))
      .limit(1);
    if (!order) return false;
    const inserted = await this.db
      .insert(schema.socialOrderAttributions)
      .values({ orderId: order.id, postId })
      .onConflictDoNothing()
      .returning({ orderId: schema.socialOrderAttributions.orderId });
    return inserted.length === 1;
  }

  /** Every campaign with any visit or attributed order, best verified sales first. */
  async report(): Promise<CampaignResult[]> {
    const visits = await this.db
      .select({
        postId: schema.socialCampaignVisits.postId,
        visits: sql<number>`sum(${schema.socialCampaignVisits.visits})::int`,
      })
      .from(schema.socialCampaignVisits)
      .groupBy(schema.socialCampaignVisits.postId);
    const orders = await this.db
      .select({
        postId: schema.socialOrderAttributions.postId,
        orders: sql<number>`count(*)::int`,
        delivered: sql<number>`count(*) filter (where ${schema.orders.status} = 'delivered')::int`,
        sales: sql<number>`coalesce(sum(${schema.orders.finalTotalAgorot}) filter (where ${schema.orders.status} = 'delivered'), 0)::int`,
      })
      .from(schema.socialOrderAttributions)
      .innerJoin(
        schema.orders,
        eq(schema.orders.id, schema.socialOrderAttributions.orderId),
      )
      .where(
        and(
          ne(schema.orders.status, "cancelled"),
          eq(schema.orders.isTest, false),
        ),
      )
      .groupBy(schema.socialOrderAttributions.postId);
    const ids = [
      ...new Set([
        ...visits.map((v) => v.postId),
        ...orders.map((o) => o.postId),
      ]),
    ];
    if (!ids.length) return [];
    const posts = await this.db
      .select({
        id: schema.socialPosts.id,
        status: schema.socialPosts.status,
        campaign: schema.socialPosts.campaign,
      })
      .from(schema.socialPosts)
      .where(inArray(schema.socialPosts.id, ids));
    return posts
      .map((post) => {
        const seen = visits.find((v) => v.postId === post.id)?.visits ?? 0;
        const sold = orders.find((o) => o.postId === post.id);
        const campaign = (post.campaign ?? {}) as {
          angleId?: string;
          type?: string;
        };
        const orderCount = sold?.orders ?? 0;
        return {
          postId: post.id,
          code: campaignCode(post.id),
          angleId: campaign.angleId ?? null,
          type: campaign.type ?? null,
          status: post.status,
          visits: seen,
          orders: orderCount,
          deliveredOrders: sold?.delivered ?? 0,
          verifiedSalesAgorot: sold?.sales ?? 0,
          conversionRate:
            seen >= MIN_VISITS_FOR_RATE ? orderCount / seen : null,
        };
      })
      .sort(
        (a, b) =>
          b.verifiedSalesAgorot - a.verifiedSalesAgorot ||
          b.orders - a.orders ||
          b.visits - a.visits,
      );
  }
}
