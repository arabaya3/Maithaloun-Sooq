import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import {
  campaignOf,
  SocialService,
} from "@/features/social/application/social-service";
import { checkCaption } from "@/features/social/domain/caption-guard";
import { bundlePrices } from "@/features/social/domain/campaigns";
import {
  allowedPrices,
  catalogText,
  toSocialCatalog,
  type PublicCatalog,
} from "@/features/social/domain/social-catalog";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOperatorActor, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const image = {
  src: "https://x.supabase.co/p.webp",
  alt: "p",
  width: 10,
  height: 10,
};

/** A catalog in the live store's words, so bundle roles and product picks are exercised for real. */
const products: Array<[string, string, string, number]> = [
  ["dish", "kitchen-dishwashing", "سائل جلي فيري - بعدة روائح", 1000],
  ["sponge", "kitchen-dishwashing", "إسفنج جلي وتنظيف الصحون", 500],
  ["degrease", "kitchen-dishwashing", "فينيسيا مزيل الزيوت والدهون", 800],
  ["wipes", "kitchen-dishwashing", "مناديل مبللة لتنظيف المطبخ", 500],
  ["tabs", "kitchen-dishwashing", "أقراص غسالة الصحون فينيش", 3200],
  ["powder", "laundry", "مسحوق غسيل البركان المركز", 600],
  ["softener", "laundry", "منعّم ومعطّر الملابس لويال", 1000],
  ["ariel", "laundry", "مسحوق غسيل أريال", 5400],
  ["gel", "laundry", "أريال باور جل لغسيل الملابس", 2700],
  ["stain", "home-cleaners", "مزيل البقع متعدد الاستخدامات", 1000],
  ["tiles", "home-cleaners", "منظف ومعطر البلاط ليلاك", 1000],
  ["chlorine", "home-cleaners", "كلور دولفين مبيض ومعقم", 700],
  ["wc", "home-cleaners", "منظف حمامات ومراحيض مدهش", 600],
  ["squeegee", "cleaning-tools", "مسّاحة أرضيات مطاطية عريضة", 700],
  ["broom", "cleaning-tools", "مكنسة أرضيات 35 سم", 600],
  ["cloth", "cleaning-tools", "طقم فوط تنظيف مايكروفايبر", 1000],
  ["wc-soap", "bathroom", "صابونة مرحاض بون", 500],
  ["air", "home-fragrances", "معطر الجو لويال بعدة روائح", 1000],
  ["odor", "home-fragrances", "مزيل الروائح القوية البركان", 1500],
  ["carpet", "carpet-upholstery", "بودرة معطر السجاد والغرف", 1500],
];

let prices = new Map(products.map(([id, , , price]) => [id, price]));

function publicCatalog(): PublicCatalog {
  return {
    ok: true,
    store: {
      name: "MAYTHA MARKET",
      whatsAppE164: "+972599105456",
      delivery: {
        area: "maythalun",
        feeAgorot: 500,
        freeFromAgorot: 10_000,
        payment: "cash_on_delivery",
      },
    },
    categories: [],
    products: products.map(([id, categoryCode, nameAr]) => ({
      id,
      slug: id,
      name: nameAr,
      nameAr,
      brand: null,
      categoryCode,
      available: true,
      priceAgorot: prices.get(id)!,
      image,
      description: null,
      usageNotes: null,
      variants: [
        {
          id: `${id}-v`,
          label: "الافتراضي",
          available: true,
          image,
          sellingUnits: [{ priceAgorot: prices.get(id)!, isDefault: true }],
        },
      ],
    })),
  };
}

let clock = new Date("2026-10-29T08:00:00Z");
let rendered: Array<{ layout: string; footer: string }> = [];

function service() {
  let media = 0;
  return new SocialService({
    database: db,
    catalog: async () => toSocialCatalog(publicCatalog()),
    media: {
      put: async (_bytes, kind) => `https://cdn.test/${(media += 1)}.${kind}`,
    },
    origin: "https://www.maytha.app",
    vaultKey: () => randomBytes(32),
    renderFeed: async () => Buffer.from("jpg"),
    renderReel: async () => ({
      mp4: Buffer.from("mp4"),
      poster: Buffer.from("jpg"),
      seconds: 15,
    }),
    renderCampaign: async (input) => {
      rendered.push({ layout: input.layout, footer: input.copy.caption });
      return Buffer.from("campaign-jpg");
    },
    loadImage: async () => Buffer.from("photo"),
    videoRenderingAvailable: async () => false,
    now: () => clock,
  });
}

