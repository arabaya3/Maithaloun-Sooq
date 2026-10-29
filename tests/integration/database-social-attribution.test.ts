import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OrderService } from "@/features/orders/application/order-service";
import {
  CampaignAttribution,
  campaignCode,
  isCampaignCode,
  MIN_VISITS_FOR_RATE,
} from "@/features/social/application/campaign-attribution";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { checkoutRequest } from "./support";

const { db, client } = testDatabaseConnection;
const orders = new OrderService(db);
const attribution = new CampaignAttribution(
  db,
  () => new Date("2026-11-03T10:00:00Z"),
);

async function campaignPost(kind = "campaign"): Promise<string> {
  const [row] = await db
    .insert(schema.socialPosts)
    .values({
      format: "image",
      kind,
      caption: "حملة",
      captionSource: "template",
      campaign:
        kind === "campaign"
          ? { angleId: "trust-how-it-works", type: "customer_trust" }
          : null,
    })
    .returning({ id: schema.socialPosts.id });
  return row!.id;
}

async function order() {
  return orders.create(
    checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
  );
}

/** Walks an order along the store's own allowed transitions. */
async function setStatus(publicReference: string, status: string) {
  const path =
    status === "cancelled"
      ? ["cancelled"]
      : ["confirmed", "preparing", "out_for_delivery", "delivered"];
  for (const step of path) {
    await db
      .update(schema.orders)
      .set({
        status: step as never,
        version: sql`${schema.orders.version} + 1`,
      })
      .where(eq(schema.orders.publicReference, publicReference));
  }
}

beforeAll(async () => {
  await resetTestDatabase();
});

beforeEach(async () => {
  await client.unsafe(
    "TRUNCATE TABLE social_order_attributions, social_campaign_visits, social_posts, orders CASCADE",
  );
});

describe("campaign codes", () => {
  it("are a short prefix of the campaign id and nothing else", () => {
    const code = campaignCode("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
    expect(code).toBe("mc-0f1e2d3c4b5a");
    expect(isCampaignCode(code)).toBe(true);
    for (const bad of [
      undefined,
      "",
      "mc-",
      "mc-0F1E2D3C4B5A",
      "mc-0f1e2d3c4b5a1",
      "product-discovery-2026-11-03",
      "mc-0f1e2d3c4b5a'; drop table orders",
    ]) {
      expect(isCampaignCode(bad), String(bad)).toBe(false);
    }
  });
});

describe("campaign attribution", () => {
  it("counts landings only for a code that names exactly one campaign post", async () => {
    const id = await campaignPost();
    const plain = await campaignPost("product_spotlight");
    expect(await attribution.recordVisit(campaignCode(id))).toBe(id);
    expect(await attribution.recordVisit(campaignCode(id))).toBe(id);
    // Not a campaign, unknown, malformed or missing: nothing is counted.
    expect(await attribution.recordVisit(campaignCode(plain))).toBeNull();
    expect(await attribution.recordVisit("mc-000000000000")).toBeNull();
    expect(await attribution.recordVisit("product-discovery-x")).toBeNull();
    expect(await attribution.recordVisit(undefined)).toBeNull();
    const visits = await db.select().from(schema.socialCampaignVisits);
    expect(visits).toEqual([{ postId: id, day: "2026-11-03", visits: 2 }]);
  });

  it("links a new order to its campaign without changing the order, once", async () => {
    const id = await campaignPost();
    const placed = await order();
    const [before] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.publicReference, placed.publicReference));
    expect(
      await attribution.attributeOrder(
        placed.publicReference,
        campaignCode(id),
      ),
    ).toBe(true);
    // A second attempt (a retried request) never double counts.
    expect(
      await attribution.attributeOrder(
        placed.publicReference,
        campaignCode(id),
      ),
    ).toBe(false);
    const [after] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.publicReference, placed.publicReference));
    expect(after).toEqual(before);
  });

  it("ignores direct traffic, invalid codes and unknown orders, and leaves historical orders alone", async () => {
    const id = await campaignPost();
    const historical = await order();
    const direct = await order();
    expect(
      await attribution.attributeOrder(direct.publicReference, undefined),
    ).toBe(false);
    expect(
      await attribution.attributeOrder(direct.publicReference, "mc-zzzz"),
    ).toBe(false);
    expect(await attribution.attributeOrder("MS-NOPE", campaignCode(id))).toBe(
      false,
    );
    expect(await db.select().from(schema.socialOrderAttributions)).toEqual([]);
    // Nothing reaches back to orders placed before the campaign was ever clicked.
    expect(await attribution.report()).toEqual([]);
    expect(historical.publicReference).not.toBe(direct.publicReference);
  });

  it("reports verified sales from delivered orders only, and no rate until there is enough data", async () => {
    const id = await campaignPost();
    const code = campaignCode(id);
    for (let i = 0; i < 3; i += 1) await attribution.recordVisit(code);
    const delivered = await order();
    const pending = await order();
    const cancelled = await order();
    for (const placed of [delivered, pending, cancelled]) {
      await attribution.attributeOrder(placed.publicReference, code);
    }
    await setStatus(delivered.publicReference, "delivered");
    await setStatus(cancelled.publicReference, "cancelled");
    const [deliveredRow] = await db
      .select({ total: schema.orders.finalTotalAgorot })
      .from(schema.orders)
      .where(eq(schema.orders.publicReference, delivered.publicReference));

    let [result] = await attribution.report();
    expect(result).toMatchObject({
      postId: id,
      code,
      angleId: "trust-how-it-works",
      visits: 3,
      orders: 2,
      deliveredOrders: 1,
      verifiedSalesAgorot: deliveredRow!.total,
      conversionRate: null,
    });

    for (let i = 3; i < MIN_VISITS_FOR_RATE; i += 1) {
      await attribution.recordVisit(code);
    }
    [result] = await attribution.report();
    expect(result!.conversionRate).toBeCloseTo(2 / MIN_VISITS_FOR_RATE);
  });
});
