import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/server/db/schema";

import { hashPassword, validatePasswordPolicy } from "./password";
import { SessionService } from "./session-service";
import { normalizeAdminUsername } from "./username";

export class OwnerBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerBootstrapError";
  }
}

export class OwnerService {
  constructor(
    private readonly database: PostgresJsDatabase<typeof schema>,
    private readonly sessions = new SessionService(database),
  ) {}

  async createOrRotate(input: {
    username: string;
    displayName: string;
    password: string;
    databaseName: string;
  }): Promise<{ created: boolean }> {
    if (input.databaseName !== "maithalun_dev") {
      throw new OwnerBootstrapError("LOCAL_DEV_ONLY");
    }
    return this.upsertOwner(input, { allowSecondOwner: false });
  }

  async createFirstProductionOwner(input: {
    username: string;
    displayName: string;
    password: string;
    databaseName: string;
  }): Promise<{ created: boolean }> {
    if (input.databaseName !== "production") {
      throw new OwnerBootstrapError("PRODUCTION_DB_REQUIRED");
    }
    return this.upsertOwner(input, {
      allowSecondOwner: false,
      createOnly: true,
    });
  }

  async createTestOwner(input: {
    username: string;
    displayName: string;
    password: string;
    databaseName: string;
  }): Promise<{ id: string; username: string }> {
    if (input.databaseName !== "maithalun_test") {
      throw new OwnerBootstrapError("TEST_DB_ONLY");
    }
    const username = this.validateInput(input);
    const passwordHash = await hashPassword(input.password);
    const [created] = await this.database
      .insert(schema.adminUsers)
      .values({
        username,
        displayName: input.displayName.trim(),
        passwordHash,
        role: "owner",
        active: true,
        passwordChangedAt: new Date(),
      })
      .onConflictDoNothing({ target: schema.adminUsers.username })
      .returning({
        id: schema.adminUsers.id,
        username: schema.adminUsers.username,
      });

    if (created) return created;

    const [existing] = await this.database
      .select({
        id: schema.adminUsers.id,
        username: schema.adminUsers.username,
      })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.username, username))
      .limit(1);
    if (!existing) throw new OwnerBootstrapError("OWNER_CREATE_FAILED");
    return existing;
  }

  private async upsertOwner(
    input: {
      username: string;
      displayName: string;
      password: string;
    },
    options: { allowSecondOwner: boolean; createOnly?: boolean },
  ): Promise<{ created: boolean }> {
    const username = this.validateInput(input);
    const passwordHash = await hashPassword(input.password);
    const now = new Date();

    return this.database.transaction(async (transaction) => {
      const [existingOwner] = await transaction
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.role, "owner"))
        .limit(1);

      if (!existingOwner) {
        const [created] = await transaction
          .insert(schema.adminUsers)
          .values({
            username,
            displayName: input.displayName.trim(),
            passwordHash,
            role: "owner",
            active: true,
            passwordChangedAt: now,
          })
          .returning({ id: schema.adminUsers.id });
        if (!created) throw new OwnerBootstrapError("OWNER_CREATE_FAILED");
        await transaction.insert(schema.adminAuditEvents).values({
          adminUserId: created.id,
          actionType: "password_change",
          entityType: "admin_user",
          entityId: username,
          beforeState: null,
          afterState: { username, created: true },
        });
        return { created: true };
      }

      if (options.createOnly) {
        throw new OwnerBootstrapError("OWNER_EXISTS");
      }

      if (existingOwner.username !== username) {
        throw new OwnerBootstrapError("OWNER_EXISTS");
      }
      if (options.allowSecondOwner) {
        throw new OwnerBootstrapError("OWNER_EXISTS");
      }

      await transaction
        .update(schema.adminUsers)
        .set({
          displayName: input.displayName.trim() || existingOwner.displayName,
          passwordHash,
          passwordChangedAt: now,
          updatedAt: now,
          active: true,
        })
        .where(eq(schema.adminUsers.id, existingOwner.id));
      await this.sessions.revokeAllForUser(existingOwner.id, now);
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: existingOwner.id,
        actionType: "password_change",
        entityType: "admin_user",
        entityId: username,
        beforeState: { username },
        afterState: { username, rotated: true },
      });
      return { created: false };
    });
  }

  private validateInput(input: {
    username: string;
    displayName: string;
    password: string;
  }): string {
    const username = normalizeAdminUsername(input.username);
    const displayName = input.displayName.trim();
    if (!username) throw new OwnerBootstrapError("INVALID_USERNAME");
    if (displayName.length < 2 || displayName.length > 80) {
      throw new OwnerBootstrapError("INVALID_DISPLAY_NAME");
    }
    if (!validatePasswordPolicy(input.password)) {
      throw new OwnerBootstrapError("PASSWORD_POLICY");
    }
    return username;
  }
}
