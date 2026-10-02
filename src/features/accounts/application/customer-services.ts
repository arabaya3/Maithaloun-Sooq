import "server-only";

import { PostgresRateLimiter } from "@/features/admin/auth/postgres-rate-limiter";
import { db } from "@/server/db/db";
import { getServerEnv } from "@/server/env/env";

import { CustomerAccountService } from "./customer-account-service";
import { CustomerAuthService } from "./customer-auth-service";
import { CustomerFavoritesService } from "./customer-favorites-service";
import { CustomerOrdersService } from "./customer-orders-service";
import { createPhoneOtpProvider } from "./otp-provider";

export const customerAuthService = new CustomerAuthService(
  db,
  new PostgresRateLimiter(db),
  createPhoneOtpProvider(),
  getServerEnv().ORDER_RATE_LIMIT_PEPPER,
);
export const customerAccountService = new CustomerAccountService(db);
export const customerFavoritesService = new CustomerFavoritesService(db);
export const customerOrdersService = new CustomerOrdersService(db);
