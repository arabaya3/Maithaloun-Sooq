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
  tokenProblems,
  type FetchLike,
} from "@/features/social/infrastructure/meta-graph-client";
import {
  openToken,
  sealToken,
  tokenHint,
} from "@/features/social/infrastructure/token-vault";
import type {
  PageLookup,
  Publisher,
  PublisherName,
} from "@/features/social/domain/publisher";
import type { MediaProblem } from "@/features/social/infrastructure/media-check";
import { MetaPublisher } from "@/features/social/infrastructure/meta-publisher";
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
  | "vault_missing"
  | "meta_app_missing"
  | "token_wrong_app"
  | "token_wrong_page"
  | "token_missing_scopes"
  | "already_published"
  | "still_processing"
  | "confirm_absent_required"
  | "not_uncertain";

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
  /** Refuse to store a Page token that could not be checked with debug_token (production). */
  requireTokenCheck?: boolean;
  graphVersion?: string;
  fetch?: FetchLike;
  captionWriter?: CaptionWriter | null;
  now?: () => Date;
  /** Which publisher sends approved posts: the direct Meta integration (default) or Make. */
  publisherName?: PublisherName;
  /** The configured Make publisher, or null when Make is not (fully) configured. */
  makePublisher?: Publisher | null;
  /** Checks a media URL is public and valid before it is handed over; omitted in tests. */
  checkMedia?: (
    url: string,
    kind: "image" | "video",
  ) => Promise<MediaProblem | null>;
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
      | PostEvent
      | "created"
      | "media_ready"
      | "media_failed"
      | "reconciled"
      | "uncertain"
      | "handed_off"
      | "owner_resolved"
      | "provider_confirmed",
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
        // Automatic publishing is off until the owner turns it on.
        autoPublishApproved: false,
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
      // The token must be ours: issued to our app, for this Page, with every permission we use.
      const problems = tokenProblems(inspection, {
        appId: this.deps.metaApp.appId,
        pageId,
      });
      if (problems.includes("invalid")) throw new SocialError("token_invalid");
      if (problems.includes("wrong_app"))
        throw new SocialError("token_wrong_app");
      if (problems.includes("wrong_page"))
        throw new SocialError("token_wrong_page");
      if (problems.includes("missing_scopes")) {
        throw new SocialError("token_missing_scopes");
      }
      expiresAt = inspection.expiresAt;
      scopes = inspection.scopes;
    } else if (this.deps.requireTokenCheck) {
      // In production an unchecked token is never stored.
      throw new SocialError("meta_app_missing");
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
      appSecret: this.deps.metaApp?.appSecret,
      graphVersion: this.deps.graphVersion,
      fetch: this.deps.fetch,
    });
  }

  /** The configured publisher, or null when it cannot publish right now (not connected/configured). */
  private async publisher(): Promise<Publisher | null> {
    if ((this.deps.publisherName ?? "meta") === "make") {
      return this.deps.makePublisher ?? null;
    }
    const client = await this.metaClient();
    return client ? new MetaPublisher(client) : null;
  }

  publisherName(): PublisherName {
    return this.deps.publisherName ?? "meta";
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
    const problems = tokenProblems(inspection, {
      appId: this.deps.metaApp.appId,
      pageId: connection.pageId,
    });
    if (
      problems.includes("invalid") ||
      problems.includes("wrong_app") ||
      problems.includes("wrong_page") ||
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
    options: { onlyPostId?: string } = {},
  ): Promise<{ rendered: number; failed: number; waiting: number }> {
    const pending = await this.db
      .select()
      .from(schema.socialPosts)
      .where(
        and(
          eq(schema.socialPosts.mediaStatus, "pending"),
          eq(schema.socialPosts.status, "draft"),
          options.onlyPostId
            ? eq(schema.socialPosts.id, options.onlyPostId)
            : undefined,
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
          // Meta accepts page photos up to 4 MB.
          if (image.byteLength > 4_000_000) throw new Error("IMAGE_TOO_LARGE");
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

  /**
   * The owner's «أعيدي المحاولة». A post that may already be on the Page is looked up first; when the
   * publisher cannot look (Make), the owner must confirm they checked the Page themselves.
   */
  async retryFailed(
    actor: AdminActor,
    id: string,
    version: number,
    options: { confirmedAbsent?: boolean } = {},
  ) {
    assertPermission(actor, "social.approve");
    const post = await this.load(id);
    if (post.metaObjectId) throw new SocialError("invalid");
    if (post.version !== version) throw new SocialError("stale");
    const mayBeOnPage =
      (post.attempts > 0 || post.metaUploadId !== null) &&
      post.lastErrorCode !== "OWNER_CONFIRMED_NOT_PUBLISHED";
    if (mayBeOnPage) {
      const publisher = await this.publisher();
      if (!publisher) throw new SocialError("not_connected");
      const found = await this.findOnPage(publisher, post);
      if (found.state === "published") {
        await this.markReconciled(post, found.id, actor);
        throw new SocialError("already_published");
      }
      if (found.state === "processing")
        throw new SocialError("still_processing");
      if (found.state === "unknown" && !options.confirmedAbsent) {
        throw new SocialError("confirm_absent_required");
      }
    }
    await this.transition(actor, post, "retry_manually", version, {
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      metaUploadId: null,
      providerRef: null,
      approvedBy: actor.id,
      approvedAt: this.now(),
      scheduledFor:
        post.scheduledFor && post.scheduledFor > this.now()
          ? post.scheduledFor
          : this.now(),
    });
  }

  /**
   * The owner settles a post whose Facebook result is unknown (handed to Make without confirmation,
   * or a lost answer), after looking at the Page. Only a post no worker is actively sending.
   */
  async resolveUncertain(
    actor: AdminActor,
    id: string,
    version: number,
    outcome:
      { published: true; facebookPostId?: string } | { published: false },
  ) {
    assertPermission(actor, "social.approve");
    const post = await this.load(id);
    if (post.version !== version) throw new SocialError("stale");
    const settled =
      post.status === "publishing" &&
      (post.lastErrorCode !== null ||
        (post.claimedAt !== null &&
          post.claimedAt.getTime() <= this.now().getTime() - STALE_CLAIM_MS));
    if (!settled) throw new SocialError("not_uncertain");
    if (outcome.published) {
      const reference = outcome.facebookPostId?.trim();
      if (reference && !/^[0-9_]{5,60}$/.test(reference)) {
        throw new SocialError("invalid");
      }
      await this.markReconciled(
        post,
        reference || `owner-confirmed:${post.id}`,
        actor,
        "owner_resolved",
      );
      return;
    }
    const updated = await this.db
      .update(schema.socialPosts)
      .set({
        status: nextStatus("publishing", "fail_permanent"),
        claimToken: null,
        lastErrorCode: "OWNER_CONFIRMED_NOT_PUBLISHED",
        nextAttemptAt: null,
        updatedAt: this.now(),
        version: sql`${schema.socialPosts.version} + 1`,
      })
      .where(
        and(
          eq(schema.socialPosts.id, post.id),
          eq(schema.socialPosts.version, version),
          eq(schema.socialPosts.status, "publishing"),
        ),
      )
      .returning({ id: schema.socialPosts.id });
    if (!updated.length) throw new SocialError("stale");
    await this.record(
      post.id,
      "owner_resolved",
      actor,
      "publishing",
      "failed",
      "not_published",
    );
  }

  /**
   * Facebook's result reported by the Make scenario. It must name a post we handed over, with the
   * same approval key; anything else is ignored. «partial» stays for the owner to settle.
   */
  async confirmFromProvider(report: {
    postId: string;
    idempotencyKey: string;
    status: "published" | "failed" | "partial";
    facebookPostId?: string;
    error?: string;
  }): Promise<"applied" | "ignored"> {
    if (!/^[0-9a-f-]{36}$/.test(report.postId)) return "ignored";
    const [post] = await this.db
      .select()
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, report.postId));
    if (
      !post ||
      post.status !== "publishing" ||
      post.publishProvider !== "make" ||
      post.publishKey !== report.idempotencyKey
    ) {
      return "ignored";
    }
    if (report.status === "published" && report.facebookPostId) {
      await this.markReconciled(
        post,
        report.facebookPostId,
        null,
        "provider_confirmed",
      );
      return "applied";
    }
    if (report.status === "failed") {
      await this.finishClaim(
        post,
        post.claimToken!,
        "fail_permanent",
        { lastErrorCode: "MAKE_REPORTED_FAILURE", nextAttemptAt: null },
        report.error?.slice(0, 120) ?? "MAKE_REPORTED_FAILURE",
      );
      return "applied";
    }
    await this.db
      .update(schema.socialPosts)
      .set({ lastErrorCode: "MAKE_PARTIAL", updatedAt: this.now() })
      .where(
        and(
          eq(schema.socialPosts.id, post.id),
          eq(schema.socialPosts.status, "publishing"),
        ),
      );
    await this.record(
      post.id,
      "provider_confirmed",
      null,
      "publishing",
      "publishing",
      "partial",
    );
    return "applied";
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
    // Prepared now rather than left for a worker that may be off; a Reel waits for FFmpeg.
    return this.renderPending(1, { onlyPostId: post.id });
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
    const updated = await this.db
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
      )
      .returning({ id: schema.socialPosts.id });
    // The history only records what actually changed; a lost claim leaves no false entry.
    if (updated.length) {
      await this.record(post.id, event, null, "publishing", to, detail);
    }
  }

  /**
   * Whether this post is already on the Page, asked through the publisher. «unknown» when the
   * publisher cannot look (Make): the post then waits for a confirmation, never for a blind retry.
   */
  private async findOnPage(
    publisher: Publisher,
    post: SocialPostRow,
  ): Promise<PageLookup | { state: "unknown" }> {
    if (!publisher.lookUp) return { state: "unknown" };
    return publisher.lookUp({
      caption: post.caption,
      uploadReference: post.metaUploadId,
      since: new Date(
        (post.approvedAt ?? post.claimedAt ?? this.now()).getTime() -
          5 * 60_000,
      ),
    });
  }

  /** Records a post that turned out to be on the Page already; never sends anything. */
  private async markReconciled(
    post: SocialPostRow,
    id: string,
    actor: AdminActor | null,
    event: "reconcile" | "owner_resolved" | "provider_confirmed" = "reconcile",
  ) {
    const from = post.status as PostStatus;
    const to = nextStatus(from, "reconcile");
    const updated = await this.db
      .update(schema.socialPosts)
      .set({
        status: to,
        claimToken: null,
        metaObjectId: id,
        metaPostId: post.metaPostId ?? id,
        publishedAt: post.claimedAt ?? this.now(),
        lastErrorCode: null,
        nextAttemptAt: null,
        updatedAt: this.now(),
        version: sql`${schema.socialPosts.version} + 1`,
      })
      .where(
        and(
          eq(schema.socialPosts.id, post.id),
          eq(schema.socialPosts.status, from),
          isNull(schema.socialPosts.metaObjectId),
        ),
      )
      .returning({ id: schema.socialPosts.id });
    if (updated.length) {
      await this.record(post.id, event, actor, from, to, id);
    }
  }

  private async failClaim(
    post: SocialPostRow,
    token: string,
    failure: MetaFailure | { kind: "local"; code: string },
    provider: PublisherName = "meta",
  ) {
    const attempts = post.attempts + 1;
    const code =
      failure.kind === "local"
        ? failure.code
        : `${provider.toUpperCase()}_${failure.kind.toUpperCase()}${failure.code ? `_${failure.code}` : ""}`;
    if (provider === "meta" && failure.kind === "auth")
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

  /**
   * Publishes approved posts that are due. With `onlyPostId` it publishes that one approved post and
   * nothing else, even when automatic publishing is off: the owner's controlled live test.
   */
  async publishDue(
    limit = 5,
    options: { onlyPostId?: string } = {},
  ): Promise<{
    published: number;
    failed: number;
    retrying: number;
    uncertain?: number;
    handedOff?: number;
    skipped?: string;
  }> {
    const settings = await this.settings();
    if (settings.paused)
      return { published: 0, failed: 0, retrying: 0, skipped: "paused" };
    if (!settings.autoPublishApproved && !options.onlyPostId)
      return { published: 0, failed: 0, retrying: 0, skipped: "manual_mode" };
    if (options.onlyPostId && !/^[0-9a-f-]{36}$/.test(options.onlyPostId)) {
      throw new SocialError("invalid");
    }
    const now = this.now();
    const due = await this.db
      .select()
      .from(schema.socialPosts)
      .where(
        options.onlyPostId
          ? and(
              eq(schema.socialPosts.id, options.onlyPostId),
              inArray(schema.socialPosts.status, ["approved", "retry_wait"]),
            )
          : or(
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
      .limit(options.onlyPostId ? 1 : limit);
    if (!due.length) return { published: 0, failed: 0, retrying: 0 };
    const publisher = await this.publisher();
    if (!publisher)
      return {
        published: 0,
        failed: 0,
        retrying: 0,
        skipped:
          this.publisherName() === "make"
            ? "make_not_configured"
            : "not_connected",
      };
    const catalog = await this.deps.catalog();
    const available = new Set(catalog.products.map((product) => product.id));
    let published = 0;
    let failed = 0;
    let retrying = 0;
    let uncertain = 0;
    let handedOff = 0;
    for (const post of due) {
      // A format the publisher cannot send (Reels via Make, unless confirmed) stays approved.
      if (!publisher.supports(post.format as PostFormat)) continue;
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
      const mediaProblem = await this.deps.checkMedia?.(
        post.mediaUrl,
        post.format === "reel" ? "video" : "image",
      );
      if (mediaProblem) {
        await this.failClaim(post, token, {
          kind: "local",
          code: mediaProblem,
        });
        failed += 1;
        continue;
      }
      try {
        // A retry first asks whether an earlier attempt went through after all. A publisher that
        // cannot look only ever has posts here that it refused outright (throttled), never sent ones.
        if (post.attempts > 0 || post.metaUploadId) {
          const found = await this.findOnPage(publisher, post);
          if (found.state === "published") {
            await this.markReconciled(
              { ...post, status: "publishing", claimedAt: post.claimedAt },
              found.id,
              null,
            );
            published += 1;
            continue;
          }
          if (found.state === "processing") {
            // Facebook is still handling the earlier upload; the reconciler finishes it.
            uncertain += 1;
            continue;
          }
          // Without a way to look, a retry is safe only when the last attempt was refused outright.
          if (
            found.state === "unknown" &&
            !post.lastErrorCode?.startsWith(
              `${publisher.name.toUpperCase()}_RATE_LIMIT`,
            )
          ) {
            await this.failClaim(post, token, {
              kind: "local",
              code: "NEEDS_PAGE_CHECK",
            });
            failed += 1;
            continue;
          }
        }
        const outcome = await publisher.publish(
          {
            postId: post.id,
            idempotencyKey: post.publishKey!,
            format: post.format as PostFormat,
            kind: post.kind,
            caption: post.caption,
            mediaUrls: [post.mediaUrl],
            posterUrl: post.posterUrl,
            attempt: post.attempts + 1,
          },
          {
            onUploadStarted: async (reference) => {
              await this.db
                .update(schema.socialPosts)
                .set({ metaUploadId: reference, updatedAt: this.now() })
                .where(
                  and(
                    eq(schema.socialPosts.id, post.id),
                    eq(schema.socialPosts.claimToken, token),
                  ),
                );
            },
          },
        );
        if (outcome.kind === "accepted") {
          // Make took it; Facebook's answer comes from the scenario's callback or the owner.
          await this.db
            .update(schema.socialPosts)
            .set({
              publishProvider: publisher.name,
              providerRef: outcome.reference,
              lastErrorCode: "AWAITING_CONFIRMATION",
              updatedAt: this.now(),
            })
            .where(
              and(
                eq(schema.socialPosts.id, post.id),
                eq(schema.socialPosts.claimToken, token),
              ),
            );
          await this.record(
            post.id,
            "handed_off",
            null,
            "publishing",
            "publishing",
            publisher.name,
          );
          handedOff += 1;
          continue;
        }
        await this.finishClaim(
          post,
          token,
          "succeed",
          {
            publishProvider: publisher.name,
            metaObjectId: outcome.objectId,
            metaPostId: outcome.postId ?? outcome.objectId,
            publishedAt: this.now(),
            lastErrorCode: null,
            nextAttemptAt: null,
          },
          outcome.postId ?? outcome.objectId,
        );
        published += 1;
      } catch (error) {
        const failure: MetaFailure =
          error instanceof MetaApiError
            ? error.failure
            : { kind: "unknown_outcome", code: null, subcode: null };
        if (failure.kind === "unknown_outcome") {
          // It may have been published. The claim is kept, so nothing re-sends it; the reconciler
          // (or, for Make, the callback or the owner) settles it.
          await this.db
            .update(schema.socialPosts)
            .set({
              publishProvider: publisher.name,
              lastErrorCode: `${publisher.name.toUpperCase()}_UNKNOWN_OUTCOME`,
              updatedAt: this.now(),
            })
            .where(
              and(
                eq(schema.socialPosts.id, post.id),
                eq(schema.socialPosts.claimToken, token),
              ),
            );
          await this.record(
            post.id,
            "uncertain",
            null,
            "publishing",
            "publishing",
          );
          uncertain += 1;
          continue;
        }
        await this.failClaim(post, token, failure, publisher.name);
        if (isRetryable(failure) && post.attempts + 1 < MAX_PUBLISH_ATTEMPTS)
          retrying += 1;
        else failed += 1;
        // Throttled or signed out: further calls in this run would fail the same way.
        if (failure.kind === "rate_limit" || failure.kind === "auth") break;
      }
    }
    return { published, failed, retrying, uncertain, handedOff };
  }

  /**
   * A claim that never finished (crash, timeout, lost answer) may or may not have reached Facebook.
   * Each one is looked up on the Page first; only a post that is certainly absent is queued again.
   * A lookup that fails leaves the post as it is, to be checked on the next run.
   */
  async reconcileStale(): Promise<{
    recovered: number;
    requeued: number;
    waiting: number;
  }> {
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
    const result = { recovered: 0, requeued: 0, waiting: 0 };
    if (!stale.length) return result;
    const publisher = await this.publisher();
    if (!publisher) return { ...result, waiting: stale.length };
    for (const post of stale) {
      try {
        const found = await this.findOnPage(publisher, post);
        if (found.state === "published") {
          await this.markReconciled(post, found.id, null);
          result.recovered += 1;
        } else if (found.state === "processing" || found.state === "unknown") {
          // Unknown: this publisher cannot check the Page; only a confirmation settles it.
          result.waiting += 1;
        } else if (found.state === "failed") {
          await this.finishClaim(
            post,
            post.claimToken!,
            "fail_permanent",
            { lastErrorCode: "REEL_PROCESSING_FAILED", nextAttemptAt: null },
            "REEL_PROCESSING_FAILED",
          );
          result.requeued += 1;
        } else {
          await this.failClaim(post, post.claimToken!, {
            kind: "transient",
            code: null,
            subcode: null,
          });
          result.requeued += 1;
        }
      } catch {
        result.waiting += 1;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- engagement & community

  async refreshEngagement(days = 30): Promise<{ updated: number }> {
    const client = await this.metaClient();
    if (!client) return { updated: 0 };
    const posts = await this.db
      .select({
        id: schema.socialPosts.id,
        format: schema.socialPosts.format,
        metaPostId: schema.socialPosts.metaPostId,
        metaObjectId: schema.socialPosts.metaObjectId,
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
        const engagement = await client.engagement(
          post.metaPostId,
          post.format === "reel" ? post.metaObjectId : null,
        );
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
    // Taking the reply first means a second click finds it already being sent.
    const taken = await this.db
      .update(schema.socialComments)
      .set({ replyStatus: "sending" })
      .where(
        and(
          eq(schema.socialComments.id, id),
          inArray(schema.socialComments.replyStatus, [
            "held",
            "failed",
            "pending",
          ]),
        ),
      )
      .returning({ id: schema.socialComments.id });
    if (!taken.length) throw new SocialError("invalid");
    try {
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
    } catch (error) {
      // A lost answer may still have posted the reply; it is not offered again automatically.
      const unknown =
        !(error instanceof MetaApiError) ||
        error.failure.kind === "unknown_outcome";
      await this.db
        .update(schema.socialComments)
        .set({ replyStatus: unknown ? "sending" : "failed" })
        .where(eq(schema.socialComments.id, id));
      throw error;
    }
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
