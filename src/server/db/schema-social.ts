import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { adminUsers, orders } from "./schema-core";

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true, mode: "date" })
  .notNull()
  .defaultNow();

/**
 * One Facebook post or Reel from draft to published. The approved caption and media are frozen;
 * publish_key and meta_post_id are unique so the same content can never go out twice.
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    format: varchar("format", { length: 8 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    reelTemplate: varchar("reel_template", { length: 16 }),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    productIds: jsonb("product_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    tipId: varchar("tip_id", { length: 40 }),
    categoryCode: varchar("category_code", { length: 40 }),
    /** A Creative Studio campaign: its angle, objective and the exact bundle it was planned with. */
    campaign: jsonb("campaign").$type<Record<string, unknown> | null>(),
    caption: text("caption").notNull(),
    captionSource: varchar("caption_source", { length: 12 }).notNull(),
    mediaStatus: varchar("media_status", { length: 12 })
      .notNull()
      .default("pending"),
    mediaUrl: varchar("media_url", { length: 600 }),
    posterUrl: varchar("poster_url", { length: 600 }),
    mediaSeconds: integer("media_seconds"),
    mediaError: varchar("media_error", { length: 60 }),
    scheduledFor: timestamp("scheduled_for", {
      withTimezone: true,
      mode: "date",
    }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastErrorCode: varchar("last_error_code", { length: 60 }),
    claimToken: uuid("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    publishKey: varchar("publish_key", { length: 64 }).unique(),
    metaPostId: varchar("meta_post_id", { length: 100 }).unique(),
    metaObjectId: varchar("meta_object_id", { length: 100 }),
    // A Reel's video id, saved before the final publish call so a lost answer can be checked.
    metaUploadId: varchar("meta_upload_id", { length: 100 }),
    // Which publisher handled the post (meta | make) and its own reference (e.g. a Make execution).
    publishProvider: varchar("publish_provider", { length: 10 }),
    providerRef: varchar("provider_ref", { length: 200 }),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
    approvedBy: uuid("approved_by").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    version: integer("version").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("social_posts_queue_idx").on(table.status, table.scheduledFor),
    index("social_posts_published_idx").on(table.publishedAt),
    index("social_posts_approved_by_idx").on(table.approvedBy),
    check(
      "social_posts_status",
      sql`${table.status} IN ('draft','approved','publishing','retry_wait','published','failed','rejected')`,
    ),
    check("social_posts_format", sql`${table.format} IN ('image','reel')`),
    check(
      "social_posts_media_status",
      sql`${table.mediaStatus} IN ('pending','ready','failed')`,
    ),
    check(
      "social_posts_caption_source",
      sql`${table.captionSource} IN ('template','ai','owner')`,
    ),
    // Nothing is published, claimed or queued without an owner's approval on record.
    check(
      "social_posts_approved_before_publish",
      sql`${table.status} IN ('draft','rejected') OR (${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND ${table.publishKey} IS NOT NULL)`,
    ),
    check(
      "social_posts_published_has_id",
      sql`${table.status} <> 'published' OR ${table.metaObjectId} IS NOT NULL`,
    ),
    check("social_posts_attempts", sql`${table.attempts} >= 0`),
  ],
);

/** The post's audit trail: every transition, by whom (null = the scheduler) and why. */
export const socialPostEvents = pgTable(
  "social_post_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    event: varchar("event", { length: 24 }).notNull(),
    fromStatus: varchar("from_status", { length: 16 }),
    toStatus: varchar("to_status", { length: 16 }),
    detail: varchar("detail", { length: 200 }),
    createdAt,
  },
  (table) => [
    index("social_post_events_post_idx").on(table.postId, table.createdAt),
    index("social_post_events_actor_idx").on(table.actorId),
  ],
);

