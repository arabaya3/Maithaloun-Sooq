import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { SocialJobs } from "@/features/social/application/social-jobs";
import {
  SocialError,
  SocialService,
} from "@/features/social/application/social-service";
import {
  toSocialCatalog,
  type PublicCatalog,
  type SocialCatalog,
} from "@/features/social/domain/social-catalog";
import {
  requiredPageScopes,
  type FetchLike,
} from "@/features/social/infrastructure/meta-graph-client";
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
const variant = (id: string) => ({
  id,
  label: "الافتراضي",
  available: true,
  image,
  sellingUnits: [{ priceAgorot: 1200, isDefault: true }],
});
function publicCatalog(available: Record<string, boolean>): PublicCatalog {
  return {
    ok: true,
    store: {
      name: "MAYTHA MARKET",
      whatsAppE164: "+972599105456",
      delivery: {
        area: "maythalun",
        feeAgorot: 500,
        freeFromAgorot: 5000,
        payment: "cash_on_delivery",
      },
    },
    categories: [{ code: "laundry", name: "الغسيل" }],
    products: Object.entries(available).map(([id, isAvailable]) => ({
      id,
      slug: id,
      name: `منتج ${id}`,
      nameAr: `منتج ${id}`,
      brand: null,
      categoryCode: "laundry",
      available: isAvailable,
      priceAgorot: 1200,
      image,
      description: null,
      usageNotes: null,
      variants: [{ ...variant(`${id}-v`), available: isAvailable }],
    })),
  };
}

let clock = new Date("2026-10-24T08:00:00Z");
let catalog: SocialCatalog;
let metaCalls: string[];
let metaReply: (url: string, init?: RequestInit) => Response;
const fetchMeta: FetchLike = async (url, init) => {
  metaCalls.push(`${init?.method ?? "GET"} ${url}`);
  return metaReply(url, init);
};
const posted = (path: string) =>
  metaCalls.filter(
    (call) =>
      call.startsWith("POST ") &&
      new URL(call.slice(5)).pathname.endsWith(path),
  ).length;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const vaultKey = randomBytes(32);

function service() {
  let media = 0;
  return new SocialService({
    database: db,
    catalog: async () => catalog,
    media: {
      put: async (_bytes, kind) => `https://cdn.test/${(media += 1)}.${kind}`,
    },
    origin: "https://maithaloun-sooq.vercel.app",
    vaultKey: () => vaultKey,
    renderFeed: async () => Buffer.from("jpg"),
    renderReel: async () => ({
      mp4: Buffer.from("mp4"),
      poster: Buffer.from("jpg"),
      seconds: 15,
    }),
    loadImage: async () => Buffer.from("photo"),
    videoRenderingAvailable: async () => true,
    fetch: fetchMeta,
    now: () => clock,
  });
}

