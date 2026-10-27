import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import {
  SocialService,
  type SocialPostRow,
} from "@/features/social/application/social-service";
import {
  toSocialCatalog,
  type PublicCatalog,
} from "@/features/social/domain/social-catalog";
import { MakePublisher } from "@/features/social/infrastructure/make-publisher";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOperatorActor, createOwnerActor } from "./support";

const { db } = testDatabaseConnection;
const WEBHOOK = "https://hook.eu2.make.com/maytha-test";
const KEY = "make-api-key-0123456789";
const image = {
  src: "https://x.supabase.co/p.webp",
  alt: "p",
  width: 10,
  height: 10,
};

function publicCatalog(ids: string[]): PublicCatalog {
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
    products: ids.map((id) => ({
      id,
      slug: id,
      name: `منتج ${id}`,
      nameAr: `منتج ${id}`,
      brand: null,
      categoryCode: "laundry",
      available: true,
      priceAgorot: 1200,
      image,
      description: null,
      usageNotes: null,
      variants: [
        {
          id: `${id}-v`,
          label: "الافتراضي",
          available: true,
          image,
          sellingUnits: [{ priceAgorot: 1200, isDefault: true }],
        },
      ],
    })),
  };
}

let clock = new Date("2026-10-24T08:00:00Z");
let webhookCalls: Array<{
  headers: Record<string, string>;
  body: Record<string, unknown>;
}>;
let webhookReply: () => Response;
let mediaProblem: string | null;

function service(options: { configured?: boolean; reels?: boolean } = {}) {
  let media = 0;
  return new SocialService({
    database: db,
    catalog: async () =>
      toSocialCatalog(publicCatalog(["a", "b", "c", "d", "e"])),
    media: {
      put: async (_bytes, kind) => `https://cdn.test/${(media += 1)}.${kind}`,
    },
    origin: "https://maithaloun-sooq.vercel.app",
    vaultKey: () => randomBytes(32),
    renderFeed: async () => Buffer.from("jpg"),
    renderReel: async () => ({
      mp4: Buffer.from("mp4"),
      poster: Buffer.from("jpg"),
      seconds: 15,
    }),
    loadImage: async () => Buffer.from("photo"),
    videoRenderingAvailable: async () => true,
    now: () => clock,
    publisherName: "make",
    makePublisher:
      options.configured === false
        ? null
        : new MakePublisher({
            webhookUrl: WEBHOOK,
            apiKey: KEY,
            supportsReels: options.reels ?? false,
            pageId: "61595987361563",
            callbackUrl:
              "https://maithaloun-sooq.vercel.app/api/social/make/callback",
            fetch: async (_url, init) => {
              webhookCalls.push({
                headers: init!.headers as Record<string, string>,
                body: JSON.parse(String(init!.body)),
              });
              return webhookReply();
            },
          }),
    checkMedia: async () => mediaProblem as never,
  });
}

