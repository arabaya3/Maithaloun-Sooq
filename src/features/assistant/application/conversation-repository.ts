import "server-only";

import { and, asc, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";

import { settleMessageParts } from "../domain/message-state";

import {
  CONVERSATION_RETENTION_DAYS,
  MAX_HISTORY_MESSAGES,
  TOOL_RUN_RETENTION_DAYS,
} from "../domain/assistant-policy";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
  metadata?: Record<string, unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export class ConversationRepository {
  constructor(private readonly database: Database) {}

  async ensure(
    actor: AdminActor,
    conversationId: string | null,
  ): Promise<string> {
    if (conversationId && z.uuid().safeParse(conversationId).success) {
      const [existing] = await this.database
        .select({ id: schema.adminAssistantConversations.id })
        .from(schema.adminAssistantConversations)
        .where(
          and(
            eq(schema.adminAssistantConversations.id, conversationId),
            eq(schema.adminAssistantConversations.adminUserId, actor.id),
          ),
        )
        .limit(1);
      if (existing) return existing.id;
    }
    const [created] = await this.database
      .insert(schema.adminAssistantConversations)
      .values({ adminUserId: actor.id })
      .returning({ id: schema.adminAssistantConversations.id });
    if (!created) throw new Error("CONVERSATION_CREATE_FAILED");
    return created.id;
  }

  async owns(actor: AdminActor, conversationId: string): Promise<boolean> {
    if (!z.uuid().safeParse(conversationId).success) return false;
    const [row] = await this.database
      .select({ id: schema.adminAssistantConversations.id })
      .from(schema.adminAssistantConversations)
      .where(
        and(
          eq(schema.adminAssistantConversations.id, conversationId),
          eq(schema.adminAssistantConversations.adminUserId, actor.id),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async latest(actor: AdminActor): Promise<string | null> {
    const [row] = await this.database
      .select({ id: schema.adminAssistantConversations.id })
      .from(schema.adminAssistantConversations)
      .where(eq(schema.adminAssistantConversations.adminUserId, actor.id))
      .orderBy(desc(schema.adminAssistantConversations.updatedAt))
      .limit(1);
    return row?.id ?? null;
  }

  async messages(
    actor: AdminActor,
    conversationId: string,
    limit = MAX_HISTORY_MESSAGES,
  ): Promise<StoredMessage[]> {
    if (!(await this.owns(actor, conversationId))) return [];
    const rows = await this.database
      .select()
      .from(schema.adminAssistantMessages)
      .where(eq(schema.adminAssistantMessages.conversationId, conversationId))
      .orderBy(desc(schema.adminAssistantMessages.createdAt))
      .limit(limit);
    return rows.reverse().map((row) => {
      const settled = settleMessageParts(row.parts);
      const metadata = settled.interrupted
        ? { ...(row.metadata ?? {}), status: "interrupted" }
        : row.metadata;
      return {
        id: row.messageId,
        role: row.role as "user" | "assistant",
        parts: settled.parts,
        ...(metadata ? { metadata } : {}),
      };
    });
  }

  // Only parts a person can see are stored: text, tool inputs/outputs and file references.
  async save(conversationId: string, messages: StoredMessage[]): Promise<void> {
    if (!messages.length) return;
    const now = Date.now();
    await this.database.transaction(async (transaction) => {
      for (const [index, message] of messages.entries()) {
        const visible = message.parts.filter((part) => {
          const type = (part as { type?: string }).type ?? "";
          return type === "text" || type.startsWith("tool-") || type === "file";
        });
        const settled = settleMessageParts(visible);
        const parts = settled.parts;
        const metadata =
          settled.interrupted && message.role === "assistant"
            ? { ...(message.metadata ?? {}), status: "interrupted" }
            : (message.metadata ?? null);
        await transaction
          .insert(schema.adminAssistantMessages)
          .values({
            conversationId,
            messageId: message.id.slice(0, 80),
            role: message.role,
            parts,
            metadata,
            createdAt: new Date(now + index),
          })
          .onConflictDoUpdate({
            target: [
              schema.adminAssistantMessages.conversationId,
              schema.adminAssistantMessages.messageId,
            ],
            set: { parts, metadata },
          });
      }
      await transaction
        .update(schema.adminAssistantConversations)
        .set({ updatedAt: new Date(now) })
        .where(eq(schema.adminAssistantConversations.id, conversationId));
    });
  }

  async clear(actor: AdminActor, conversationId: string): Promise<void> {
    await this.database
      .delete(schema.adminAssistantConversations)
      .where(
        and(
          eq(schema.adminAssistantConversations.id, conversationId),
          eq(schema.adminAssistantConversations.adminUserId, actor.id),
        ),
      );
  }

  async purge(now: Date): Promise<{ conversations: number; toolRuns: number }> {
    const conversations = await this.database
      .delete(schema.adminAssistantConversations)
      .where(
        lt(
          schema.adminAssistantConversations.updatedAt,
          new Date(now.getTime() - CONVERSATION_RETENTION_DAYS * DAY_MS),
        ),
      )
      .returning({ id: schema.adminAssistantConversations.id });
    const toolRuns = await this.database
      .delete(schema.adminAssistantToolRuns)
      .where(
        lt(
          schema.adminAssistantToolRuns.createdAt,
          new Date(now.getTime() - TOOL_RUN_RETENTION_DAYS * DAY_MS),
        ),
      )
      .returning({ id: schema.adminAssistantToolRuns.id });
    return { conversations: conversations.length, toolRuns: toolRuns.length };
  }

  async toolRunsFor(conversationId: string) {
    return this.database
      .select()
      .from(schema.adminAssistantToolRuns)
      .where(eq(schema.adminAssistantToolRuns.conversationId, conversationId))
      .orderBy(asc(schema.adminAssistantToolRuns.createdAt));
  }
}
