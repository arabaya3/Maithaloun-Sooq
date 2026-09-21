import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  serviceAreaCodeSchema,
  serviceAreaSchema,
  type ServiceArea,
  type ServiceAreaRepository,
} from "@/features/delivery/service-area";
import * as schema from "@/server/db/schema";

function mapServiceArea(
  row: typeof schema.serviceAreas.$inferSelect,
): ServiceArea {
  return serviceAreaSchema.parse({
    code: row.code,
    nameAr: row.nameAr,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    deliveryFeeAgorot: row.deliveryFeeAgorot,
  });
}

export class PostgresServiceAreaRepository implements ServiceAreaRepository {
  constructor(private readonly database: PostgresJsDatabase<typeof schema>) {}

  async listEnabled(): Promise<readonly ServiceArea[]> {
    const rows = await this.database
      .select()
      .from(schema.serviceAreas)
      .where(eq(schema.serviceAreas.enabled, true))
      .orderBy(asc(schema.serviceAreas.sortOrder));
    return rows.map(mapServiceArea);
  }

  async getEnabledByCode(code: string): Promise<ServiceArea | null> {
    if (!serviceAreaCodeSchema.safeParse(code).success) return null;
    const [row] = await this.database
      .select()
      .from(schema.serviceAreas)
      .where(
        and(
          eq(schema.serviceAreas.code, code),
          eq(schema.serviceAreas.enabled, true),
        ),
      )
      .limit(1);
    return row ? mapServiceArea(row) : null;
  }
}
