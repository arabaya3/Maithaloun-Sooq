import "server-only";

import { db } from "@/server/db/db";

import { SessionService } from "./session-service";

export const adminSessionService = new SessionService(db);
