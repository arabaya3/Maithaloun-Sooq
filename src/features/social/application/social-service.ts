import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission } from "@/features/admin/domain/permissions";
import {
  checkCaption,
  type CaptionCheck,
} from "@/features/social/domain/caption-guard";
import {
  deliveryCaption,
  newArrivalsCaption,
  productCaption,
  collectionCaption,
  reelCaption,
  tipCaption,
  weeklyHighlightsCaption,
  type CaptionContext,
  type PostKind,
  type ReelTemplate,
  type ShoppingTipId,
} from "@/features/social/domain/captions";
import { decideComment } from "@/features/social/domain/comment-policy";
import {
  buildContentPlan,
  type PlannedItem,
} from "@/features/social/domain/content-plan";
import {
  isRetryable,
  MetaApiError,
  type MetaFailure,
} from "@/features/social/domain/meta-errors";
import {
  approvalBlockers,
  MAX_PUBLISH_ATTEMPTS,
  nextStatus,
  retryDelayMs,
  STALE_CLAIM_MS,
  type ApprovalBlocker,
  type MediaStatus,
  type PostEvent,
  type PostFormat,
  type PostStatus,
} from "@/features/social/domain/post-lifecycle";
import {
  allowedPrices,
  catalogText,
  type SocialCatalog,
  type SocialProduct,
} from "@/features/social/domain/social-catalog";
import type { CatalogSource } from "@/features/social/infrastructure/catalog-source";
import {
  isPublishableMediaUrl,
  type SocialMediaStore,
} from "@/features/social/infrastructure/media-store";
import {
  inspectToken,
  MetaGraphClient,
  type FetchLike,
} from "@/features/social/infrastructure/meta-graph-client";
import {
  openToken,
  sealToken,
  tokenHint,
} from "@/features/social/infrastructure/token-vault";
import * as schema from "@/server/db/schema";
import { addDays } from "@/shared/lib/store-time";

type Database = PostgresJsDatabase<typeof schema>;
export type SocialPostRow = typeof schema.socialPosts.$inferSelect;

export type SocialErrorCode =
  | "not_found"
  | "stale"
  | "blocked"
  | "invalid"
  | "not_connected"
  | "token_invalid"
  | "vault_missing";

export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorCode,
    readonly blockers: ApprovalBlocker[] = [],
  ) {
    super(code);
    this.name = "SocialError";
  }
}

export interface FeedRenderer {
  (input: {
    kind: PostKind;
    products: readonly SocialProduct[];
    photos: ReadonlyMap<string, Buffer>;
    catalog: SocialCatalog;
    tipId: ShoppingTipId | null;
    categoryName: string | null;
  }): Promise<Buffer>;
}

export interface ReelRenderer {
  (input: {
    template: ReelTemplate;
    products: readonly SocialProduct[];
    photos: ReadonlyMap<string, Buffer>;
    catalog: SocialCatalog;
  }): Promise<{ mp4: Buffer; poster: Buffer; seconds: number }>;
}

/** Optional AI wording; its output still has to pass the caption guard or the template is kept. */
export type CaptionWriter = (input: {
  item: Pick<PlannedItem, "kind" | "format" | "reelTemplate">;
  products: readonly SocialProduct[];
  draft: string;
  catalog: SocialCatalog;
}) => Promise<string | null>;

export interface SocialDependencies {
  database: Database;
  catalog: CatalogSource;
  media: SocialMediaStore;
  /** The public storefront address used in captions and links. */
  origin: string;
  vaultKey: () => Buffer;
  renderFeed: FeedRenderer;
  renderReel: ReelRenderer;
  loadImage: (url: string) => Promise<Buffer>;
  videoRenderingAvailable: () => Promise<boolean>;
  metaApp?: { appId: string; appSecret: string } | null;
  graphVersion?: string;
  fetch?: FetchLike;
  captionWriter?: CaptionWriter | null;
  now?: () => Date;
}

export interface PostView extends SocialPostRow {
  captionCheck: CaptionCheck;
  products: Array<{ id: string; name: string; available: boolean }>;
  blockers: ApprovalBlocker[];
}

const DAY = 86_400_000;

export function publishKey(
  post: Pick<SocialPostRow, "id" | "caption" | "mediaUrl">,
): string {
  return createHash("sha256")
    .update(`${post.id}\n${post.caption}\n${post.mediaUrl ?? ""}`)
    .digest("hex");
}

export class SocialService {
  private readonly db: Database;
  private readonly now: () => Date;

  constructor(private readonly deps: SocialDependencies) {
    this.db = deps.database;
    this.now = deps.now ?? (() => new Date());
  }

  private captionContext(catalog: SocialCatalog): CaptionContext {
    return { store: catalog.store, origin: this.deps.origin };
  }

  private async record(
    postId: string,
    event:
      PostEvent | "created" | "media_ready" | "media_failed" | "reconciled",
    actor: AdminActor | null,
    from: PostStatus | null,
    to: PostStatus | null,
    detail?: string,
    database: Database = this.db,
  ) {
    await database.insert(schema.socialPostEvents).values({
      postId,
      event,
      actorId: actor?.id ?? null,
      fromStatus: from,
      toStatus: to,
      detail: detail?.slice(0, 200) ?? null,
    });
  }

  // ---------------------------------------------------------------- settings & connection

  async settings() {
    const [row] = await this.db.select().from(schema.socialSettings).limit(1);
    return (
      row ?? {
        id: 1,
        autoPublishApproved: true,
        autoReplyFaq: false,
        paused: false,
        updatedBy: null,
        updatedAt: new Date(0),
      }
    );
  }