describe("social manager through Make (database)", () => {
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
    clock = new Date("2026-10-24T08:00:00Z");
    webhookCalls = [];
    webhookReply = () => new Response("Accepted");
    mediaProblem = null;
    social = service();
  });

  async function approvedPost(
    format: "image" | "reel" = "image",
  ): Promise<SocialPostRow> {
    await social.draftPlan(owner, { startDate: "2026-10-25", days: 2 });
    await social.renderPending();
    const post = (await db.select().from(schema.socialPosts)).find(
      (row) => row.format === format,
    )!;
    await social.approve(owner, post.id, post.version);
    clock = new Date("2026-10-27T00:00:00Z");
    return (await row(post.id))!;
  }
  const row = async (id: string) =>
    (
      await db
        .select()
        .from(schema.socialPosts)
        .where(eq(schema.socialPosts.id, id))
    )[0];

  it("never sends drafts or anything before approval", async () => {
    await social.draftPlan(owner, { startDate: "2026-10-25", days: 2 });
    await social.renderPending();
    clock = new Date("2026-10-27T00:00:00Z");
    expect((await social.publishDue()).published).toBe(0);
    const draft = (await db.select().from(schema.socialPosts))[0]!;
    expect(
      (await social.publishDue(1, { onlyPostId: draft.id })).published,
    ).toBe(0);
    expect(webhookCalls).toHaveLength(0);
  });

  it("hands an approved post to Make once and waits for Facebook's confirmation", async () => {
    const post = await approvedPost();
    expect(await social.publishDue()).toMatchObject({
      handedOff: 1,
      published: 0,
    });
    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0]!.headers["x-make-apikey"]).toBe(KEY);
    expect(webhookCalls[0]!.body).toMatchObject({
      postId: post.id,
      idempotencyKey: post.publishKey,
      caption: post.caption,
      contentType: "image",
    });
    expect(await row(post.id)).toMatchObject({
      status: "publishing",
      lastErrorCode: "AWAITING_CONFIRMATION",
      publishProvider: "make",
    });
    // Not sent again, not even after the claim goes stale: only a confirmation settles it.
    expect((await social.publishDue()).handedOff ?? 0).toBe(0);
    clock = new Date("2026-10-27T01:00:00Z");
    expect(await social.reconcileStale()).toEqual({
      recovered: 0,
      requeued: 0,
      waiting: 1,
    });
    expect(await row(post.id)).toMatchObject({ status: "publishing" });
    expect(webhookCalls).toHaveLength(1);
  });

  it("a 200 without a valid Facebook id is not a publication", async () => {
    const post = await approvedPost();
    webhookReply = () => Response.json({ id: "not-a-facebook-id" });
    expect(await social.publishDue()).toMatchObject({
      published: 0,
      handedOff: 1,
    });
    expect(await row(post.id)).toMatchObject({
      status: "publishing",
      lastErrorCode: "AWAITING_CONFIRMATION",
    });
  });

  it("two workers racing hand the post to Make exactly once", async () => {
    await approvedPost();
    const results = await Promise.all([
      social.publishDue(),
      service().publishDue(),
      service().publishDue(),
    ]);
    expect(results.reduce((sum, r) => sum + (r.handedOff ?? 0), 0)).toBe(1);
    expect(webhookCalls).toHaveLength(1);
  });

  it("a 502 (Facebook module failure) is unknown and never resent automatically", async () => {
    const post = await approvedPost();
    webhookReply = () => new Response("", { status: 502 });
    expect((await social.publishDue()).uncertain).toBe(1);
    clock = new Date("2026-10-28T00:00:00Z");
    expect(await social.reconcileStale()).toMatchObject({
      waiting: 1,
      requeued: 0,
    });
    await social.publishDue();
    expect(webhookCalls).toHaveLength(1);
    expect(await row(post.id)).toMatchObject({
      status: "publishing",
      lastErrorCode: "MAKE_UNKNOWN_OUTCOME",
    });
  });

  it("a 422 (unsupported content) fails safely and may be retried", async () => {
    const post = await approvedPost();
    webhookReply = () => new Response("Unsupported", { status: 422 });
    expect((await social.publishDue()).failed).toBe(1);
    const current = (await row(post.id))!;
    expect(current).toMatchObject({
      status: "failed",
      lastErrorCode: "MAKE_INVALID_REQUEST_422",
    });
  });

  it("is settled only by a callback naming the post and its approval key", async () => {
    const post = await approvedPost();
    await social.publishDue();
    expect(
      await social.confirmFromProvider({
        postId: post.id,
        idempotencyKey: "c".repeat(64),
        status: "published",
        facebookPostId: "1_2",
      }),
    ).toBe("ignored");
    expect(
      await social.confirmFromProvider({
        postId: "00000000-0000-4000-8000-000000000000",
        idempotencyKey: post.publishKey!,
        status: "published",
        facebookPostId: "1_2",
      }),
    ).toBe("ignored");
    expect(
      await social.confirmFromProvider({
        postId: post.id,
        idempotencyKey: post.publishKey!,
        status: "published",
        facebookPostId: "61595987361563_9",
      }),
    ).toBe("applied");
    expect(await row(post.id)).toMatchObject({
      status: "published",
      metaPostId: "61595987361563_9",
    });
    // A second report changes nothing.
    expect(
      await social.confirmFromProvider({
        postId: post.id,
        idempotencyKey: post.publishKey!,
        status: "failed",
      }),
    ).toBe("ignored");
    expect(await row(post.id)).toMatchObject({ status: "published" });
  });

  it("records Facebook's confirmation when the scenario answers synchronously", async () => {
    const post = await approvedPost();
    webhookReply = () =>
      Response.json({ facebookPostId: "61595987361563_77777" });
    expect((await social.publishDue()).published).toBe(1);
    expect(await row(post.id)).toMatchObject({
      status: "published",
      metaPostId: "61595987361563_77777",
      publishProvider: "make",
    });
  });

  it("keeps a lost answer for the owner, who alone settles it", async () => {
    const post = await approvedPost();
    webhookReply = () => {
      throw new Error("socket hang up");
    };
    expect((await social.publishDue()).uncertain).toBe(1);
    let current = (await row(post.id))!;
    expect(current).toMatchObject({
      status: "publishing",
      lastErrorCode: "MAKE_UNKNOWN_OUTCOME",
    });
    await expect(
      social.resolveUncertain(operator, post.id, current.version, {
        published: false,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await social.resolveUncertain(owner, post.id, current.version, {
      published: false,
    });
    current = (await row(post.id))!;
    expect(current).toMatchObject({
      status: "failed",
      lastErrorCode: "OWNER_CONFIRMED_NOT_PUBLISHED",
    });
    // The owner already checked the Page, so the retry needs no second confirmation.
    await social.retryFailed(owner, post.id, current.version);
    webhookReply = () => new Response("Accepted");
    await social.publishDue();
    expect(webhookCalls).toHaveLength(2);
  });

  it("asks the owner to confirm the Page before resending a post Make reported as failed", async () => {
    const post = await approvedPost();
    await social.publishDue();
    await social.confirmFromProvider({
      postId: post.id,
      idempotencyKey: post.publishKey!,
      status: "failed",
      error: "Facebook refused",
    });
    let current = (await row(post.id))!;
    expect(current).toMatchObject({
      status: "failed",
      lastErrorCode: "MAKE_REPORTED_FAILURE",
    });
    await expect(
      social.retryFailed(owner, post.id, current.version),
    ).rejects.toMatchObject({
      code: "confirm_absent_required",
    });
    await social.retryFailed(owner, post.id, current.version, {
      confirmedAbsent: true,
    });
    current = (await row(post.id))!;
    expect(current).toMatchObject({ status: "approved", attempts: 0 });
  });

  it("leaves a partial publication for the owner", async () => {
    const post = await approvedPost();
    await social.publishDue();
    await social.confirmFromProvider({
      postId: post.id,
      idempotencyKey: post.publishKey!,
      status: "partial",
    });
    const current = (await row(post.id))!;
    expect(current).toMatchObject({
      status: "publishing",
      lastErrorCode: "MAKE_PARTIAL",
    });
    await social.resolveUncertain(owner, post.id, current.version, {
      published: true,
      facebookPostId: "61595987361563_5",
    });
    expect(await row(post.id)).toMatchObject({
      status: "published",
      metaObjectId: "61595987361563_5",
    });
  });

  it("resends after a throttle (nothing was taken) but never after an unconfirmed send", async () => {
    const post = await approvedPost();
    webhookReply = () => new Response("", { status: 429 });
    expect((await social.publishDue()).retrying).toBe(1);
    expect(await row(post.id)).toMatchObject({
      status: "retry_wait",
      lastErrorCode: "MAKE_RATE_LIMIT_429",
    });
    clock = new Date("2026-10-27T01:00:00Z");
    webhookReply = () => new Response("Accepted");
    expect((await social.publishDue()).handedOff).toBe(1);
    expect(webhookCalls).toHaveLength(2);
  });

  it("checks the media before handing anything over", async () => {
    const post = await approvedPost();
    mediaProblem = "MEDIA_NOT_REACHABLE";
    expect((await social.publishDue()).failed).toBe(1);
    expect(await row(post.id)).toMatchObject({
      status: "failed",
      lastErrorCode: "MEDIA_NOT_REACHABLE",
    });
    expect(webhookCalls).toHaveLength(0);
  });

  it("holds Reels until the scenario is confirmed to publish them", async () => {
    const reel = await approvedPost("reel");
    expect((await social.publishDue()).handedOff ?? 0).toBe(0);
    expect(await row(reel.id)).toMatchObject({ status: "approved" });
    social = service({ reels: true });
    expect((await social.publishDue()).handedOff).toBe(1);
    expect(webhookCalls[0]!.body).toMatchObject({
      contentType: "reel",
      mediaUrl: expect.stringMatching(/.mp4$/),
    });
  });

  it("publishes nothing when Make is chosen but not configured", async () => {
    await approvedPost();
    social = service({ configured: false });
    expect(await social.publishDue()).toMatchObject({
      skipped: "make_not_configured",
    });
    expect(webhookCalls).toHaveLength(0);
  });
});
