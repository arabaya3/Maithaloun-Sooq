import "server-only";

import { db } from "@/server/db/db";
import { getServerEnv } from "@/server/env/env";

import { LoginService } from "./login-service";

export const loginService = new LoginService(
  db,
  getServerEnv().ORDER_RATE_LIMIT_PEPPER,
);
