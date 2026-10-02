import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";

import {
  applyDraftPatch,
  draftDisplayValue,
  draftLabels,
  draftMissing,
  draftStage,
  DRAFT_TTL_MS,
  emptyDraft,
  type DraftCategory,
  type DraftFieldName,
  type DraftPatch,
  type ProductDraftData,
} from "../domain/product-draft";

export interface DraftRecord {
  id: string;
  status: "open" | "submitted";
  data: ProductDraftData;
  expiresAt: Date;
}

export interface DraftView {
  status: "draft";
  state: "needs_clarification" | "ready_for_confirmation";
  stage: ReturnType<typeof draftStage>;
  submitted: boolean;
  fields: Array<{
    field: DraftFieldName;
    label: string;
    value: string;
    source: "user" | "image";
  }>;
  missing: string[];
  suggestions: Array<{ label: string; value: string; confidence: number }>;
  errors: Array<{ label: string; message: string }>;
  images: number;
  expiresAt: string;
  untrustedData: boolean;
}

export class ProductDraftService {
  constructor(private readonly database: Database) {}

  async current(
    actor: AdminActor,
    conversationId: string,
    now = new Date(),
  ): Promise<DraftRecord | null> {
    const [row] = await this.database
      .select()
      .from(schema.adminAssistantProductDrafts)
      .where(
        and(
          eq(schema.adminAssistantProductDrafts.adminUserId, actor.id),
          eq(schema.adminAssistantProductDrafts.conversationId, conversationId),
          inArray(schema.adminAssistantProductDrafts.status, [
            "open",
            "submitted",
          ]),
        ),
      )
      .orderBy(desc(schema.adminAssistantProductDrafts.updatedAt))
      .limit(1);
    if (!row) return null;
    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.database
        .update(schema.adminAssistantProductDrafts)
        .set({ status: "expired", updatedAt: now })
        .where(eq(schema.adminAssistantProductDrafts.id, row.id));
      return null;
    }
    return {
      id: row.id,
      status: row.status as "open" | "submitted",
      data: row.data as unknown as ProductDraftData,
      expiresAt: row.expiresAt,
    };
  }

  // Starting a new draft closes any earlier one in the same conversation.
  async start(
    actor: AdminActor,
    conversationId: string,
    initial: {
      attachmentIds: string[];
      imageFields: DraftPatch;
      suggestions: ProductDraftData["suggestions"];
      userFields: DraftPatch;
    },
    categories: readonly DraftCategory[],
    now = new Date(),
  ) {
    const fromImages = applyDraftPatch(
      {
        ...emptyDraft(initial.attachmentIds),
        suggestions: initial.suggestions,
      },
      initial.imageFields,
      categories,
      "image",
    );
    const fromUser = applyDraftPatch(
      fromImages.data,
      initial.userFields,
      categories,
    );
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(schema.adminAssistantProductDrafts)
        .set({ status: "cancelled", updatedAt: now })
        .where(
          and(
            eq(schema.adminAssistantProductDrafts.adminUserId, actor.id),
            eq(
              schema.adminAssistantProductDrafts.conversationId,
              conversationId,
            ),
            inArray(schema.adminAssistantProductDrafts.status, [
              "open",
              "submitted",
            ]),
          ),
        );
      await transaction.insert(schema.adminAssistantProductDrafts).values({
        adminUserId: actor.id,
        conversationId,
        data: fromUser.data as unknown as Record<string, unknown>,
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
      });
    });
    return { data: fromUser.data, errors: fromUser.errors };
  }

  async update(
    actor: AdminActor,
    conversationId: string,
    patch: DraftPatch,
    categories: readonly DraftCategory[],
    now = new Date(),
  ) {
    const draft = await this.current(actor, conversationId, now);
    if (!draft) return null;
    const result = applyDraftPatch(draft.data, patch, categories);
    await this.database
      .update(schema.adminAssistantProductDrafts)
      .set({
        data: result.data as unknown as Record<string, unknown>,
        status: "open",
        version: sql`${schema.adminAssistantProductDrafts.version} + 1`,
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
        updatedAt: now,
      })
      .where(eq(schema.adminAssistantProductDrafts.id, draft.id));
    return { data: result.data, errors: result.errors };
  }

  async setStatus(
    actor: AdminActor,
    conversationId: string,
    status: "submitted" | "cancelled",
    now = new Date(),
  ): Promise<boolean> {
    const draft = await this.current(actor, conversationId, now);
    if (!draft) return false;
    await this.database
      .update(schema.adminAssistantProductDrafts)
      .set({ status, updatedAt: now })
      .where(eq(schema.adminAssistantProductDrafts.id, draft.id));
    return true;
  }

  view(
    data: ProductDraftData,
    categories: readonly DraftCategory[],
    extra: {
      errors?: Array<{ field: DraftFieldName; message: string }>;
      submitted?: boolean;
      expiresAt: Date;
    },
  ): DraftView {
    const missing = draftMissing(data);
    const fields = Object.entries(data.fields).map(([field, entry]) => ({
      field: field as DraftFieldName,
      label: draftLabels[field as DraftFieldName],
      value: draftDisplayValue(
        field as DraftFieldName,
        entry!.value,
        categories,
      ),
      source: entry!.source,
    }));
    return {
      status: "draft",
      state: missing.length ? "needs_clarification" : "ready_for_confirmation",
      stage: draftStage(data),
      submitted: Boolean(extra.submitted),
      fields,
      missing: missing.map((field) => draftLabels[field]),
      suggestions: data.suggestions.map((item) => ({
        label: draftLabels[item.field],
        value: item.value,
        confidence: item.confidence,
      })),
      errors: (extra.errors ?? []).map((item) => ({
        label: draftLabels[item.field],
        message: item.message,
      })),
      images: data.attachmentIds.length,
      expiresAt: extra.expiresAt.toISOString(),
      untrustedData: fields.some((field) => field.source === "image"),
    };
  }
}
