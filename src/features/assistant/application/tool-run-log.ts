import "server-only";

import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";
import { logEvent } from "@/server/log/ops-log";

import type { RiskLevel } from "../domain/assistant-policy";
import { summarizeToolInput } from "../domain/redaction";

export interface ToolRunRecord {
  conversationId: string | null;
  adminUserId: string;
  toolName: string;
  riskLevel: RiskLevel;
  status: "succeeded" | "failed" | "rejected";
  input: unknown;
  resultRef?: string | null;
  errorCode?: string | null;
  durationMs: number;
}

export class ToolRunLog {
  constructor(private readonly database: Database) {}

  async record(run: ToolRunRecord): Promise<void> {
    logEvent(run.status === "failed" ? "warn" : "info", "assistant.tool", {
      tool: run.toolName,
      risk: run.riskLevel,
      status: run.status,
      code: run.errorCode ?? null,
      durationMs: run.durationMs,
    });
    await this.database.insert(schema.adminAssistantToolRuns).values({
      conversationId: run.conversationId,
      adminUserId: run.adminUserId,
      toolName: run.toolName,
      riskLevel: run.riskLevel,
      status: run.status,
      inputSummary: summarizeToolInput(run.input),
      resultRef: run.resultRef?.slice(0, 160) ?? null,
      errorCode: run.errorCode?.slice(0, 60) ?? null,
      durationMs: Math.max(0, Math.round(run.durationMs)),
    });
  }
}
