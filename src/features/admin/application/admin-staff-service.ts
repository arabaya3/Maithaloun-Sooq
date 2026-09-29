import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import {
  hashPassword,
  validatePasswordPolicy,
} from "@/features/admin/auth/password";
import { normalizeAdminUsername } from "@/features/admin/auth/username";
import {
  assertOwnerActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import * as schema from "@/server/db/schema";

const staffInputSchema = z.object({
  username: z
    .string()
    .transform(normalizeAdminUsername)
    .pipe(z.string().min(3).max(32)),
  displayName: z.string().trim().min(2).max(80),
  password: z.string().refine(validatePasswordPolicy),
});

export class AdminStaffService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async upsertOperator(
    actor: AdminActor,
    input: { username: string; displayName: string; password: string },
  ): Promise<void> {
    assertOwnerActor(actor);
    const parsed = staffInputSchema.safeParse(input);
    if (!parsed.success) throw new Error("INVALID_STAFF");
    const now = new Date();
    const passwordHash = await hashPassword(parsed.data.password);

    await this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.username, parsed.data.username))
        .for("update");

      if (existing?.role === "owner") throw new Error("OWNER_USERNAME");
      const [staff] = existing
        ? await transaction
            .update(schema.adminUsers)
            .set({
              displayName: parsed.data.displayName,
              passwordHash,
              passwordChangedAt: now,
              active: true,
              updatedAt: now,
            })
            .where(eq(schema.adminUsers.id, existing.id))
            .returning()
        : await transaction
            .insert(schema.adminUsers)
            .values({
              username: parsed.data.username,
              displayName: parsed.data.displayName,
              passwordHash,
              role: "operator",
              active: true,
              passwordChangedAt: now,
            })
            .returning();
      if (!staff) throw new Error("STAFF_SAVE_FAILED");

      await transaction
        .update(schema.adminSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(schema.adminSessions.adminUserId, staff.id),
            isNull(schema.adminSessions.revokedAt),
          ),
        );
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: existing ? "operator_rotate" : "operator_create",
        entityType: "admin_user",
        entityId: staff.username,
        beforeState: existing
          ? { username: existing.username, active: existing.active }
          : null,
        afterState: {
          username: staff.username,
          active: true,
          role: "operator",
        },
      });
    });
  }
}
