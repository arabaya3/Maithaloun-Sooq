import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import {
  campaignOf,
  SocialService,
} from "@/features/social/application/social-service";
import { campaignCode } from "@/features/social/application/campaign-attribution";
import {
  MAX_RENDER_ATTEMPTS,
  ReelRenderQueue,
} from "@/features/social/application/reel-render-queue";
import { runReelRenders } from "@/features/social/application/reel-render-worker";
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
    renderCampaignExport: async (input, format) =>
      format === "carousel"
        ? [Buffer.from("cover"), Buffer.from(input.copy.cta)]
        : [Buffer.from(`${format}:${input.bundle?.totalAgorot ?? ""}`)],
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

  it("exports square, Story and carousel from today's prices, and refuses changed prices", async () => {
    await social.draftCampaigns(owner, { startDate: "2026-11-01", days: 14 });
    const bundled = (await campaigns()).find((row) => campaignOf(row)!.bundle)!;
    const total = campaignOf(bundled)!.bundle!.totalAgorot;
    // Viewing is enough: an operator can download, nothing is stored or published.
    expect(
      String(await social.campaignExport(operator, bundled.id, "square")),
    ).toBe(`square:${total}`);
    expect(
      await social.campaignExport(owner, bundled.id, "carousel"),
    ).toHaveLength(2);
    const view = await social.view(owner, bundled.id);
    expect(view.campaignDetails!.ad).toMatchObject({
      callToAction: "SHOP_NOW",
      link: view.campaignDetails!.destination,
    });
    expect(view.campaignDetails!.ad!.primaryText.length).toBeLessThanOrEqual(
      125,
    );
    expect((await campaigns()).find((row) => row.id === bundled.id)).toEqual(
      bundled,
    );
    prices.set(
      bundled.productIds[0]!,
      prices.get(bundled.productIds[0]!)! + 100,
    );
    await expect(
      social.campaignExport(owner, bundled.id, "story"),
    ).rejects.toMatchObject({ code: "prices_changed" });
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
    // The tracked link names this campaign by a short code of its own id, nothing about people.
    expect(view.campaignDetails!.destination).toContain(
      `utm_campaign=${campaignCode(id)}`,
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

describe("Reels render queue (database)", () => {
  let owner: AdminActor;
  let social: SocialService;
  const queue = () => new ReelRenderQueue(db, () => clock);
  const request = {
    concept: "problem-to-product",
    seconds: 15,
    productIds: ["powder"],
  };
  let renders = 0;
  let renderFails = false;
  let stored = 0;
  let catalogDown = false;
  /** Runs while FFmpeg would be running: lets a test change the catalog mid-render. */
  let duringRender: () => void = () => {};
  const worker = () =>
    runReelRenders({
      queue: queue(),
      catalog: async () => {
        if (catalogDown) throw new Error("CATALOG_UNAVAILABLE");
        return toSocialCatalog(publicCatalog());
      },
      origin: "https://www.maytha.app",
      siteLabel: "www.maytha.app",
      media: {
        put: async (_bytes, kind) => {
          stored += 1;
          return `https://cdn.test/reel.${kind}`;
        },
      },
      loadImage: async () => Buffer.from("photo"),
      render: async ({ board }) => {
        renders += 1;
        duringRender();
        if (renderFails) throw new Error("FFMPEG_FAILED");
        return {
          mp4: Buffer.from("mp4"),
          frames: board.scenes.map(() => Buffer.from("jpg")),
          seconds: board.seconds,
        };
      },
    });

  beforeAll(async () => {
    owner = await createOwnerActor();
  });

  beforeEach(async () => {
    await db.delete(schema.socialReelRenders);
    await db.delete(schema.socialPosts);
    clock = new Date("2026-10-29T08:00:00Z");
    prices = new Map(products.map(([id, , , price]) => [id, price]));
    renders = 0;
    renderFails = false;
    stored = 0;
    catalogDown = false;
    duringRender = () => {};
    social = service();
  });

  it("queues a storyboard once, renders it once, and never creates or publishes a post", async () => {
    const first = await social.requestReelRender(owner, request);
    const again = await social.requestReelRender(owner, request);
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    // Leaving a scene out is another storyboard, so another render.
    const shorter = await social.requestReelRender(owner, {
      ...request,
      dropScenes: [2],
    });
    expect(shorter.id).not.toBe(first.id);

    expect(await worker()).toEqual({ rendered: 2, failed: 0 });
    expect(await worker()).toEqual({ rendered: 0, failed: 0 });
    expect(renders).toBe(2);
    const row = await queue().get(first.id);
    expect(row).toMatchObject({
      status: "ready",
      videoUrl: "https://cdn.test/reel.mp4",
      renderedSeconds: 15,
      attempts: 1,
      requestedBy: owner.id,
    });
    expect(row!.frameUrls.length).toBeGreaterThan(1);
    expect(await db.select().from(schema.socialPosts)).toEqual([]);
  });

  it("the same Reel asked for twice at once is queued and rendered once", async () => {
    const [a, b] = await Promise.all([
      social.requestReelRender(owner, request),
      social.requestReelRender(owner, request),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(schema.socialReelRenders)).toHaveLength(1);
    await Promise.all([worker(), worker()]);
    expect(renders).toBe(1);
  });

  it("two workers never take the same render", async () => {
    await social.requestReelRender(owner, request);
    const [a, b] = await Promise.all([queue().claim(), queue().claim()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("retries a failing render, stops after the limit, and the owner's retry starts again", async () => {
    const { id } = await social.requestReelRender(owner, request);
    renderFails = true;
    for (let i = 0; i < MAX_RENDER_ATTEMPTS + 1; i += 1) await worker();
    expect(renders).toBe(MAX_RENDER_ATTEMPTS);
    expect(await queue().get(id)).toMatchObject({
      status: "failed",
      errorCode: "FFMPEG_FAILED",
      attempts: MAX_RENDER_ATTEMPTS,
    });
    renderFails = false;
    await social.retryReelRender(owner, id);
    expect(await worker()).toEqual({ rendered: 1, failed: 0 });
    expect((await queue().get(id))!.status).toBe("ready");
    // Only a failed render can be retried.
    await expect(social.retryReelRender(owner, id)).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("requeues a render whose worker vanished, and a late finish from that worker is ignored", async () => {
    const { id } = await social.requestReelRender(owner, request);
    const lost = await queue().claim();
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect(await worker()).toEqual({ rendered: 1, failed: 0 });
    expect(
      await queue().finish(id, lost!.token, {
        videoUrl: "https://cdn.test/old.mp4",
        frameUrls: [],
        seconds: 1,
      }),
    ).toBe(false);
    expect((await queue().get(id))!.videoUrl).toBe("https://cdn.test/reel.mp4");
  });

  it("never renders yesterday's prices: a price change fails the render", async () => {
    const { id } = await social.requestReelRender(owner, request);
    prices.set("powder", 650);
    expect(await worker()).toEqual({ rendered: 0, failed: 1 });
    expect(renders).toBe(0);
    expect((await queue().get(id))!.errorCode).toBe("CATALOG_CHANGED");
  });

  it("throws the video away when a price changes while it renders", async () => {
    const { id } = await social.requestReelRender(owner, request);
    duringRender = () => prices.set("powder", 650);
    expect(await worker()).toEqual({ rendered: 0, failed: 1 });
    expect(renders).toBe(1);
    expect(stored).toBe(0);
    expect(await queue().get(id)).toMatchObject({
      status: "failed",
      errorCode: "CATALOG_CHANGED",
      videoUrl: null,
    });
    // Final: another try would draw the same old prices.
    expect(await worker()).toEqual({ rendered: 0, failed: 0 });
  });

  it("a finished Reel whose price changes is marked outdated and is no longer handed out", async () => {
    const { id } = await social.requestReelRender(owner, request);
    await worker();
    expect(await social.reelVideo(owner, id)).toBe("https://cdn.test/reel.mp4");
    expect((await social.reelRenders(owner))[0]).toMatchObject({
      id,
      status: "ready",
      outdated: false,
    });

    prices.set("powder", 650);
    expect((await social.reelRenders(owner))[0]).toMatchObject({
      id,
      outdated: true,
    });
    await expect(social.reelVideo(owner, id)).rejects.toMatchObject({
      code: "prices_changed",
    });

    // Back to the price it shows: true again, so it is handed out again.
    prices.set("powder", products.find(([pid]) => pid === "powder")![3]);
    expect((await social.reelRenders(owner))[0]!.outdated).toBe(false);
    await expect(
      social.reelVideo(owner, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(social.reelVideo(owner, "../etc")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("an unreachable catalog never spends every try and never stores a video", async () => {
    const { id } = await social.requestReelRender(owner, request);
    // Down before the run: nothing is claimed and no try is spent.
    catalogDown = true;
    await expect(worker()).rejects.toThrow("CATALOG_UNAVAILABLE");
    expect(await queue().get(id)).toMatchObject({
      status: "queued",
      attempts: 0,
    });
    // Down while FFmpeg runs: the video is not kept, one try is spent and the run stops.
    catalogDown = false;
    duringRender = () => {
      catalogDown = true;
    };
    expect(await worker()).toEqual({ rendered: 0, failed: 1 });
    expect(stored).toBe(0);
    expect(await queue().get(id)).toMatchObject({
      status: "queued",
      attempts: 1,
      errorCode: "CATALOG_UNAVAILABLE",
    });
    catalogDown = false;
    duringRender = () => {};
    expect(await worker()).toEqual({ rendered: 1, failed: 0 });
    expect(renders).toBe(2);
  });

  it("renders the owner's pose and words, and refuses prices, offers and unapproved poses", async () => {
    const edited = {
      ...request,
      pose: "wave",
      hookText: "الغسيل متكوّم؟ ميثو عنده الحل",
      ctaText: "اطلبوا من الموقع",
    };
    const board = await social.reelStoryboard(owner, edited);
    expect(JSON.stringify(board)).toContain("الغسيل متكوّم؟ ميثو عنده الحل");
    const poses = board.scenes.flatMap((scene) =>
      scene.layers.flatMap((layer) =>
        layer.kind === "mascot" ? [layer.pose] : [],
      ),
    );
    expect(poses.length).toBeGreaterThan(0);
    expect(new Set(poses)).toEqual(new Set(["wave"]));
    // The worker rebuilds exactly the same storyboard from the stored choices.
    const { id } = await social.requestReelRender(owner, edited);
    expect(await worker()).toEqual({ rendered: 1, failed: 0 });
    expect((await queue().get(id))!.status).toBe("ready");

    for (const [bad, code] of [
      [{ hookText: "خصم على كل المنظفات" }, "reel_text_rejected"],
      [{ hookText: "كل إشي بـ 5 ₪" }, "reel_text_rejected"],
      [{ ctaText: "الأفضل بفلسطين" }, "reel_text_rejected"],
      [{ hookText: "أ".repeat(61) }, "reel_text_rejected"],
      [{ pose: "shopping" }, "reel_pose_unavailable"],
      [{ pose: "laundry" }, "reel_pose_unavailable"],
    ] as const) {
      await expect(
        social.requestReelRender(owner, { ...request, ...bad }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("refuses unknown concepts, lengths and products", async () => {
    for (const bad of [
      { ...request, concept: "dance" },
      { ...request, seconds: 12 },
      { ...request, productIds: ["nope"] },
      { ...request, productIds: ["a", "b", "c", "d"] },
    ]) {
      await expect(social.requestReelRender(owner, bad)).rejects.toMatchObject({
        code: "invalid",
      });
    }
  });
});