describe("social manager (database)", () => {
  let owner: AdminActor;
  let operator: AdminActor;
  let social: SocialService;

  beforeAll(async () => {
    await resetTestDatabase();
    owner = await createOwnerActor();
    operator = await createOperatorActor();
  });

  beforeEach(async () => {
    await db.delete(schema.socialComments);
    await db.delete(schema.socialEngagement);
    await db.delete(schema.socialPostEvents);
    await db.delete(schema.socialPosts);
    await db.delete(schema.socialConnections);
    await db.delete(schema.socialCatalogSeen);
    await db.delete(schema.socialJobRuns);
    await db.delete(schema.socialSettings);
    clock = new Date("2026-10-24T08:00:00Z");
    catalog = toSocialCatalog(
      publicCatalog({ a: true, b: true, c: true, d: true, e: true }),
    );
    metaCalls = [];
    metaReply = () => json({ id: "photo-1", post_id: "page_1" });
    social = service();
  });

  async function readyDraft() {
    await social.draftPlan(owner, { startDate: "2026-10-25", days: 1 });
    await social.renderPending();
    const [post] = await db.select().from(schema.socialPosts);
    return post!;
  }

  it("drafts a week idempotently, from available products only", async () => {
    const first = await social.draftPlan(operator, {
      startDate: "2026-10-25",
      days: 7,
    });
    expect(first.created).toBe(6);
    const again = await social.draftPlan(operator, {
      startDate: "2026-10-25",
      days: 7,
    });
    expect(again).toEqual({ created: 0, skipped: 6 });
    const posts = await db.select().from(schema.socialPosts);
    expect(posts.every((post) => post.status === "draft")).toBe(true);
    expect(posts.filter((post) => post.format === "reel")).toHaveLength(2);
  });

  it("renders media, and only the owner can approve", async () => {
    const post = await readyDraft();
    expect(post.mediaStatus).toBe("ready");
    expect(post.mediaUrl).toMatch(/^https:\/\/cdn\.test\//);
    await expect(
      social.approve(operator, post.id, post.version),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await social.approve(owner, post.id, post.version);
    const [approved] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(approved).toMatchObject({
      status: "approved",
      approvedBy: owner.id,
    });
    expect(approved!.publishKey).toHaveLength(64);
  });

  it("refuses stale approvals and blocked captions", async () => {
    const post = await readyDraft();
    await expect(
      social.approve(owner, post.id, post.version - 1),
    ).rejects.toMatchObject({ code: "stale" });
    await social.editCaption(
      owner,
      post.id,
      post.version,
      "خصم 50 على كل شي 3 ₪",
    );
    const [edited] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    await expect(
      social.approve(owner, post.id, edited!.version),
    ).rejects.toMatchObject({
      code: "blocked",
      blockers: ["caption_blocked"],
    });
  });

  it("never publishes drafts, publishes approved posts once, and needs a connection", async () => {
    const post = await readyDraft();
    clock = new Date("2026-10-26T00:00:00Z");
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    expect((await social.publishDue()).published).toBe(0);
    expect(metaCalls).toHaveLength(0);

    await db.delete(schema.socialConnections);
    clock = new Date("2026-10-24T09:00:00Z");
    await social.approve(owner, post.id, post.version);
    clock = new Date("2026-10-26T00:00:00Z");
    expect(await social.publishDue()).toMatchObject({
      skipped: "not_connected",
    });

    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    const stored = await social.connection();
    expect(stored!.tokenSealed).not.toContain("page-token");
    const [result1, result2] = await Promise.all([
      social.publishDue(),
      service().publishDue(),
    ]);
    expect(result1.published + result2.published).toBe(1);
    expect(posted("/photos")).toBe(1);
    expect((await social.publishDue()).published).toBe(0);
    const [published] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(published).toMatchObject({
      status: "published",
      metaPostId: "page_1",
      metaObjectId: "photo-1",
    });
  });

  it("does not advertise a product that sold out after approval", async () => {
    const post = await readyDraft();
    await social.approve(owner, post.id, post.version);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    catalog = toSocialCatalog(
      publicCatalog(
        Object.fromEntries(
          ["a", "b", "c", "d", "e"].map((id) => [
            id,
            !post.productIds.includes(id),
          ]),
        ),
      ),
    );
    clock = new Date("2026-10-26T00:00:00Z");
    expect(await social.publishDue()).toMatchObject({
      failed: 1,
      published: 0,
    });
    expect(metaCalls).toHaveLength(0);
    const [failed] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(failed).toMatchObject({
      status: "failed",
      lastErrorCode: "PRODUCT_UNAVAILABLE",
    });
  });

  it("retries transient failures with backoff, stops at expired tokens", async () => {
    const post = await readyDraft();
    await social.approve(owner, post.id, post.version);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    clock = new Date("2026-10-26T00:00:00Z");
    metaReply = () => json({ error: { code: 2, is_transient: true } }, 500);
    expect((await social.publishDue()).retrying).toBe(1);
    let [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(row).toMatchObject({ status: "retry_wait", attempts: 1 });
    expect(row!.nextAttemptAt!.getTime()).toBe(clock.getTime() + 5 * 60_000);
    expect((await social.publishDue()).retrying).toBe(0);

    clock = new Date(clock.getTime() + 6 * 60_000);
    metaReply = () => json({ error: { code: 190 } }, 400);
    await social.publishDue();
    [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(row).toMatchObject({
      status: "failed",
      lastErrorCode: "META_AUTH_190",
    });
    expect((await social.connection())!.status).toBe("expired");
  });

  it("reconciles a crashed claim from the Page's posts instead of publishing twice", async () => {
    const post = await readyDraft();
    await social.approve(owner, post.id, post.version);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    await db
      .update(schema.socialPosts)
      .set({
        status: "publishing",
        claimToken: "00000000-0000-4000-8000-000000000009",
        claimedAt: new Date("2026-10-25T20:00:00Z"),
      })
      .where(eq(schema.socialPosts.id, post.id));
    clock = new Date("2026-10-25T21:00:00Z");
    metaReply = () =>
      json({ data: [{ id: "page_99", message: post.caption }] });
    expect(await social.reconcileStale()).toEqual({
      recovered: 1,
      requeued: 0,
      waiting: 0,
    });
    const [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(row).toMatchObject({ status: "published", metaPostId: "page_99" });
    expect(posted("/photos")).toBe(0);
  });

  it("keeps the claim after a lost answer and checks the Page before any re-send", async () => {
    const post = await readyDraft();
    await social.approve(owner, post.id, post.version);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    clock = new Date("2026-10-26T00:00:00Z");
    metaReply = (_url, init) => {
      if (init?.method === "POST") throw new Error("socket hang up");
      return json({ data: [] });
    };
    expect(await social.publishDue()).toMatchObject({
      uncertain: 1,
      published: 0,
    });
    let [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(row).toMatchObject({
      status: "publishing",
      lastErrorCode: "META_UNKNOWN_OUTCOME",
    });
    // Not due again, and the reconciler waits until the claim is stale.
    expect((await social.publishDue()).published).toBe(0);
    expect(await social.reconcileStale()).toEqual({
      recovered: 0,
      requeued: 0,
      waiting: 0,
    });
    expect(posted("/photos")).toBe(1);

    // Twenty minutes later the Page shows nothing: queued again, with backoff.
    clock = new Date("2026-10-26T00:20:00Z");
    expect(await social.reconcileStale()).toMatchObject({ requeued: 1 });
    [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(row!.status).toBe("retry_wait");

    // By the retry the post has shown up after all: it is recorded, never sent a second time.
    clock = new Date("2026-10-26T01:00:00Z");
    metaReply = (_url, init) =>
      init?.method === "POST"
        ? json({ id: "dup" })
        : json({ data: [{ id: "page_7", message: ` ${post.caption}\n` }] });
    expect((await social.publishDue()).published).toBe(1);
    [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(row).toMatchObject({ status: "published", metaObjectId: "page_7" });
    expect(posted("/photos")).toBe(1);
  });

  it("resolves a Reel with a lost final answer by its own video id", async () => {
    await social.draftPlan(owner, { startDate: "2026-10-25", days: 2 });
    await social.renderPending();
    const reel = (await db.select().from(schema.socialPosts)).find(
      (p) => p.format === "reel",
    )!;
    await social.approve(owner, reel.id, reel.version);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    clock = new Date("2026-10-27T00:00:00Z");
    metaReply = (url, init) => {
      if (url.includes("rupload")) return json({ success: true });
      if (String(init?.body).includes("upload_phase=start"))
        return json({ video_id: "v42" });
      if (init?.method === "POST")
        return new Response("bad gateway", { status: 502 });
      return json({
        status: {
          video_status: "ready",
          publishing_phase: { status: "complete" },
        },
      });
    };
    expect(await social.publishDue()).toMatchObject({ uncertain: 1 });
    let [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, reel.id));
    expect(row).toMatchObject({ status: "publishing", metaUploadId: "v42" });
    clock = new Date("2026-10-27T00:30:00Z");
    expect(await social.reconcileStale()).toMatchObject({ recovered: 1 });
    [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, reel.id));
    expect(row).toMatchObject({ status: "published", metaObjectId: "v42" });
    // One upload session only, and the answer came from asking about that video.
    expect(posted("/video_reels")).toBe(2);
    expect(
      metaCalls.some(
        (call) =>
          call.startsWith("GET ") && call.includes("/v42?fields=status"),
      ),
    ).toBe(true);
  });

  it("a manual retry finds a post that already went out instead of sending it again", async () => {
    const post = await readyDraft();
    await social.approve(owner, post.id, post.version);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    await db
      .update(schema.socialPosts)
      .set({ status: "failed", attempts: 4, lastErrorCode: "META_TRANSIENT" })
      .where(eq(schema.socialPosts.id, post.id));
    const [failed] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    metaReply = () => json({ data: [{ id: "page_3", message: post.caption }] });
    await expect(
      social.retryFailed(owner, post.id, failed!.version),
    ).rejects.toMatchObject({
      code: "already_published",
    });
    const [row] = await db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, post.id));
    expect(row).toMatchObject({ status: "published", metaObjectId: "page_3" });
    expect(posted("/photos")).toBe(0);
  });

  it("sends a held reply once even when the button is pressed twice", async () => {
    const post = await readyDraft();
    await social.approve(owner, post.id, post.version);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    await db.insert(schema.socialComments).values({
      id: "c9",
      postId: post.id,
      message: "قديش التوصيل؟",
      commentedAt: clock,
      decision: "reply",
      reason: "delivery_fee",
      replyText: "5 ₪",
      replyStatus: "held",
    });
    metaReply = () => json({ id: "r1" });
    const results = await Promise.allSettled([
      social.sendHeldReply(owner, "c9"),
      social.sendHeldReply(owner, "c9"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(posted("c9/comments")).toBe(1);
  });

  it("refuses a Page token issued for another Page or app", async () => {
    const checked = new SocialService({
      ...(
        social as unknown as {
          deps: ConstructorParameters<typeof SocialService>[0];
        }
      ).deps,
      metaApp: { appId: "app-1", appSecret: "secret" },
    });
    const inspect = (data: Record<string, unknown>) => () =>
      json({
        data: {
          is_valid: true,
          app_id: "app-1",
          profile_id: "61595987361563",
          scopes: [...requiredPageScopes],
          ...data,
        },
      });
    const connect = () =>
      checked.connectPage(owner, {
        pageId: "61595987361563",
        token: "page-token-0123456789",
      });
    metaReply = inspect({ profile_id: "999" });
    await expect(connect()).rejects.toMatchObject({ code: "token_wrong_page" });
    metaReply = inspect({ app_id: "app-2" });
    await expect(connect()).rejects.toMatchObject({ code: "token_wrong_app" });
    metaReply = inspect({ scopes: ["pages_manage_posts"] });
    await expect(connect()).rejects.toMatchObject({
      code: "token_missing_scopes",
    });
    expect(await social.connection()).toBeNull();
    metaReply = inspect({});
    await connect();
    expect((await social.connection())!.status).toBe("connected");
  });

  it("publish-one sends exactly the chosen approved post, even in manual mode", async () => {
    await social.draftPlan(owner, { startDate: "2026-10-25", days: 5 });
    await social.renderPending();
    const posts = await db.select().from(schema.socialPosts);
    const [chosen, other, draft] = posts.filter(
      (post) => post.format === "image",
    );
    await social.approve(owner, chosen!.id, chosen!.version);
    await social.approve(owner, other!.id, other!.version);
    await social.updateSettings(owner, {
      autoPublishApproved: false,
      autoReplyFaq: false,
      paused: false,
    });
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    clock = new Date("2026-11-30T00:00:00Z");
    // The schedule publishes nothing in manual mode.
    expect(await social.publishDue()).toMatchObject({ skipped: "manual_mode" });
    expect(posted("/photos")).toBe(0);
    // A draft or an unknown id is refused without any call to Facebook.
    expect(
      (
        await social.publishDue(1, {
          onlyPostId:
            draft!.status === "draft"
              ? draft!.id
              : "00000000-0000-4000-8000-000000000000",
        })
      ).published,
    ).toBe(0);
    await expect(
      social.publishDue(1, { onlyPostId: "x; drop table" }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      (await social.publishDue(1, { onlyPostId: chosen!.id })).published,
    ).toBe(1);
    expect(posted("/photos")).toBe(1);
    const rows = await db.select().from(schema.socialPosts);
    expect(rows.find((row) => row.id === chosen!.id)!.status).toBe("published");
    expect(rows.find((row) => row.id === other!.id)!.status).toBe("approved");
    expect(rows.filter((row) => row.status === "published")).toHaveLength(1);
  });

  it("triages comments: holds verified answers, escalates the rest, never replies when off", async () => {
    const post = await readyDraft();
    await social.approve(owner, post.id, post.version);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    clock = new Date("2026-10-26T00:00:00Z");
    await social.publishDue();
    metaReply = (url) =>
      url.includes("/comments")
        ? json({
            data: [
              {
                id: "c1",
                message: "قديش التوصيل؟",
                from: { id: "u1", name: "سارة" },
                created_time: "2026-10-26T00:00:00Z",
              },
              {
                id: "c2",
                message: "بدي استرجاع",
                from: { id: "u2", name: "أحمد" },
                created_time: "2026-10-26T00:00:00Z",
              },
              {
                id: "c3",
                message: "رد الصفحة",
                from: { id: "61595987361563" },
                created_time: "2026-10-26T00:00:00Z",
              },
            ],
          })
        : json({ id: "reply-1" });
    expect(await social.syncComments()).toEqual({
      seen: 2,
      replied: 0,
      escalated: 1,
    });
    expect(await social.syncComments()).toEqual({
      seen: 0,
      replied: 0,
      escalated: 0,
    });
    const comments = await db.select().from(schema.socialComments);
    expect(comments.find((c) => c.id === "c1")).toMatchObject({
      decision: "reply",
      replyStatus: "held",
    });
    expect(comments.find((c) => c.id === "c2")).toMatchObject({
      decision: "escalate",
      reason: "refund",
    });
    expect(posted("c1/comments")).toBe(0);
  });

  it("logs job runs and produces one weekly report", async () => {
    const jobs = new SocialJobs(db, social, () => clock);
    expect((await jobs.run("discover")).summary).toEqual({
      products: 5,
      newlySeen: 0,
    });
    catalog = toSocialCatalog(
      publicCatalog({ a: true, b: true, c: true, d: true, e: true, f: true }),
    );
    expect((await jobs.run("discover")).summary).toEqual({
      products: 6,
      newlySeen: 1,
    });
    expect((await jobs.run("report")).status).toBe("ok");
    expect((await jobs.run("report")).status).toBe("skipped");
    const runs = await db.select().from(schema.socialJobRuns);
    expect(runs.every((run) => run.finishedAt)).toBe(true);
  });

  it("keeps connection changes owner-only and audited", async () => {
    await expect(
      social.connectPage(operator, {
        pageId: "61595987361563",
        token: "page-token-0123456789",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      social.connectPage(owner, { pageId: "not-a-page", token: "x" }),
    ).rejects.toBeInstanceOf(SocialError);
    await social.connectPage(owner, {
      pageId: "61595987361563",
      token: "page-token-0123456789",
    });
    const audit = await db
      .select()
      .from(schema.adminAuditEvents)
      .where(eq(schema.adminAuditEvents.actionType, "social_connect"));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((event) => event.adminUserId === owner.id)).toBe(true);
    expect(
      JSON.stringify(audit.map((event) => event.afterState)),
    ).not.toContain("page-token");
  });
});
