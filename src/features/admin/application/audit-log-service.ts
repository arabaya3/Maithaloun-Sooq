import "server-only";

import { and, desc, eq, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import {
  assertOwnerActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import { auditActionLabel } from "@/features/admin/domain/audit-labels";
import * as schema from "@/server/db/schema";

export interface AuditLogEntry {
  id: string;
  at: string;
  actorName: string;
  actionType: string;
  label: string;
  entityType: string;
  entityId: string;
  before: Record<string, string | number | boolean | null> | null;
  after: Record<string, string | number | boolean | null> | null;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** Pass back as `before` to read the next, older page. */
  nextCursor: string | null;
}

const PAGE = 40;

export class AuditLogService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  /** The audit trail, newest first. Owner only: it names every account and what it changed. */
  async list(
    actor: AdminActor,
    query: { actorId?: string; entityType?: string; before?: string } = {},
  ): Promise<AuditLogPage> {
    assertOwnerActor(actor);
    const actorId = z.uuid().safeParse(query.actorId);
    const entityType = z
      .string()
      .regex(/^[a-z_]{2,40}$/)
      .safeParse(query.entityType);
    const before = z.iso.datetime().safeParse(query.before);
    const rows = await this.database
      .select({
        id: schema.adminAuditEvents.id,
        createdAt: schema.adminAuditEvents.createdAt,
        actorName: schema.adminUsers.displayName,
        actionType: schema.adminAuditEvents.actionType,
        entityType: schema.adminAuditEvents.entityType,
        entityId: schema.adminAuditEvents.entityId,
        before: schema.adminAuditEvents.beforeState,
        after: schema.adminAuditEvents.afterState,
      })
      .from(schema.adminAuditEvents)
      .innerJoin(
        schema.adminUsers,
        eq(schema.adminUsers.id, schema.adminAuditEvents.adminUserId),
      )
      .where(
        and(
          actorId.success
            ? eq(schema.adminAuditEvents.adminUserId, actorId.data)
            : undefined,
          entityType.success
            ? eq(schema.adminAuditEvents.entityType, entityType.data)
            : undefined,
          before.success
            ? lt(schema.adminAuditEvents.createdAt, new Date(before.data))
            : undefined,
        ),
      )
      .orderBy(desc(schema.adminAuditEvents.createdAt))
      .limit(PAGE + 1);
    const entries = rows.slice(0, PAGE).map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      actorName: row.actorName,
      actionType: row.actionType,
      label: auditActionLabel(row.actionType, row.entityType),
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before ?? null,
      after: row.after ?? null,
    }));
    return {
      entries,
      nextCursor: rows.length > PAGE ? (entries.at(-1)?.at ?? null) : null,
    };
  }

  /** Accounts and entity types that appear in the log, for the filters. */
  async filters(actor: AdminActor) {
    assertOwnerActor(actor);
    const [actors, entities] = await Promise.all([
      this.database
        .selectDistinct({
          id: schema.adminUsers.id,
          name: schema.adminUsers.displayName,
        })
        .from(schema.adminUsers)
        .innerJoin(
          schema.adminAuditEvents,
          eq(schema.adminAuditEvents.adminUserId, schema.adminUsers.id),
        ),
      this.database
        .selectDistinct({ type: schema.adminAuditEvents.entityType })
        .from(schema.adminAuditEvents),
    ]);
    return {
      actors: actors.sort((a, b) => a.name.localeCompare(b.name, "ar")),
      entityTypes: entities.map((row) => row.type).sort(),
    };
  }
}