describe("Creative Studio campaigns (database)", () => {
  let owner: AdminActor;
  let operator: AdminActor;
  let social: SocialService;

  beforeAll(async () => {
    await resetTestDatabase();
    owner = await createOwnerActor();
    operator = await createOperatorActor();
  });

  beforeEach(async () => {
    await db.delete(schema.socialPostEvents);
    await db.delete(schema.socialPosts);
    await db.delete(schema.socialSettings);
    clock = new Date("2026-10-29T08:00:00Z");
    prices = new Map(products.map(([id, , , price]) => [id, price]));
    rendered = [];
    social = service();
  });

  const campaigns = () =>
    db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.kind, "campaign"));

  it("drafts two weeks of varied campaigns, each an unapproved draft with real prices", async () => {
    expect(
      await social.draftCampaigns(operator, {
        startDate: "2026-11-01",
        days: 14,
      }),
    ).toEqual({ created: 8, skipped: 0 });
    const rows = await campaigns();
    expect(rows).toHaveLength(8);
    const catalog = toSocialCatalog(publicCatalog());
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "draft",
        approvedBy: null,
        mediaStatus: "pending",
        format: "image",
      });
      const campaign = campaignOf(row)!;
      expect(campaign.objective).toBeTruthy();
      const used = catalog.products.filter((p) =>
        row.productIds.includes(p.id),
      );
      expect(used).toHaveLength(row.productIds.length);
      const check = checkCaption(
        row.caption,
        new Set([
          ...allowedPrices(used, catalog.store),
          ...bundlePrices(campaign.bundle),
        ]),
        catalogText(used),
      );
      expect(check.issues, row.caption).toEqual([]);
      expect(row.caption).toContain("https://www.maytha.app");
      expect(row.caption).not.toMatch(/maithaloun-sooq|50 ₪ وفوق/u);
    }
    expect(
      new Set(rows.map((row) => campaignOf(row)!.type)).size,
    ).toBeGreaterThanOrEqual(6);
    // Running it again fills nothing twice.
    expect(
      await social.draftCampaigns(owner, { startDate: "2026-11-01", days: 14 }),
    ).toEqual({ created: 0, skipped: 8 });
    expect(await social.settings()).toMatchObject({
      autoPublishApproved: false,
      autoReplyFaq: false,
    });
  });

  it("renders campaigns with the campaign renderer, and never with changed prices", async () => {
    await social.draftCampaigns(owner, { startDate: "2026-11-01", days: 14 });
    const bundled = (await campaigns()).find((row) => campaignOf(row)!.bundle)!;
    // One bundled product changes price before its image is prepared.
    prices.set(
      bundled.productIds[0]!,
      prices.get(bundled.productIds[0]!)! + 100,
    );
    const result = await social.renderPending(20);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const rows = await campaigns();
    const stale = rows.find((row) => row.id === bundled.id)!;
    expect(stale).toMatchObject({
      mediaStatus: "failed",
      mediaError: "CAMPAIGN_PRICES_CHANGED",
    });
    expect(rows.filter((row) => row.mediaStatus === "ready").length).toBe(
      result.rendered,
    );
    expect(rendered.length).toBe(result.rendered);
    // The owner sees why and cannot approve it.
    const view = await social.view(owner, stale.id);
    expect(view.campaignCurrent).toBe(false);
    expect(view.blockers.length).toBeGreaterThan(0);
  });

  it("is approved only by the owner, and an approved campaign is frozen", async () => {
    await social.draftCampaigns(owner, { startDate: "2026-11-01", days: 14 });
    await social.renderPending(20);
    const ready = (await campaigns()).find(
      (row) => row.mediaStatus === "ready",
    )!;
    await expect(
      social.approve(operator, ready.id, ready.version),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await social.approve(owner, ready.id, ready.version);
    const approved = (await campaigns()).find((row) => row.id === ready.id)!;
    expect(approved.status).toBe("approved");
    // No edit or regeneration while approved: the approval covers exactly this content.
    await expect(
      social.editCaption(owner, approved.id, approved.version, "نص آخر"),
    ).rejects.toThrow();
    await expect(
      social.regenerateCampaign(owner, approved.id, approved.version),
    ).rejects.toThrow();
    // Taking the approval back clears it; the campaign can then change and needs approval again.
    await social.unapprove(owner, approved.id, approved.version);
    const draft = (await campaigns()).find((row) => row.id === ready.id)!;
    expect(draft).toMatchObject({
      status: "draft",
      approvedBy: null,
      publishKey: null,
    });
    // Nothing goes out on its own.
    clock = new Date("2026-11-20T00:00:00Z");
    expect(await social.publishDue()).toMatchObject({ skipped: "manual_mode" });
  });

  it("suggests another campaign for the same slot, as a fresh unapproved draft", async () => {
    await social.draftCampaigns(owner, { startDate: "2026-11-01", days: 14 });
    await social.renderPending(20);
    const before = (await campaigns()).find(
      (row) => row.mediaStatus === "ready",
    )!;
    await social.regenerateCampaign(operator, before.id, before.version);
    const after = (await campaigns()).find((row) => row.id === before.id)!;
    expect(after.scheduledFor).toEqual(before.scheduledFor);
    expect(after).toMatchObject({
      status: "draft",
      mediaStatus: "pending",
      mediaUrl: null,
      version: before.version + 1,
    });
    const changed =
      campaignOf(after)!.angleId !== campaignOf(before)!.angleId ||
      after.productIds.join() !== before.productIds.join() ||
      after.tipId !== before.tipId;
    expect(changed).toBe(true);
    // A page that still shows the old version cannot overwrite the new suggestion.
    await expect(
      social.regenerateCampaign(owner, before.id, before.version),
    ).rejects.toMatchObject({ code: "stale" });
    const events = await db
      .select()
      .from(schema.socialPostEvents)
      .where(eq(schema.socialPostEvents.postId, before.id));
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining(["created", "media_ready", "edit"]),
    );
  });

  it("leaves other posts and published history alone", async () => {
    await social.draftPlan(owner, { startDate: "2026-11-01", days: 3 });
    const legacy = await db.select().from(schema.socialPosts);
    await social.draftCampaigns(owner, { startDate: "2026-11-01", days: 14 });
    for (const row of legacy) {
      const [same] = await db
        .select()
        .from(schema.socialPosts)
        .where(eq(schema.socialPosts.id, row.id));
      expect(same).toMatchObject({
        version: row.version,
        caption: row.caption,
        kind: row.kind,
      });
    }
    // Slots already taken by those posts are skipped, not doubled.
    const all = await db.select().from(schema.socialPosts);
    const times = all.map((row) => row.scheduledFor?.toISOString());
    expect(new Set(times).size).toBe(times.length);
  });
  it("creates one campaign for an objective in the next free slot, as an unapproved draft", async () => {
    const id = await social.createCampaign(operator, {
      objective: "discovery",
    });
    const [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, id));
    expect(row).toMatchObject({
      kind: "campaign",
      status: "draft",
      approvedBy: null,
    });
    expect(campaignOf(row!)!.type).toBe("product_discovery");
    expect(row!.scheduledFor!.getTime()).toBeGreaterThan(clock.getTime());
    // The next one goes to another slot, never the same one.
    const second = await social.createCampaign(owner, { objective: "trust" });
    const [other] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, second));
    expect(other!.scheduledFor).not.toEqual(row!.scheduledFor);
    expect(campaignOf(other!)!.type).toBe("customer_trust");
    const view = await social.view(owner, id);
    expect(view.campaignDetails!.hooks).toHaveLength(3);
    expect(view.campaignDetails!.destination).toContain(
      "utm_campaign=product-discovery-",
    );
    await expect(
      social.createCampaign(owner, { objective: "nonsense" as never }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("lets the owner choose another hook; the image is prepared again and approval still needed", async () => {
    const id = await social.createCampaign(owner, { objective: "awareness" });
    await social.renderPending(20);
    const [before] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, id));
    expect(before!.mediaStatus).toBe("ready");
    const hooks = (await social.view(owner, id)).campaignDetails!.hooks;
    await social.chooseCampaignHook(owner, id, before!.version, 2);
    const [after] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, id));
    expect(after).toMatchObject({
      status: "draft",
      mediaStatus: "pending",
      version: before!.version + 1,
    });
    expect(after!.caption.split("\n")[0]).toContain(hooks[2]!);
    expect(campaignOf(after!)!.hookIndex).toBe(2);
    await expect(
      social.chooseCampaignHook(owner, id, before!.version, 1),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      social.chooseCampaignHook(owner, id, after!.version, 7),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("counts each step for the overview, from real rows only", async () => {
    await social.draftCampaigns(owner, { startDate: "2026-11-01", days: 14 });
    await social.renderPending(3);
    const overview = await social.overview(owner);
    expect(overview).toEqual({
      drafts: 8,
      readyForReview: 3,
      approved: 0,
      published: 0,
      reelsInProgress: 0,
    });
  });
});
