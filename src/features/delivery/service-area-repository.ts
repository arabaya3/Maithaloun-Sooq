import "server-only";

import type { ServiceAreaRepository } from "@/features/delivery/service-area";
import { db } from "@/server/db/db";

import { PostgresServiceAreaRepository } from "./postgres-service-area-repository";

export const serviceAreaRepository: ServiceAreaRepository =
  new PostgresServiceAreaRepository(db);
