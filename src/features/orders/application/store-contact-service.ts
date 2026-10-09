import "server-only";

import { eq } from "drizzle-orm";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import { assertPermission } from "@/features/admin/domain/permissions";
import type { Database } from "@/features/inventory/application/stock-ledger";
import * as schema from "@/server/db/schema";

import {
  isSupportedWhatsAppE164,
  normalizeWhatsAppPhone,
  type WhatsAppCountryCode,
} from "../domain/phone";
import { STORE_WHATSAPP_KEY } from "../domain/whatsapp-order";

export class StoreContactError extends Error {
  constructor(readonly code: "invalid_number") {
    super(code);
    this.name = "StoreContactError";
  }
}

/** The store's own WhatsApp number, chosen by the owner; customers write to it to confirm orders. */
export class StoreContactService {
  constructor(private readonly database: Database) {}

  async whatsAppNumber(): Promise<string | null> {
    const [row] = await this.database
      .select({ value: schema.storeSettings.value })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.key, STORE_WHATSAPP_KEY))
      .limit(1);
    return typeof row?.value === "string" && isSupportedWhatsAppE164(row.value)
      ? row.value
      : null;
  }

  /** An empty number turns the WhatsApp ordering option off. */
  async setWhatsAppNumber(
    actor: AdminActor,
    input: { countryCode: WhatsAppCountryCode; nationalNumber: string },
  ): Promise<string | null> {
    assertPermission(actor, "settings.manage");
    const value = input.nationalNumber.trim()
      ? normalizeWhatsAppPhone(input.countryCode, input.nationalNumber)
      : null;
    if (input.nationalNumber.trim() && !value) {
      throw new StoreContactError("invalid_number");
    }
    const before = await this.whatsAppNumber();
    const now = new Date();
    const stored = value ?? "";
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(schema.storeSettings)
        .values({
          key: STORE_WHATSAPP_KEY,
          value: stored,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.storeSettings.key,
          set: { value: stored, updatedBy: actor.id, updatedAt: now },
        });
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "settings_update",
        entityType: "store_settings",
        entityId: STORE_WHATSAPP_KEY,
        beforeState: { value: before },
        afterState: { value },
      });
    });
    return value;
  }
}
