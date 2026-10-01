import "server-only";

import {
  adminCatalogService,
  adminOrderService,
  assistantConfirmations,
  assistantOperations,
  assistantToolRuns,
  customerService,
  inventoryService,
  purchaseService,
  reportService,
  salesService,
} from "@/features/admin/application/admin-services";
import {
  jsonNoStore,
  unauthorizedJson,
} from "@/features/admin/auth/admin-api-response";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { authorizeAdminApi } from "@/features/admin/auth/authorize-admin-api";
import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { db } from "@/server/db/db";

import {
  assistantMode,
  canUseAssistant,
  type AssistantMode,
} from "../domain/assistant-policy";
import type { AssistantToolContext } from "./assistant-tools";

export function currentAssistantMode(): AssistantMode {
  return assistantMode(process.env.ADMIN_ASSISTANT);
}

export const assistantLimits = {
  chat: { scope: "admin_assistant_chat", perHour: 120 },
  upload: { scope: "admin_assistant_upload", perHour: 60 },
  mutation: { scope: "admin_assistant_mutation", perHour: 60 },
} as const;

// Every assistant endpoint passes here: session, same-origin for writes, owner role, feature flag, rate limit.
export async function authorizeAssistant(
  request: Request,
  options: { mutation: boolean; limit?: keyof typeof assistantLimits },
): Promise<{ actor: AdminActor; mode: AssistantMode } | Response> {
  const actor = await authorizeAdminApi(request, options.mutation);
  if (!actor) return unauthorizedJson();
  const mode = currentAssistantMode();
  if (!canUseAssistant(actor, mode)) {
    return jsonNoStore(
      { ok: false, message: "المساعد غير مفعّل لهذا الحساب." },
      403,
    );
  }
  if (options.limit) {
    const limit = assistantLimits[options.limit];
    if (!(await allowAdminRequest(actor, limit.scope, limit.perHour))) {
      return jsonNoStore(
        {
          ok: false,
          message: "طلبات كثيرة خلال وقت قصير. انتظري قليلاً ثم حاولي.",
        },
        429,
      );
    }
  }
  return { actor, mode };
}

export function assistantToolContext(
  actor: AdminActor,
  conversationId: string,
  mode: AssistantMode,
): AssistantToolContext {
  return {
    actor,
    conversationId,
    mode,
    database: db,
    catalog: adminCatalogService,
    inventory: inventoryService,
    orders: adminOrderService,
    customers: customerService,
    sales: salesService,
    reports: reportService,
    purchases: purchaseService,
    operations: assistantOperations,
    confirmations: assistantConfirmations,
    toolRuns: assistantToolRuns,
  };
}