/** The Facebook Page connection. The token is AES-256-GCM sealed; the key is only in the environment. */
export const socialConnections = pgTable(
  "social_connections",
  {
    provider: varchar("provider", { length: 20 }).primaryKey(),
    pageId: varchar("page_id", { length: 40 }).notNull(),
    pageName: varchar("page_name", { length: 160 }),
    tokenSealed: text("token_sealed").notNull(),
    tokenHint: varchar("token_hint", { length: 12 }).notNull(),
    tokenExpiresAt: timestamp("token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scopes: jsonb("scopes")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: varchar("status", { length: 16 }).notNull(),
    lastCheckedAt: timestamp("last_checked_at", {
      withTimezone: true,
      mode: "date",
    }),
    connectedBy: uuid("connected_by").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("social_connections_connected_by_idx").on(table.connectedBy),
    check("social_connections_provider", sql`${table.provider} = 'facebook'`),
    check(
      "social_connections_status",
      sql`${table.status} IN ('connected','expired','revoked')`,
    ),
  ],
);

/** When each published product was first seen, so «وصل حديثاً» is a fact and not a guess. */
export const socialCatalogSeen = pgTable("social_catalog_seen", {
  productId: varchar("product_id", { length: 80 }).primaryKey(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  // Products present at the first discovery run are the starting stock, not new arrivals.
  baseline: boolean("baseline").notNull().default(false),
});

export const socialJobRuns = pgTable(
  "social_job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: varchar("job", { length: 30 }).notNull(),
    status: varchar("status", { length: 10 }).notNull(),
    summary: jsonb("summary")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorCode: varchar("error_code", { length: 60 }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("social_job_runs_job_idx").on(table.job, table.startedAt),
    check(
      "social_job_runs_status",
      sql`${table.status} IN ('running','ok','failed','skipped')`,
    ),
  ],
);

export const socialEngagement = pgTable("social_engagement", {
  postId: uuid("post_id")
    .primaryKey()
    .references(() => socialPosts.id, { onDelete: "cascade" }),
  reactions: integer("reactions").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  reach: integer("reach"),
  views: integer("views"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** Comments on our posts and what was done with each; replies only to verified questions. */
export const socialComments = pgTable(
  "social_comments",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    authorName: varchar("author_name", { length: 120 }),
    message: text("message").notNull(),
    commentedAt: timestamp("commented_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    decision: varchar("decision", { length: 12 }).notNull(),
    reason: varchar("reason", { length: 30 }),
    replyText: text("reply_text"),
    replyStatus: varchar("reply_status", { length: 12 }).notNull(),
    replyMetaId: varchar("reply_meta_id", { length: 100 }),
    resolvedBy: uuid("resolved_by").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    createdAt,
  },
  (table) => [
    index("social_comments_open_idx").on(table.decision, table.resolvedAt),
    index("social_comments_post_idx").on(table.postId),
    index("social_comments_resolved_by_idx").on(table.resolvedBy),
    check(
      "social_comments_decision",
      sql`${table.decision} IN ('reply','escalate','none')`,
    ),
    check(
      "social_comments_reply_status",
      sql`${table.replyStatus} IN ('pending','sending','sent','failed','skipped','held')`,
    ),
  ],
);

/** The owner's switches; one row. Automatic comment replies stay off until the owner turns them on. */
export const socialSettings = pgTable(
  "social_settings",
  {
    id: integer("id").primaryKey().default(1),
    autoPublishApproved: boolean("auto_publish_approved")
      .notNull()
      .default(false),
    autoReplyFaq: boolean("auto_reply_faq").notNull().default(false),
    paused: boolean("paused").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    updatedAt,
  },
  (table) => [
    index("social_settings_updated_by_idx").on(table.updatedBy),
    check("social_settings_singleton", sql`${table.id} = 1`),
  ],
);

/**
 * Landings from a tracked campaign link, counted per campaign and day. No visitor data is kept:
 * only the count of first landings per browser session.
 */
export const socialCampaignVisits = pgTable(
  "social_campaign_visits",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    day: varchar("day", { length: 10 }).notNull(),
    visits: integer("visits").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.day] }),
    check("social_campaign_visits_positive", sql`${table.visits} >= 0`),
  ],
);

/**
 * An order placed after a tracked campaign link. Kept apart from orders so that neither the order
 * nor its history changes; one campaign at most per order.
 */
export const socialOrderAttributions = pgTable(
  "social_order_attributions",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [index("social_order_attributions_post_idx").on(table.postId)],
);

/**
 * A Reel the owner asked to render. The render-only worker claims a request (claim token), renders
 * it with FFmpeg and stores the video; it never touches posts, approvals or the Page. The same
 * storyboard is rendered once: a repeat request returns the existing render.
 */
export const socialReelRenders = pgTable(
  "social_reel_renders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    concept: varchar("concept", { length: 40 }).notNull(),
    seconds: integer("seconds").notNull(),
    productIds: jsonb("product_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    storyboard: jsonb("storyboard").$type<Record<string, unknown>>().notNull(),
    /** sha256 of the storyboard: the same Reel is never queued twice. */
    storyboardKey: varchar("storyboard_key", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 12 }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    claimToken: uuid("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    errorCode: varchar("error_code", { length: 60 }),
    videoUrl: varchar("video_url", { length: 600 }),
    frameUrls: jsonb("frame_urls")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    renderedSeconds: integer("rendered_seconds"),
    requestedBy: uuid("requested_by").references(() => adminUsers.id),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("social_reel_renders_queue_idx").on(table.status, table.createdAt),
    index("social_reel_renders_requested_by_idx").on(table.requestedBy),
    check(
      "social_reel_renders_status",
      sql`${table.status} IN ('queued','rendering','ready','failed')`,
    ),
    check("social_reel_renders_attempts", sql`${table.attempts} >= 0`),
  ],
);
