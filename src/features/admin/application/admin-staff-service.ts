import "server-only";

import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import {
  hashPassword,
  validatePasswordPolicy,
} from "@/features/admin/auth/password";
import { hashSessionToken } from "@/features/admin/auth/session-token";
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

export class StaffError extends Error {
  constructor(readonly code: "not_found" | "owner_protected" | "own_session") {
    super(code);
    this.name = "StaffError";
  }
}

export interface StaffMember {
  id: string;
  username: string;
  displayName: string;
  role: "owner" | "operator";
  active: boolean;
  passwordChangedAt: string | null;
  lastActiveAt: string | null;
  sessions: Array<{
    id: string;
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
    /** The session this request is made with; it signs out from the header, not from here. */
    current: boolean;
  }>;
}

export class AdminStaffService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  /**
   * Everyone who can sign in, with their live sessions. Password and token hashes are never read,
   * so they cannot reach a page by accident.
   */
  async list(
    actor: AdminActor,
    currentToken: string | null,
    now = new Date(),
  ): Promise<StaffMember[]> {
    assertOwnerActor(actor);
    const currentHash = currentToken ? hashSessionToken(currentToken) : null;
    const users = await this.database
      .select({
        id: schema.adminUsers.id,
        username: schema.adminUsers.username,
        displayName: schema.adminUsers.displayName,
        role: schema.adminUsers.role,
        active: schema.adminUsers.active,
        passwordChangedAt: schema.adminUsers.passwordChangedAt,
      })
      .from(schema.adminUsers)
      .orderBy(asc(schema.adminUsers.role), asc(schema.adminUsers.username));
    const sessions = await this.database
      .select({
        id: schema.adminSessions.id,
        adminUserId: schema.adminSessions.adminUserId,
        createdAt: schema.adminSessions.createdAt,
        lastUsedAt: schema.adminSessions.lastUsedAt,
        expiresAt: schema.adminSessions.expiresAt,
        current: currentHash
          ? eq(schema.adminSessions.tokenHash, currentHash)
          : eq(schema.adminSessions.id, schema.adminSessions.id),
      })
      .from(schema.adminSessions)
      .where(
        and(
          isNull(schema.adminSessions.revokedAt),
          gt(schema.adminSessions.expiresAt, now),
        ),
      )
      .orderBy(desc(schema.adminSessions.lastUsedAt));
    return users.map((user) => {
      const own = sessions.filter((row) => row.adminUserId === user.id);
      return {
        ...user,
        passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
        lastActiveAt: own[0]?.lastUsedAt.toISOString() ?? null,
        sessions: own.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          current: Boolean(currentHash) && Boolean(row.current),
        })),
      };
    });
  }

  /** Signs one device out. The owner's own current session is left to the sign-out button. */
  async revokeSession(
    actor: AdminActor,
    sessionId: string,
    currentToken: string | null,
  ): Promise<void> {
    assertOwnerActor(actor);
    if (!z.uuid().safeParse(sessionId).success)
      throw new StaffError("not_found");
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          session: {
            id: schema.adminSessions.id,
            tokenHash: schema.adminSessions.tokenHash,
            revokedAt: schema.adminSessions.revokedAt,
          },
          username: schema.adminUsers.username,
        })
        .from(schema.adminSessions)
        .innerJoin(
          schema.adminUsers,
          eq(schema.adminUsers.id, schema.adminSessions.adminUserId),
        )
        .where(eq(schema.adminSessions.id, sessionId))
        .for("update");
      if (!row || row.session.revokedAt) throw new StaffError("not_found");
      if (
        currentToken &&
        row.session.tokenHash === hashSessionToken(currentToken)
      )
        throw new StaffError("own_session");
      await transaction
        .update(schema.adminSessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.adminSessions.id, sessionId));
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "session_revoke",
        entityType: "admin_user",
        entityId: row.username,
        beforeState: null,
        afterState: { revoked: true },
      });
    });
  }

  /** Turns an operator account off or back on; turning it off signs out every device at once. */
  async setOperatorActive(
    actor: AdminActor,
    userId: string,
    active: boolean,
  ): Promise<void> {
    assertOwnerActor(actor);
    if (!z.uuid().safeParse(userId).success) throw new StaffError("not_found");
    await this.database.transaction(async (transaction) => {
      const [user] = await transaction
        .select({
          id: schema.adminUsers.id,
          username: schema.adminUsers.username,
          role: schema.adminUsers.role,
          active: schema.adminUsers.active,
        })
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.id, userId))
        .for("update");
      if (!user) throw new StaffError("not_found");
      if (user.role === "owner") throw new StaffError("owner_protected");
      if (user.active === active) return;
      const now = new Date();
      await transaction
        .update(schema.adminUsers)
        .set({ active, updatedAt: now })
        .where(eq(schema.adminUsers.id, userId));
      if (!active) {
        await transaction
          .update(schema.adminSessions)
          .set({ revokedAt: now })
          .where(
            and(
              eq(schema.adminSessions.adminUserId, userId),
              isNull(schema.adminSessions.revokedAt),
            ),
          );
      }
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: active ? "operator_enable" : "operator_disable",
        entityType: "admin_user",
        entityId: user.username,
        beforeState: { active: user.active },
        afterState: { active },
      });
    });
  }

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
