import "server-only";

import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";

import {
  CONFIRMATION_TTL_MS,
  DESTRUCTIVE_TOKEN_TTL_MS,
  operationRisk,
  operations,
  type AssistantOperation,
} from "../domain/assistant-policy";
import {
  issueConfirmationToken,
  payloadHash,
  verifyConfirmation,
} from "../domain/confirmation-token";
import { assistantFailure, rejectionMessages } from "./assistant-errors";
import type {
  AssistantOperations,
  ConfirmationCard,
  PrepareResult,
} from "./assistant-operations";
import type { ConversationRepository } from "./conversation-repository";
import type { ToolRunLog } from "./tool-run-log";

export type ConfirmationStatus =
  "pending" | "executing" | "completed" | "failed" | "expired" | "cancelled";

export interface ConfirmationView {
  id: string;
  operation: AssistantOperation;
  riskLevel: 2 | 3 | 4;
  status: ConfirmationStatus;
  card: ConfirmationCard;
  expiresAt: string;
  token: string | null;
  result: { message: string; href: string | null } | null;
}

export type ConfirmOutcome =
  | { ok: true; status: "completed"; message: string; href: string | null }
  | {
      ok: false;
      status: ConfirmationStatus | "rejected";
      code: string;
      message: string;
      href: string | null;
    };

const operationSchema = z.enum(operations);

export class ConfirmationService {
  constructor(
    private readonly database: Database,
    private readonly operations: AssistantOperations,
    private readonly conversations: ConversationRepository,
    private readonly toolRuns: ToolRunLog,
  ) {}