  async updateSettings(
    actor: AdminActor,
    input: {
      autoPublishApproved: boolean;
      autoReplyFaq: boolean;
      paused: boolean;
    },
  ) {
    assertPermission(actor, "social.approve");
    const before = await this.settings();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.socialSettings)
        .values({ id: 1, ...input, updatedBy: actor.id })
        .onConflictDoUpdate({
          target: schema.socialSettings.id,
          set: { ...input, updatedBy: actor.id, updatedAt: this.now() },
        });
      await tx.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "social_settings",
        entityType: "social",
        entityId: "settings",
        beforeState: {
          autoPublishApproved: before.autoPublishApproved,
          autoReplyFaq: before.autoReplyFaq,
          paused: before.paused,
        },
        afterState: input,
      });
    });
  }

  async connection() {
    const [row] = await this.db
      .select()
      .from(schema.socialConnections)
      .where(eq(schema.socialConnections.provider, "facebook"));
    return row ?? null;
  }

  /** A Page token from Facebook Login or a Business Manager system user; it is checked, then sealed. */
  async connectPage(
    actor: AdminActor,
    input: { pageId: string; pageName?: string | null; token: string },
  ) {
    assertPermission(actor, "social.approve");
    const pageId = input.pageId.trim();
    const token = input.token.trim();
    if (
      !/^\d{5,30}$/.test(pageId) ||
      token.length < 20 ||
      token.length > 1_000
    ) {
      throw new SocialError("invalid");
    }
    let expiresAt: Date | null = null;
    let scopes: string[] = [];
    if (this.deps.metaApp) {
      const inspection = await inspectToken({
        token,
        ...this.deps.metaApp,
        graphVersion: this.deps.graphVersion,
        fetch: this.deps.fetch,
      });
      if (!inspection.valid) throw new SocialError("token_invalid");
      expiresAt = inspection.expiresAt;
      scopes = inspection.scopes;
    }
    let sealed: string;
    try {
      sealed = sealToken(token, this.deps.vaultKey());
    } catch {
      throw new SocialError("vault_missing");
    }
    const values = {
      pageId,
      pageName: input.pageName?.trim().slice(0, 160) || null,
      tokenSealed: sealed,
      tokenHint: tokenHint(token),
      tokenExpiresAt: expiresAt,
      scopes,
      status: "connected" as const,
      lastCheckedAt: this.now(),
      connectedBy: actor.id,
      updatedAt: this.now(),
    };
    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.socialConnections)
        .values({ provider: "facebook", ...values })
        .onConflictDoUpdate({
          target: schema.socialConnections.provider,
          set: values,
        });
      await tx.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "social_connect",
        entityType: "social",
        entityId: "facebook",
        beforeState: null,
        afterState: {
          pageId,
          tokenHint: values.tokenHint,
          scopes: scopes.join(","),
        },
      });
    });
  }

  async disconnect(actor: AdminActor) {
    assertPermission(actor, "social.approve");
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.socialConnections)
        .where(eq(schema.socialConnections.provider, "facebook"));
      await tx.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "social_disconnect",
        entityType: "social",
        entityId: "facebook",
        beforeState: null,
        afterState: null,
      });
    });
  }

  private async metaClient(): Promise<MetaGraphClient | null> {
    const connection = await this.connection();
    if (!connection || connection.status !== "connected") return null;
    if (connection.tokenExpiresAt && connection.tokenExpiresAt <= this.now()) {
      await this.markConnection("expired");
      return null;
    }
    let pageToken: string;
    try {
      pageToken = openToken(connection.tokenSealed, this.deps.vaultKey());
    } catch {
      return null;
    }
    return new MetaGraphClient({
      pageId: connection.pageId,
      pageToken,
      graphVersion: this.deps.graphVersion,
      fetch: this.deps.fetch,
    });
  }

  private async markConnection(status: "expired" | "revoked") {
    await this.db
      .update(schema.socialConnections)
      .set({ status, lastCheckedAt: this.now(), updatedAt: this.now() })
      .where(eq(schema.socialConnections.provider, "facebook"));
  }

  /** Daily check: debug_token tells us about expiry and revocation before a publish fails. */
  async checkConnection(): Promise<
    "connected" | "expired" | "missing" | "unchecked"
  > {
    const connection = await this.connection();
    if (!connection) return "missing";
    if (!this.deps.metaApp) return "unchecked";
    let token: string;
    try {
      token = openToken(connection.tokenSealed, this.deps.vaultKey());
    } catch {
      await this.markConnection("revoked");
      return "expired";
    }
    const inspection = await inspectToken({
      token,
      ...this.deps.metaApp,
      graphVersion: this.deps.graphVersion,
      fetch: this.deps.fetch,
    });
    if (
      !inspection.valid ||
      (inspection.expiresAt && inspection.expiresAt <= this.now())
    ) {
      await this.markConnection("expired");
      return "expired";
    }
    await this.db
      .update(schema.socialConnections)
      .set({
        status: "connected",
        tokenExpiresAt: inspection.expiresAt,
        scopes: inspection.scopes,
        lastCheckedAt: this.now(),
        updatedAt: this.now(),
      })
      .where(eq(schema.socialConnections.provider, "facebook"));
    return "connected";
  }

  // ---------------------------------------------------------------- discovery & drafting

  /** Records products the first time they appear; the very first run is the baseline, not «new». */
  async discoverProducts(): Promise<{ products: number; newlySeen: number }> {
    const catalog = await this.deps.catalog();
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.socialCatalogSeen);
    const baseline = count === 0;
    const ids = [...catalog.knownProductIds];
    if (!ids.length) return { products: 0, newlySeen: 0 };
    const inserted = await this.db
      .insert(schema.socialCatalogSeen)
      .values(
        ids.map((productId) => ({
          productId,
          baseline,
          firstSeenAt: this.now(),
        })),
      )
      .onConflictDoNothing()
      .returning({ productId: schema.socialCatalogSeen.productId });
    return { products: ids.length, newlySeen: baseline ? 0 : inserted.length };
  }

  private async newArrivalIds(): Promise<string[]> {
    const rows = await this.db
      .select({ productId: schema.socialCatalogSeen.productId })
      .from(schema.socialCatalogSeen)
      .where(
        and(
          eq(schema.socialCatalogSeen.baseline, false),
          gte(
            schema.socialCatalogSeen.firstSeenAt,
            new Date(this.now().getTime() - 21 * DAY),
          ),
        ),
      );
    return rows.map((row) => row.productId);
  }

  captionFor(
    item: Pick<PlannedItem, "kind" | "format" | "reelTemplate" | "tipId">,
    products: readonly SocialProduct[],
    catalog: SocialCatalog,
    categoryName: string | null,
  ): string {
    const context = this.captionContext(catalog);
    if (item.format === "reel" && item.reelTemplate) {
      return reelCaption(item.reelTemplate, products, context);
    }
    switch (item.kind) {
      case "product":
        return productCaption(products[0]!, context);
      case "collection":
        return collectionCaption(
          `🧺 من قسم ${categoryName ?? ""} في مايثا ماركت`.replace(/\s+/g, " "),
          "متوفر هلأ:",
          products,
          context,
        );
      case "new_arrivals":
        return newArrivalsCaption(products, context);
      case "weekly_highlights":
        return weeklyHighlightsCaption(products, context);
      case "shopping_tip":
        return tipCaption(item.tipId ?? "combine-order", context);
      case "delivery_info":
        return deliveryCaption(context);
    }
  }

  /**
   * Fills the calendar with drafts. Running it twice adds nothing: a slot that already has a
   * post (other than a rejected one) is left alone.
   */
  async draftPlan(
    actor: AdminActor | null,
    input: { startDate: string; days: number },
  ): Promise<{ created: number; skipped: number }> {
    if (actor) assertPermission(actor, "social.prepare");
    if (input.days < 1 || input.days > 62) throw new SocialError("invalid");
    const catalog = await this.deps.catalog();
    const recentRows = await this.db
      .select({ productIds: schema.socialPosts.productIds })
      .from(schema.socialPosts)
      .where(
        and(
          ne(schema.socialPosts.status, "rejected"),
          gte(
            schema.socialPosts.createdAt,
            new Date(this.now().getTime() - 21 * DAY),
          ),
        ),
      );
    const recent = new Set(recentRows.flatMap((row) => row.productIds));
    const counts = await this.db
      .select({
        format: schema.socialPosts.format,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.socialPosts)
      .groupBy(schema.socialPosts.format);
    const countOf = (format: PostFormat) =>
      counts.find((row) => row.format === format)?.count ?? 0;
    const plan = buildContentPlan({
      startDate: input.startDate,
      days: input.days,
      products: catalog.products,
      recentProductIds: recent,
      newArrivalIds: await this.newArrivalIds(),
      cycleOffset: {
        post: countOf("image"),
        reel: countOf("reel"),
        tip: countOf("image"),
      },
    }).filter((item) => item.scheduledFor > this.now());
    if (!plan.length) return { created: 0, skipped: 0 };

    const existing = await this.db
      .select({
        format: schema.socialPosts.format,
        scheduledFor: schema.socialPosts.scheduledFor,
      })
      .from(schema.socialPosts)
      .where(
        and(
          ne(schema.socialPosts.status, "rejected"),
          gte(schema.socialPosts.scheduledFor, plan[0]!.scheduledFor),
          lte(schema.socialPosts.scheduledFor, plan.at(-1)!.scheduledFor),
        ),
      );
    const taken = new Set(
      existing.map((row) => `${row.format}@${row.scheduledFor?.toISOString()}`),
    );
    const byId = new Map(
      catalog.products.map((product) => [product.id, product]),
    );
    const categoryNames = new Map(
      catalog.products.map((product) => [
        product.categoryCode,
        product.categoryName,
      ]),
    );
    let created = 0;
    let skipped = 0;
    for (const item of plan) {
      if (taken.has(`${item.format}@${item.scheduledFor.toISOString()}`)) {
        skipped += 1;
        continue;
      }
      const products = item.productIds
        .map((id) => byId.get(id))
        .filter((product): product is SocialProduct => Boolean(product));
      const categoryName = item.categoryCode
        ? (categoryNames.get(item.categoryCode) ?? null)
        : null;
      const template = this.captionFor(item, products, catalog, categoryName);
      let caption = template;
      let source: "template" | "ai" = "template";
      if (this.deps.captionWriter) {
        try {
          const written = await this.deps.captionWriter({
            item,
            products,
            draft: template,
            catalog,
          });
          if (
            written &&
            checkCaption(
              written,
              allowedPrices(products, catalog.store),
              catalogText(products),
            ).ok
          ) {
            caption = written;
            source = "ai";
          }
        } catch {
          // The template caption is already correct; the AI is only a nicer wording.
        }
      }
      const [post] = await this.db
        .insert(schema.socialPosts)
        .values({
          format: item.format,
          kind: item.kind,
          reelTemplate: item.reelTemplate,
          productIds: item.productIds,
          tipId: item.tipId,
          categoryCode: item.categoryCode,
          caption,
          captionSource: source,
          scheduledFor: item.scheduledFor,
        })
        .returning({ id: schema.socialPosts.id });
      await this.record(post!.id, "created", actor, null, "draft", source);
      created += 1;
    }
    return { created, skipped };
  }

  // ---------------------------------------------------------------- rendering

  async renderPending(
    limit = 10,
  ): Promise<{ rendered: number; failed: number; waiting: number }> {
    const pending = await this.db
      .select()
      .from(schema.socialPosts)
      .where(
        and(
          eq(schema.socialPosts.mediaStatus, "pending"),
          eq(schema.socialPosts.status, "draft"),
        ),
      )
      .orderBy(asc(schema.socialPosts.scheduledFor))
      .limit(limit);
    if (!pending.length) return { rendered: 0, failed: 0, waiting: 0 };
    const catalog = await this.deps.catalog();
    const byId = new Map(
      catalog.products.map((product) => [product.id, product]),
    );
    const videoReady = pending.some((post) => post.format === "reel")
      ? await this.deps.videoRenderingAvailable()
      : false;
    const photoCache = new Map<string, Buffer>();
    let rendered = 0;
    let failed = 0;
    let waiting = 0;
    for (const post of pending) {
      if (post.format === "reel" && !videoReady) {
        waiting += 1;
        continue;
      }
      const products = post.productIds.map((id) => byId.get(id));
      if (products.some((product) => !product)) {
        await this.setMedia(post, "failed", {
          mediaError: "PRODUCT_UNAVAILABLE",
        });
        failed += 1;
        continue;
      }
      const available = products as SocialProduct[];
      try {
        const photos = new Map<string, Buffer>();
        for (const product of available) {
          const cached =
            photoCache.get(product.imageUrl) ??
            (await this.deps.loadImage(product.imageUrl));
          photoCache.set(product.imageUrl, cached);
          photos.set(product.id, cached);
        }
        const categoryName = post.categoryCode
          ? (available.find(
              (product) => product.categoryCode === post.categoryCode,
            )?.categoryName ?? null)
          : null;
        if (post.format === "reel") {
          const reel = await this.deps.renderReel({
            template: (post.reelTemplate ?? "spotlight") as ReelTemplate,
            products: available,
            photos,
            catalog,
          });
          const [mediaUrl, posterUrl] = await Promise.all([
            this.deps.media.put(reel.mp4, "mp4"),
            this.deps.media.put(reel.poster, "jpg"),
          ]);
          await this.setMedia(post, "ready", {
            mediaUrl,
            posterUrl,
            mediaSeconds: Math.round(reel.seconds),
          });
        } else {
          const image = await this.deps.renderFeed({
            kind: post.kind as PostKind,
            products: available,
            photos,
            catalog,
            tipId: post.tipId as ShoppingTipId | null,
            categoryName,
          });
          const mediaUrl = await this.deps.media.put(image, "jpg");
          await this.setMedia(post, "ready", { mediaUrl, posterUrl: mediaUrl });
        }
        rendered += 1;
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z_]{3,40}$/.test(error.message)
            ? error.message
            : "RENDER_FAILED";
        await this.setMedia(post, "failed", { mediaError: code });
        failed += 1;
      }
    }
    return { rendered, failed, waiting };
  }

  private async setMedia(
    post: SocialPostRow,
    status: MediaStatus,
    values: {
      mediaUrl?: string;
      posterUrl?: string;
      mediaSeconds?: number;
      mediaError?: string;
    },
  ) {
    await this.db
      .update(schema.socialPosts)
      .set({
        mediaStatus: status,
        mediaUrl: values.mediaUrl ?? null,
        posterUrl: values.posterUrl ?? null,
        mediaSeconds: values.mediaSeconds ?? null,
        mediaError: values.mediaError ?? null,
        updatedAt: this.now(),
        version: sql`${schema.socialPosts.version} + 1`,
      })
      .where(
        and(
          eq(schema.socialPosts.id, post.id),
          eq(schema.socialPosts.status, "draft"),
        ),
      );
    await this.record(
      post.id,
      status === "ready" ? "media_ready" : "media_failed",
      null,
      null,
      null,
      values.mediaError,
    );
  }

  // ---------------------------------------------------------------- owner decisions

  private async load(id: string): Promise<SocialPostRow> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new SocialError("not_found");
    const [post] = await this.db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, id));
    if (!post) throw new SocialError("not_found");
    return post;
  }

  private evaluate(post: SocialPostRow, catalog: SocialCatalog) {
    const byId = new Map(
      catalog.products.map((product) => [product.id, product]),
    );
    const products = post.productIds.map((id) => byId.get(id));
    const known = products.filter((product): product is SocialProduct =>
      Boolean(product),
    );
    const captionCheck = checkCaption(
      post.caption,
      allowedPrices(known, catalog.store),
      catalogText(known),
    );
    const productsAvailable = known.length === post.productIds.length;
    return {
      captionCheck,
      productsAvailable,
      products: post.productIds.map((id) => ({
        id,
        name: byId.get(id)?.name ?? id,
        available: byId.has(id),
      })),
      blockers: approvalBlockers({
        status: post.status as PostStatus,
        mediaStatus: post.mediaStatus as MediaStatus,
        captionOk: captionCheck.ok,
        productsAvailable,
        scheduledFor: post.scheduledFor,
        now: this.now(),
      }),
    };
  }

  async view(actor: AdminActor, id: string): Promise<PostView> {
    assertPermission(actor, "social.view");
    const post = await this.load(id);
    const evaluation = this.evaluate(post, await this.deps.catalog());
    return { ...post, ...evaluation };
  }

  private async transition(
    actor: AdminActor | null,
    post: SocialPostRow,
    event: PostEvent,
    expectedVersion: number,
    set: Partial<typeof schema.socialPosts.$inferInsert> = {},
    detail?: string,
  ): Promise<void> {
    const from = post.status as PostStatus;
    const to = nextStatus(from, event);
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.socialPosts)
        .set({
          ...set,
          status: to,
          updatedAt: this.now(),
          version: expectedVersion + 1,
        })
        .where(
          and(
            eq(schema.socialPosts.id, post.id),
            eq(schema.socialPosts.version, expectedVersion),
            eq(schema.socialPosts.status, from),
          ),
        )
        .returning({ id: schema.socialPosts.id });
      if (!updated.length) throw new SocialError("stale");
      await this.record(
        post.id,
        event,
        actor,
        from,
        to,
        detail,
        tx as unknown as Database,
      );
    });
  }

  /** The only door to Facebook: the owner approves the exact caption and media, checked against the live catalog. */
  async approve(actor: AdminActor, id: string, version: number) {
    assertPermission(actor, "social.approve");
    const post = await this.load(id);
    if (post.version !== version) throw new SocialError("stale");
    const evaluation = this.evaluate(post, await this.deps.catalog());
    if (evaluation.blockers.length)
      throw new SocialError("blocked", evaluation.blockers);
    await this.transition(actor, post, "approve", version, {
      approvedBy: actor.id,
      approvedAt: this.now(),
      publishKey: publishKey(post),
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
    });
  }

  async unapprove(actor: AdminActor, id: string, version: number) {
    assertPermission(actor, "social.approve");
    const post = await this.load(id);
    await this.transition(actor, post, "unapprove", version, {
      approvedBy: null,
      approvedAt: null,
      publishKey: null,
    });
  }

  async reject(actor: AdminActor, id: string, version: number) {
    assertPermission(actor, "social.prepare");
    const post = await this.load(id);
    // Taking back an approved post is the owner's decision.
    if (post.status !== "draft") assertPermission(actor, "social.approve");
    await this.transition(actor, post, "reject", version, {
      approvedBy: null,
      approvedAt: null,
      publishKey: null,
    });
  }

  async reopen(actor: AdminActor, id: string, version: number) {
    assertPermission(actor, "social.prepare");
    const post = await this.load(id);
    await this.transition(actor, post, "reopen", version, {
      approvedBy: null,
      approvedAt: null,
      publishKey: null,
      claimToken: null,
      claimedAt: null,
    });
  }

  async retryFailed(actor: AdminActor, id: string, version: number) {
    assertPermission(actor, "social.approve");
    const post = await this.load(id);
    if (post.metaObjectId) throw new SocialError("invalid");
    await this.transition(actor, post, "retry_manually", version, {
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      approvedBy: actor.id,
      approvedAt: this.now(),
      scheduledFor:
        post.scheduledFor && post.scheduledFor > this.now()
          ? post.scheduledFor
          : this.now(),
    });
  }

  async editCaption(
    actor: AdminActor,
    id: string,
    version: number,
    caption: string,
  ) {
    assertPermission(actor, "social.prepare");
    const text = caption.replace(/\r\n/g, "\n").trim();
    if (!text || text.length > 2_000) throw new SocialError("invalid");
    const post = await this.load(id);
    await this.transition(
      actor,
      post,
      "edit",
      version,
      { caption: text, captionSource: "owner" },
      "caption",
    );
  }

  async reschedule(actor: AdminActor, id: string, version: number, when: Date) {
    assertPermission(actor, "social.prepare");
    if (Number.isNaN(when.getTime()) || when < this.now())
      throw new SocialError("invalid");
    const post = await this.load(id);
    if (post.status !== "draft") throw new SocialError("invalid");
    await this.transition(
      actor,
      post,
      "edit",
      version,
      { scheduledFor: when },
      "schedule",
    );
  }

  async rerender(actor: AdminActor, id: string, version: number) {
    assertPermission(actor, "social.prepare");
    const post = await this.load(id);
    await this.transition(
      actor,
      post,
      "edit",
      version,
      {
        mediaStatus: "pending",
        mediaUrl: null,
        posterUrl: null,
        mediaError: null,
      },
      "rerender",
    );
  }

  // ---------------------------------------------------------------- publishing

  /**
   * Claims one due post. The conditional update is the lock: two workers can never both hold it,
   * and a post that is not approved can never be claimed.
   */
  private async claim(post: SocialPostRow): Promise<string | null> {
    const token = randomUUID();
    const claimed = await this.db
      .update(schema.socialPosts)
      .set({
        status: nextStatus(post.status as PostStatus, "claim"),
        claimToken: token,
        claimedAt: this.now(),
        attempts: sql`${schema.socialPosts.attempts} + 1`,
        updatedAt: this.now(),
        version: sql`${schema.socialPosts.version} + 1`,
      })
      .where(
        and(
          eq(schema.socialPosts.id, post.id),
          eq(schema.socialPosts.version, post.version),
          inArray(schema.socialPosts.status, ["approved", "retry_wait"]),
          isNotNull(schema.socialPosts.approvedBy),
          isNull(schema.socialPosts.metaObjectId),
        ),
      )
      .returning({ id: schema.socialPosts.id });
    if (!claimed.length) return null;
    await this.record(
      post.id,
      "claim",
      null,
      post.status as PostStatus,
      "publishing",
      `attempt ${post.attempts + 1}`,
    );
    return token;
  }

  private async finishClaim(
    post: SocialPostRow,
    token: string,
    event: "succeed" | "fail_retryable" | "fail_permanent",
    set: Partial<typeof schema.socialPosts.$inferInsert>,
    detail?: string,
  ) {
    const to = nextStatus("publishing", event);
    await this.db
      .update(schema.socialPosts)
      .set({
        ...set,
        status: to,
        claimToken: null,
        updatedAt: this.now(),
        version: sql`${schema.socialPosts.version} + 1`,
      })
      .where(
        and(
          eq(schema.socialPosts.id, post.id),
          eq(schema.socialPosts.claimToken, token),
        ),
      );
    await this.record(post.id, event, null, "publishing", to, detail);
  }

  private async failClaim(
    post: SocialPostRow,
    token: string,
    failure: MetaFailure | { kind: "local"; code: string },
  ) {
    const attempts = post.attempts + 1;
    const code =
      failure.kind === "local"
        ? failure.code
        : `META_${failure.kind.toUpperCase()}${failure.code ? `_${failure.code}` : ""}`;
    if (failure.kind !== "local" && failure.kind === "auth")
      await this.markConnection("expired");
    if (
      failure.kind !== "local" &&
      isRetryable(failure) &&
      attempts < MAX_PUBLISH_ATTEMPTS
    ) {
      await this.finishClaim(
        post,
        token,
        "fail_retryable",
        {
          lastErrorCode: code,
          nextAttemptAt: new Date(
            this.now().getTime() + retryDelayMs(attempts, failure.retryAfterMs),
          ),
        },
        code,
      );
      return;
    }
    await this.finishClaim(
      post,
      token,
      "fail_permanent",
      { lastErrorCode: code, nextAttemptAt: null },
      code,
    );
  }

  async publishDue(limit = 5): Promise<{
    published: number;
    failed: number;
    retrying: number;
    skipped?: string;
  }> {
    const settings = await this.settings();
    if (settings.paused)
      return { published: 0, failed: 0, retrying: 0, skipped: "paused" };
    if (!settings.autoPublishApproved)
      return { published: 0, failed: 0, retrying: 0, skipped: "manual_mode" };
    const now = this.now();
    const due = await this.db
      .select()
      .from(schema.socialPosts)
      .where(
        or(
          and(
            eq(schema.socialPosts.status, "approved"),
            lte(schema.socialPosts.scheduledFor, now),
          ),
          and(
            eq(schema.socialPosts.status, "retry_wait"),
            lte(schema.socialPosts.nextAttemptAt, now),
          ),
        ),
      )
      .orderBy(asc(schema.socialPosts.scheduledFor))
      .limit(limit);
    if (!due.length) return { published: 0, failed: 0, retrying: 0 };
    const client = await this.metaClient();
    if (!client)
      return { published: 0, failed: 0, retrying: 0, skipped: "not_connected" };
    const catalog = await this.deps.catalog();
    const available = new Set(catalog.products.map((product) => product.id));
    let published = 0;
    let failed = 0;
    let retrying = 0;
    for (const post of due) {
      const token = await this.claim(post);
      if (!token) continue;
      // Re-checked at the last moment: a product sold out after approval is never advertised.
      if (post.productIds.some((id) => !available.has(id))) {
        await this.failClaim(post, token, {
          kind: "local",
          code: "PRODUCT_UNAVAILABLE",
        });
        failed += 1;
        continue;
      }
      if (
        post.publishKey !== publishKey(post) ||
        !isPublishableMediaUrl(post.mediaUrl)
      ) {
        await this.failClaim(post, token, {
          kind: "local",
          code:
            post.publishKey !== publishKey(post)
              ? "CONTENT_CHANGED"
              : "MEDIA_NOT_PUBLIC",
        });
        failed += 1;
        continue;
      }
      try {
        const ref =
          post.format === "reel"
            ? await client.publishReel({
                videoUrl: post.mediaUrl,
                caption: post.caption,
              })
            : await client.publishPhoto({
                imageUrl: post.mediaUrl,
                caption: post.caption,
              });
        await this.finishClaim(
          post,
          token,
          "succeed",
          {
            metaObjectId: ref.objectId,
            metaPostId: ref.postId ?? ref.objectId,
            publishedAt: this.now(),
            lastErrorCode: null,
            nextAttemptAt: null,
          },
          ref.postId ?? ref.objectId,
        );
        published += 1;
      } catch (error) {
        const failure: MetaFailure =
          error instanceof MetaApiError
            ? error.failure
            : { kind: "transient", code: null, subcode: null };
        await this.failClaim(post, token, failure);
        if (isRetryable(failure) && post.attempts + 1 < MAX_PUBLISH_ATTEMPTS)
          retrying += 1;
        else failed += 1;
        // Throttled or signed out: further calls in this run would fail the same way.
        if (failure.kind === "rate_limit" || failure.kind === "auth") break;
      }
    }
    return { published, failed, retrying };
  }

  /**
   * A claim that never finished (crash, timeout) may or may not have reached Facebook. We look at the
   * Page's recent posts first; only when the caption is not there is the post queued again.
   */
  async reconcileStale(): Promise<{ recovered: number; requeued: number }> {
    const cutoff = new Date(this.now().getTime() - STALE_CLAIM_MS);
    const stale = await this.db
      .select()
      .from(schema.socialPosts)
      .where(
        and(
          eq(schema.socialPosts.status, "publishing"),
          lte(schema.socialPosts.claimedAt, cutoff),
        ),
      );
    if (!stale.length) return { recovered: 0, requeued: 0 };
    const client = await this.metaClient();
    if (!client) return { recovered: 0, requeued: 0 };
    let recovered = 0;
    let requeued = 0;
    for (const post of stale) {
      const since = new Date((post.claimedAt ?? cutoff).getTime() - 2 * 60_000);
      const found = (await client.recentPosts(since)).find(
        (candidate) => candidate.message.trim() === post.caption.trim(),
      );
      if (found) {
        await this.finishClaim(
          post,
          post.claimToken!,
          "succeed",
          {
            metaObjectId: found.id,
            metaPostId: found.id,
            publishedAt: post.claimedAt ?? this.now(),
          },
          "reconciled",
        );
        recovered += 1;
      } else {
        await this.failClaim(post, post.claimToken!, {
          kind: "transient",
          code: null,
          subcode: null,
        });
        requeued += 1;
      }
    }
    return { recovered, requeued };
  }

  // ---------------------------------------------------------------- engagement & community

  async refreshEngagement(days = 30): Promise<{ updated: number }> {
    const client = await this.metaClient();
    if (!client) return { updated: 0 };
    const posts = await this.db
      .select({
        id: schema.socialPosts.id,
        metaPostId: schema.socialPosts.metaPostId,
      })
      .from(schema.socialPosts)
      .where(
        and(
          eq(schema.socialPosts.status, "published"),
          gte(
            schema.socialPosts.publishedAt,
            new Date(this.now().getTime() - days * DAY),
          ),
        ),
      );
    let updated = 0;
    for (const post of posts) {
      if (!post.metaPostId) continue;
      try {
        const engagement = await client.engagement(post.metaPostId);
        await this.db
          .insert(schema.socialEngagement)
          .values({ postId: post.id, ...engagement, fetchedAt: this.now() })
          .onConflictDoUpdate({
            target: schema.socialEngagement.postId,
            set: { ...engagement, fetchedAt: this.now() },
          });
        updated += 1;
      } catch (error) {
        if (
          error instanceof MetaApiError &&
          (error.failure.kind === "rate_limit" || error.failure.kind === "auth")
        )
          break;
      }
    }
    return { updated };
  }

  /**
   * New comments on our recent posts. A verified store-rule question may get the fixed answer (only
   * when the owner turned automatic replies on); everything else is listed for the owner.
   */
  async syncComments(): Promise<{
    seen: number;
    replied: number;
    escalated: number;
  }> {
    const client = await this.metaClient();
    const connection = await this.connection();
    if (!client || !connection) return { seen: 0, replied: 0, escalated: 0 };
    const settings = await this.settings();
    const catalog = await this.deps.catalog();
    const posts = await this.db
      .select({
        id: schema.socialPosts.id,
        metaPostId: schema.socialPosts.metaPostId,
      })
      .from(schema.socialPosts)
      .where(
        and(
          eq(schema.socialPosts.status, "published"),
          gte(
            schema.socialPosts.publishedAt,
            new Date(this.now().getTime() - 14 * DAY),
          ),
        ),
      );
    let seen = 0;
    let replied = 0;
    let escalated = 0;
    for (const post of posts) {
      if (!post.metaPostId) continue;
      const comments = await client.comments(post.metaPostId);
      if (!comments.length) continue;
      const known = new Set(
        (
          await this.db
            .select({ id: schema.socialComments.id })
            .from(schema.socialComments)
            .where(
              inArray(
                schema.socialComments.id,
                comments.map((comment) => comment.id),
              ),
            )
        ).map((row) => row.id),
      );
      for (const comment of comments) {
        if (known.has(comment.id) || comment.fromId === connection.pageId)
          continue;
        seen += 1;
        const decision = decideComment(
          comment.message,
          catalog.store,
          this.deps.origin,
        );
        let replyStatus: "pending" | "sent" | "failed" | "skipped" | "held" =
          "skipped";
        let replyMetaId: string | null = null;
        if (decision.action === "reply") {
          replyStatus = "held";
          if (settings.autoReplyFaq && !settings.paused && replied < 20) {
            try {
              replyMetaId = await client.replyToComment(
                comment.id,
                decision.reply,
              );
              replyStatus = "sent";
              replied += 1;
            } catch {
              replyStatus = "failed";
            }
          }
        }
        if (decision.action === "escalate") escalated += 1;
        await this.db
          .insert(schema.socialComments)
          .values({
            id: comment.id,
            postId: post.id,
            authorName: comment.fromName?.slice(0, 120) ?? null,
            message: comment.message.slice(0, 4_000),
            commentedAt: new Date(comment.createdAt),
            decision: decision.action,
            reason:
              decision.action === "escalate"
                ? decision.reason
                : decision.action === "reply"
                  ? decision.faqId
                  : null,
            replyText: decision.action === "reply" ? decision.reply : null,
            replyStatus,
            replyMetaId,
          })
          .onConflictDoNothing();
      }
    }
    return { seen, replied, escalated };
  }

  async resolveComment(actor: AdminActor, id: string) {
    assertPermission(actor, "social.prepare");
    await this.db
      .update(schema.socialComments)
      .set({ resolvedBy: actor.id, resolvedAt: this.now() })
      .where(
        and(
          eq(schema.socialComments.id, id),
          isNull(schema.socialComments.resolvedAt),
        ),
      );
  }

  /** The owner may send a held verified answer after reading it. */
  async sendHeldReply(actor: AdminActor, id: string) {
    assertPermission(actor, "social.approve");
    const [comment] = await this.db
      .select()
      .from(schema.socialComments)
      .where(eq(schema.socialComments.id, id));
    if (
      !comment ||
      comment.decision !== "reply" ||
      comment.replyStatus === "sent" ||
      !comment.replyText
    ) {
      throw new SocialError("invalid");
    }
    const client = await this.metaClient();
    if (!client) throw new SocialError("not_connected");
    const replyMetaId = await client.replyToComment(
      comment.id,
      comment.replyText,
    );
    await this.db
      .update(schema.socialComments)
      .set({
        replyStatus: "sent",
        replyMetaId,
        resolvedBy: actor.id,
        resolvedAt: this.now(),
      })
      .where(eq(schema.socialComments.id, id));
  }

  // ---------------------------------------------------------------- reading for the dashboard

  async listPosts(
    actor: AdminActor,
    filter: {
      statuses?: PostStatus[];
      from?: Date;
      to?: Date;
      limit?: number;
    } = {},
  ) {
    assertPermission(actor, "social.view");
    const conditions = [];
    if (filter.statuses?.length)
      conditions.push(inArray(schema.socialPosts.status, filter.statuses));
    if (filter.from)
      conditions.push(gte(schema.socialPosts.scheduledFor, filter.from));
    if (filter.to)
      conditions.push(lte(schema.socialPosts.scheduledFor, filter.to));
    return this.db
      .select({
        post: schema.socialPosts,
        engagement: schema.socialEngagement,
      })
      .from(schema.socialPosts)
      .leftJoin(
        schema.socialEngagement,
        eq(schema.socialEngagement.postId, schema.socialPosts.id),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(schema.socialPosts.scheduledFor))
      .limit(filter.limit ?? 200);
  }

  async events(actor: AdminActor, postId: string) {
    assertPermission(actor, "social.view");
    return this.db
      .select({
        event: schema.socialPostEvents,
        actorName: schema.adminUsers.displayName,
      })
      .from(schema.socialPostEvents)
      .leftJoin(
        schema.adminUsers,
        eq(schema.adminUsers.id, schema.socialPostEvents.actorId),
      )
      .where(eq(schema.socialPostEvents.postId, postId))
      .orderBy(desc(schema.socialPostEvents.createdAt))
      .limit(50);
  }

  async statusCounts(actor: AdminActor) {
    assertPermission(actor, "social.view");
    const rows = await this.db
      .select({
        status: schema.socialPosts.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.socialPosts)
      .groupBy(schema.socialPosts.status);
    return Object.fromEntries(
      rows.map((row) => [row.status, row.count]),
    ) as Partial<Record<PostStatus, number>>;
  }

  async openComments(actor: AdminActor) {
    assertPermission(actor, "social.view");
    return this.db
      .select({
        comment: schema.socialComments,
        caption: schema.socialPosts.caption,
      })
      .from(schema.socialComments)
      .innerJoin(
        schema.socialPosts,
        eq(schema.socialPosts.id, schema.socialComments.postId),
      )
      .where(
        and(
          isNull(schema.socialComments.resolvedAt),
          or(
            eq(schema.socialComments.decision, "escalate"),
            and(
              eq(schema.socialComments.decision, "reply"),
              ne(schema.socialComments.replyStatus, "sent"),
            ),
          ),
        ),
      )
      .orderBy(desc(schema.socialComments.commentedAt))
      .limit(100);
  }

  async jobRuns(actor: AdminActor, limit = 30) {
    assertPermission(actor, "social.view");
    return this.db
      .select()
      .from(schema.socialJobRuns)
      .orderBy(desc(schema.socialJobRuns.startedAt))
      .limit(limit);
  }

  /** The weekly report: what went out, how people responded, and what needs the owner. */
  async weeklyReport(endDate: string) {
    const startDate = addDays(endDate, -7);
    const from = new Date(`${startDate}T00:00:00Z`);
    const to = new Date(`${endDate}T23:59:59Z`);
    const published = await this.db
      .select({ post: schema.socialPosts, engagement: schema.socialEngagement })
      .from(schema.socialPosts)
      .leftJoin(
        schema.socialEngagement,
        eq(schema.socialEngagement.postId, schema.socialPosts.id),
      )
      .where(
        and(
          eq(schema.socialPosts.status, "published"),
          gte(schema.socialPosts.publishedAt, from),
          lte(schema.socialPosts.publishedAt, to),
        ),
      );
    const failed = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.socialPosts)
      .where(
        and(
          eq(schema.socialPosts.status, "failed"),
          gte(schema.socialPosts.updatedAt, from),
        ),
      );
    const open = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.socialComments)
      .where(
        and(
          eq(schema.socialComments.decision, "escalate"),
          isNull(schema.socialComments.resolvedAt),
        ),
      );
    const total = (key: "reactions" | "comments" | "shares") =>
      published.reduce((sum, row) => sum + (row.engagement?.[key] ?? 0), 0);
    const reachValues = published
      .map((row) => row.engagement?.reach)
      .filter((value): value is number => typeof value === "number");
    const best = [...published].sort(
      (a, b) =>
        (b.engagement?.reactions ?? 0) +
        (b.engagement?.comments ?? 0) +
        (b.engagement?.shares ?? 0) -
        ((a.engagement?.reactions ?? 0) +
          (a.engagement?.comments ?? 0) +
          (a.engagement?.shares ?? 0)),
    )[0];
    return {
      startDate,
      endDate,
      posts: published.filter((row) => row.post.format === "image").length,
      reels: published.filter((row) => row.post.format === "reel").length,
      reactions: total("reactions"),
      comments: total("comments"),
      shares: total("shares"),
      reach: reachValues.length
        ? reachValues.reduce((sum, value) => sum + value, 0)
        : null,
      failed: failed[0]?.count ?? 0,
      openEscalations: open[0]?.count ?? 0,
      bestPostId: best?.post.id ?? null,
    };
  }
}
