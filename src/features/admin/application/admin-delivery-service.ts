import "server-only";

import { asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import {
  assertOwnerActor,
  type AdminActor,
} from "@/features/admin/domain/admin-actor";
import {
  assertSafeAuditState,
  redactServiceAreaAuditState,
} from "@/features/admin/domain/audit";
import {
  serviceAreaCodeSchema,
  serviceAreaSchema,
  type ServiceArea,
} from "@/features/delivery/service-area";
import * as schema from "@/server/db/schema";

export class AdminDeliveryError extends Error {
  constructor(readonly code: "not_found" | "invalid_input") {
    super(code);
    this.name = "AdminDeliveryError";
  }
}

export const adminServiceAreaUpdateSchema = z
  .object({
    code: serviceAreaCodeSchema,
    enabled: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
    deliveryFeeAgorot: z
      .number()
      .int()
      .nonnegative()
      .max(10_000_000)
      .nullable(),
  })
  .strict();

export type AdminServiceAreaUpdate = z.infer<
  typeof adminServiceAreaUpdateSchema
>;

export class AdminDeliveryService {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async list(actor: AdminActor): Promise<readonly ServiceArea[]> {
    assertOwnerActor(actor);
    const rows = await this.database
      .select()
      .from(schema.serviceAreas)
      .orderBy(
        asc(schema.serviceAreas.sortOrder),
        asc(schema.serviceAreas.code),
      );
    return rows.map(mapArea);
  }

  async update(
    actor: AdminActor,
    input: AdminServiceAreaUpdate,
  ): Promise<ServiceArea> {
    assertOwnerActor(actor);
    const parsed = adminServiceAreaUpdateSchema.safeParse(input);
    if (!parsed.success) throw new AdminDeliveryError("invalid_input");

    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(schema.serviceAreas)
        .where(eq(schema.serviceAreas.code, parsed.data.code))
        .for("update");
      if (!existing) throw new AdminDeliveryError("not_found");

      const now = new Date();
      const [row] = await transaction
        .update(schema.serviceAreas)
        .set({
          enabled: parsed.data.enabled,
          sortOrder: parsed.data.sortOrder,
          deliveryFeeAgorot: parsed.data.deliveryFeeAgorot,
          updatedAt: now,
        })
        .where(eq(schema.serviceAreas.id, existing.id))
        .returning();
      if (!row) throw new AdminDeliveryError("not_found");

      const beforeState = redactServiceAreaAuditState(existing);
      const afterState = redactServiceAreaAuditState(row);
      assertSafeAuditState(beforeState);
      assertSafeAuditState(afterState);
      await transaction.insert(schema.adminAuditEvents).values({
        adminUserId: actor.id,
        actionType: "service_area_update",
        entityType: "service_area",
        entityId: row.code,
        beforeState,
        afterState,
        createdAt: now,
      });
      return mapArea(row);
    });
  }
}

function mapArea(row: typeof schema.serviceAreas.$inferSelect): ServiceArea {
  return serviceAreaSchema.parse({
    code: row.code,
    nameAr: row.nameAr,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    deliveryFeeAgorot: row.deliveryFeeAgorot,
  });
}