  async create(
    actor: AdminActor,
    conversationId: string | null,
    prepared: Extract<PrepareResult, { status: "ready" }>,
  ): Promise<{ confirmationId: string; expiresAt: string } | null> {
    const handler = this.operations.handlers[prepared.operation];
    const version = await handler.version(actor, prepared.args);
    if (version === null) return null;
    const payload = { args: prepared.args, card: prepared.card };
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);
    const [row] = await this.database
      .insert(schema.adminAssistantConfirmations)
      .values({
        conversationId,
        adminUserId: actor.id,
        operation: prepared.operation,
        riskLevel: operationRisk[prepared.operation],
        payload,
        payloadHash: payloadHash(prepared.operation, payload),
        recordVersion: version.slice(0, 120),
        // Unusable until the card is opened and a token is issued to the browser.
        tokenHash: issueConfirmationToken().tokenHash,
        expiresAt,
      })
      .returning({ id: schema.adminAssistantConfirmations.id });
    if (!row) return null;
    return { confirmationId: row.id, expiresAt: expiresAt.toISOString() };
  }

  private async load(actor: AdminActor, id: string) {
    if (!z.uuid().safeParse(id).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.adminAssistantConfirmations)
      .where(
        and(
          eq(schema.adminAssistantConfirmations.id, id),
          eq(schema.adminAssistantConfirmations.adminUserId, actor.id),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // The token goes only to the browser that renders the card; the model never sees it.
  async view(actor: AdminActor, id: string): Promise<ConfirmationView | null> {
    const row = await this.load(actor, id);
    if (!row) return null;
    const operation = operationSchema.safeParse(row.operation);
    if (!operation.success) return null;
    let status = row.status as ConfirmationStatus;
    if (status === "pending" && row.expiresAt.getTime() <= Date.now()) {
      await this.database
        .update(schema.adminAssistantConfirmations)
        .set({ status: "expired" })
        .where(
          and(
            eq(schema.adminAssistantConfirmations.id, row.id),
            eq(schema.adminAssistantConfirmations.status, "pending"),
          ),
        );
      status = "expired";
    }
    let token: string | null = null;
    if (status === "pending") {
      const issued = issueConfirmationToken();
      await this.database
        .update(schema.adminAssistantConfirmations)
        .set({ tokenHash: issued.tokenHash, tokenIssuedAt: new Date() })
        .where(
          and(
            eq(schema.adminAssistantConfirmations.id, row.id),
            eq(schema.adminAssistantConfirmations.status, "pending"),
          ),
        );
      token = issued.token;
    }
    const payload = row.payload as { card: ConfirmationCard };
    const result = row.result as {
      message?: string;
      href?: string | null;
    } | null;
    return {
      id: row.id,
      operation: operation.data,
      riskLevel: row.riskLevel as 2 | 3 | 4,
      status,
      card: payload.card,
      expiresAt: row.expiresAt.toISOString(),
      token,
      result: result?.message
        ? { message: result.message, href: result.href ?? null }
        : null,
    };
  }

  async confirm(
    actor: AdminActor,
    request: {
      id: string;
      operation: string;
      token: string;
      acknowledged?: boolean;
    },
  ): Promise<ConfirmOutcome> {
    const started = Date.now();
    const toolName =
      `confirm${request.operation.charAt(0).toUpperCase()}${request.operation.slice(1)}`.slice(
        0,
        60,
      );
    const parsedOperation = operationSchema.safeParse(request.operation);
    const row = await this.load(actor, request.id);
    if (!parsedOperation.success || !row) {
      await this.toolRuns.record({
        conversationId: null,
        adminUserId: actor.id,
        toolName,
        riskLevel: 3,
        status: "rejected",
        input: { id: request.id },
        errorCode: "not_found",
        durationMs: Date.now() - started,
      });
      return {
        ok: false,
        status: "rejected",
        code: "not_found",
        message: rejectionMessages.not_found,
        href: null,
      };
    }
    if (row.status === "completed") {
      const result = row.result as { message: string; href: string | null };
      return {
        ok: true,
        status: "completed",
        message: result.message,
        href: result.href,
      };
    }

    const handler = this.operations.handlers[parsedOperation.data];
    const payload = row.payload as { args: Record<string, unknown> };
    let currentVersion: string | null = null;
    try {
      currentVersion = await handler.version(actor, payload.args);
    } catch {
      currentVersion = null;
    }

    // The row lock makes a double tap or a second tab wait, then see a used confirmation.
    const claim = await this.database.transaction(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(schema.adminAssistantConfirmations)
        .where(eq(schema.adminAssistantConfirmations.id, row.id))
        .for("update");
      const rejection = verifyConfirmation(
        locked
          ? {
              adminUserId: locked.adminUserId,
              operation: locked.operation,
              payload: locked.payload,
              payloadHash: locked.payloadHash,
              recordVersion: locked.recordVersion,
              tokenHash: locked.tokenHash,
              status: locked.status,
              expiresAt: locked.expiresAt,
            }
          : null,
        {
          adminUserId: actor.id,
          operation: parsedOperation.data,
          token: request.token,
        },
        currentVersion,
        new Date(),
      );
      // Permanent deletion needs an explicit acknowledgement and a token the card fetched moments ago.
      const destructiveRejection =
        !rejection && locked && locked.riskLevel >= 4
          ? request.acknowledged !== true
            ? ("not_acknowledged" as const)
            : !locked.tokenIssuedAt ||
                Date.now() - locked.tokenIssuedAt.getTime() >
                  DESTRUCTIVE_TOKEN_TTL_MS
              ? ("token_stale" as const)
              : null
          : null;
      if (destructiveRejection) {
        return {
          ok: false as const,
          rejection: destructiveRejection,
          status: locked?.status ?? "pending",
        };
      }
      if (rejection) {
        if (rejection === "expired" && locked?.status === "pending") {
          await transaction
            .update(schema.adminAssistantConfirmations)
            .set({ status: "expired", errorCode: "expired" })
            .where(eq(schema.adminAssistantConfirmations.id, row.id));
        }
        if (rejection === "stale" || rejection === "tampered") {
          await transaction
            .update(schema.adminAssistantConfirmations)
            .set({ status: "cancelled", errorCode: rejection })
            .where(eq(schema.adminAssistantConfirmations.id, row.id));
        }
        return {
          ok: false as const,
          rejection,
          status: locked?.status ?? "pending",
        };
      }
      await transaction
        .update(schema.adminAssistantConfirmations)
        .set({ status: "executing", usedAt: new Date() })
        .where(eq(schema.adminAssistantConfirmations.id, row.id));
      return { ok: true as const };
    });

    if (!claim.ok) {
      await this.toolRuns.record({
        conversationId: row.conversationId,
        adminUserId: actor.id,
        toolName,
        riskLevel: row.riskLevel as 2 | 3 | 4,
        status: "rejected",
        input: payload.args,
        errorCode: claim.rejection,
        durationMs: Date.now() - started,
      });
      const uncertain =
        claim.rejection === "already_used" && claim.status === "executing";
      return {
        ok: false,
        status: uncertain ? "executing" : "rejected",
        code: claim.rejection,
        message: uncertain
          ? "نتيجة هذه العملية غير مؤكدة بعد. افتحي السجل للتحقق قبل أي محاولة جديدة."
          : rejectionMessages[claim.rejection],
        href: (row.payload as { card: ConfirmationCard }).card.target.href,
      };
    }

    try {
      const result = await handler.execute(
        actor,
        payload.args,
        row.id,
        row.recordVersion,
      );
      await this.database
        .update(schema.adminAssistantConfirmations)
        .set({
          status: "completed",
          result: { message: result.message, href: result.href },
        })
        .where(eq(schema.adminAssistantConfirmations.id, row.id));
      await this.toolRuns.record({
        conversationId: row.conversationId,
        adminUserId: actor.id,
        toolName,
        riskLevel: row.riskLevel as 2 | 3 | 4,
        status: "succeeded",
        input: payload.args,
        resultRef: result.ref,
        durationMs: Date.now() - started,
      });
      await this.note(
        row.conversationId,
        row.id,
        `✅ ${result.message}`,
        "completed",
      );
      return {
        ok: true,
        status: "completed",
        message: result.message,
        href: result.href,
      };
    } catch (error) {
      const failure = assistantFailure(error);
      await this.database
        .update(schema.adminAssistantConfirmations)
        .set({ status: "failed", errorCode: failure.code.slice(0, 60) })
        .where(eq(schema.adminAssistantConfirmations.id, row.id));
      await this.toolRuns.record({
        conversationId: row.conversationId,
        adminUserId: actor.id,
        toolName,
        riskLevel: row.riskLevel as 2 | 3 | 4,
        status: "failed",
        input: payload.args,
        errorCode: failure.code,
        durationMs: Date.now() - started,
      });
      await this.note(
        row.conversationId,
        row.id,
        `❌ لم تتم العملية: ${failure.message}`,
        "failed",
      );
      return {
        ok: false,
        status: "failed",
        code: failure.code,
        message: failure.message,
        href: (row.payload as { card: ConfirmationCard }).card.target.href,
      };
    }
  }

  async cancel(actor: AdminActor, id: string): Promise<boolean> {
    const row = await this.load(actor, id);
    if (!row || row.status !== "pending") return false;
    await this.database
      .update(schema.adminAssistantConfirmations)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(schema.adminAssistantConfirmations.id, row.id),
          eq(schema.adminAssistantConfirmations.status, "pending"),
        ),
      );
    await this.note(
      row.conversationId,
      row.id,
      "أُلغيت العملية ولم يتغيّر شيء.",
      "cancelled",
    );
    return true;
  }

  async expirePending(now: Date): Promise<number> {
    const rows = await this.database
      .update(schema.adminAssistantConfirmations)
      .set({ status: "expired" })
      .where(
        and(
          eq(schema.adminAssistantConfirmations.status, "pending"),
          lt(schema.adminAssistantConfirmations.expiresAt, now),
        ),
      )
      .returning({ id: schema.adminAssistantConfirmations.id });
    return rows.length;
  }

  // Outcomes are written into the conversation so the model sees what really happened.
  private async note(
    conversationId: string | null,
    confirmationId: string,
    text: string,
    outcome: string,
  ) {
    if (!conversationId) return;
    await this.conversations.save(conversationId, [
      {
        id: `confirmation-${confirmationId}-${outcome}`,
        role: "assistant",
        parts: [{ type: "text", text }],
        metadata: { confirmationId, outcome },
      },
    ]);
  }
}
