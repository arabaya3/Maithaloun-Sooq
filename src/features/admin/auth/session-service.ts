import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import * as schema from "@/server/db/schema";

import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenFormat,
  sessionTokenHashesEqual,
} from "./session-token";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "./session-absolute";

export { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS };

export interface CreatedAdminSession {
  rawToken: string;
  expiresAt: Date;
}

export class SessionService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async create(
    adminUserId: string,
    now = new Date(),
  ): Promise<CreatedAdminSession> {
    const rawToken = generateSessionToken();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    await this.database.insert(schema.adminSessions).values({
      adminUserId,
      tokenHash: hashSessionToken(rawToken),
      createdAt: now,
      expiresAt,
      lastUsedAt: now,
    });
    return { rawToken, expiresAt };
  }

  async lookup(rawToken: string, now = new Date()): Promise<AdminActor | null> {
    if (!isSessionTokenFormat(rawToken)) return null;
    const tokenHash = hashSessionToken(rawToken);

    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          session: schema.adminSessions,
          admin: schema.adminUsers,
        })
        .from(schema.adminSessions)
        .innerJoin(
          schema.adminUsers,
          eq(schema.adminSessions.adminUserId, schema.adminUsers.id),
        )
        .where(eq(schema.adminSessions.tokenHash, tokenHash))
        .for("update");

      if (!row) return null;
      if (!sessionTokenHashesEqual(row.session.tokenHash, tokenHash)) {
        return null;
      }
      if (row.session.revokedAt) return null;
      if (row.session.expiresAt.getTime() <= now.getTime()) return null;
      if (now.getTime() - row.session.lastUsedAt.getTime() > SESSION_IDLE_MS) {
        await transaction
          .update(schema.adminSessions)
          .set({ revokedAt: now })
          .where(eq(schema.adminSessions.id, row.session.id));
        return null;
      }
      if (!row.admin.active) {
        await transaction
          .update(schema.adminSessions)
          .set({ revokedAt: now })
          .where(eq(schema.adminSessions.adminUserId, row.admin.id));
        return null;
      }

      await transaction
        .update(schema.adminSessions)
        .set({ lastUsedAt: now })
        .where(eq(schema.adminSessions.id, row.session.id));

      return {
        id: row.admin.id,
        username: row.admin.username,
        displayName: row.admin.displayName,
        role: row.admin.role,
        active: row.admin.active,
      };
    });
  }

  async revokeByToken(rawToken: string, now = new Date()): Promise<boolean> {
    if (!isSessionTokenFormat(rawToken)) return false;
    const tokenHash = hashSessionToken(rawToken);
    const updated = await this.database
      .update(schema.adminSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.adminSessions.tokenHash, tokenHash),
          isNull(schema.adminSessions.revokedAt),
        ),
      )
      .returning({ id: schema.adminSessions.id });
    return updated.length > 0;
  }

  async revokeAllForUser(adminUserId: string, now = new Date()): Promise<void> {
    await this.database
      .update(schema.adminSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.adminSessions.adminUserId, adminUserId),
          isNull(schema.adminSessions.revokedAt),
        ),
      );
  }
}
