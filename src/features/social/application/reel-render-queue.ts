import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Storyboard } from "@/features/social/domain/reels";
import * as schema from "@/server/db/schema";

type Database = PostgresJsDatabase<typeof schema>;

/** Automatic tries before a render waits for the owner's retry. */
export const MAX_RENDER_ATTEMPTS = 3;
/** A render claimed longer ago than this is treated as abandoned (the worker died) and requeued. */
export const RENDER_LEASE_MS = 15 * 60_000;

export type ReelRenderRow = typeof schema.socialReelRenders.$inferSelect;

/** The same storyboard always has the same key, so asking twice never renders twice. */
export function storyboardKey(board: Storyboard): string {
  return createHash("sha256").update(JSON.stringify(board)).digest("hex");
}

/**
 * The Reels render queue. The owner asks for a render from the dashboard; the render-only worker
 * claims it, renders it and stores the video. Nothing here publishes, approves or touches social
 * accounts: a rendered Reel is a file for the owner to watch and download.
 */
export class ReelRenderQueue {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Queues a storyboard once. Returns the render for it, new or existing, and whether it is new. */
  async request(
    board: Storyboard,
    requestedBy: string | null,
    dropScenes: readonly number[] = [],
  ): Promise<{ id: string; created: boolean }> {
    const key = storyboardKey(board);
    const [inserted] = await this.db
      .insert(schema.socialReelRenders)
      .values({
        concept: board.concept,
        seconds: board.seconds,
        productIds: board.productIds,
        // The scene choice travels with the storyboard, so the worker can rebuild it from the
        // catalog of the day and refuse to render prices that have since changed.
        storyboard: { ...board, dropScenes: [...dropScenes] },
        storyboardKey: key,
        requestedBy,
      })
      .onConflictDoNothing({ target: schema.socialReelRenders.storyboardKey })
      .returning({ id: schema.socialReelRenders.id });
    if (inserted) return { id: inserted.id, created: true };
    const [existing] = await this.db
      .select({ id: schema.socialReelRenders.id })
      .from(schema.socialReelRenders)
      .where(eq(schema.socialReelRenders.storyboardKey, key));
    return { id: existing!.id, created: false };
  }

  /** A failed render goes back to the queue with fresh tries. Anything else is left alone. */
  async retry(id: string): Promise<boolean> {
    const rows = await this.db
      .update(schema.socialReelRenders)
      .set({
        status: "queued",
        attempts: 0,
        errorCode: null,
        claimToken: null,
        claimedAt: null,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(schema.socialReelRenders.id, id),
          eq(schema.socialReelRenders.status, "failed"),
        ),
      )
      .returning({ id: schema.socialReelRenders.id });
    return rows.length === 1;
  }

  async list(limit = 20): Promise<ReelRenderRow[]> {
    return this.db
      .select()
      .from(schema.socialReelRenders)
      .orderBy(desc(schema.socialReelRenders.createdAt))
      .limit(limit);
  }

  async get(id: string): Promise<ReelRenderRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.socialReelRenders)
      .where(eq(schema.socialReelRenders.id, id));
    return row ?? null;
  }

  /**
   * The worker takes the oldest queued render, or one whose worker vanished mid-render. Two
   * workers never take the same one.
   */
  async claim(): Promise<{ render: ReelRenderRow; token: string } | null> {
    const token = randomUUID();
    const now = this.now();
    const stale = new Date(now.getTime() - RENDER_LEASE_MS);
    // A worker that died on the last try leaves nothing to retry automatically.
    await this.db
      .update(schema.socialReelRenders)
      .set({
        status: "failed",
        errorCode: "WORKER_LOST",
        claimToken: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.socialReelRenders.status, "rendering"),
          lt(schema.socialReelRenders.claimedAt, stale),
          gte(schema.socialReelRenders.attempts, MAX_RENDER_ATTEMPTS),
        ),
      );
    const rows = await this.db.execute<{ id: string }>(sql`
      update ${schema.socialReelRenders}
      set status = 'rendering', claim_token = ${token}, claimed_at = ${now.toISOString()},
          attempts = attempts + 1, updated_at = ${now.toISOString()}
      where id = (
        select id from ${schema.socialReelRenders}
        where (status = 'queued'
               or (status = 'rendering' and claimed_at < ${stale.toISOString()}))
          and attempts < ${MAX_RENDER_ATTEMPTS}
        order by created_at
        limit 1
        for update skip locked
      )
      returning id`);
    const id = rows[0]?.id;
    if (!id) return null;
    return { render: (await this.get(id))!, token };
  }

  /** Stores the finished Reel, only if this worker still holds the render. */
  async finish(
    id: string,
    token: string,
    result: { videoUrl: string; frameUrls: string[]; seconds: number },
  ): Promise<boolean> {
    const rows = await this.db
      .update(schema.socialReelRenders)
      .set({
        status: "ready",
        videoUrl: result.videoUrl,
        frameUrls: result.frameUrls,
        renderedSeconds: Math.round(result.seconds),
        errorCode: null,
        claimToken: null,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(schema.socialReelRenders.id, id),
          eq(schema.socialReelRenders.claimToken, token),
        ),
      )
      .returning({ id: schema.socialReelRenders.id });
    return rows.length === 1;
  }

  /**
   * A failed try goes back to the queue until the tries run out, then waits for the owner. A
   * final failure (one another try cannot fix) waits for the owner at once.
   */
  async fail(
    id: string,
    token: string,
    code: string,
    final = false,
  ): Promise<void> {
    await this.db
      .update(schema.socialReelRenders)
      .set({
        status: final
          ? "failed"
          : sql`case when ${schema.socialReelRenders.attempts} >= ${MAX_RENDER_ATTEMPTS} then 'failed' else 'queued' end`,
        errorCode: code.slice(0, 60),
        claimToken: null,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(schema.socialReelRenders.id, id),
          eq(schema.socialReelRenders.claimToken, token),
        ),
      );
  }
}
