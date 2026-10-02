import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { PostgresRateLimiter } from "@/features/admin/auth/postgres-rate-limiter";
import { hashRateLimitIdentifier } from "@/features/admin/auth/rate-limit-key";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenFormat,
} from "@/features/admin/auth/session-token";
import {
  CUSTOMER_SESSION_ABSOLUTE_MS,
  CUSTOMER_SESSION_IDLE_MS,
  OTP_CODE_PATTERN,
} from "@/features/accounts/domain/account-config";
import { isSupportedWhatsAppE164 } from "@/features/orders/domain/phone";
import * as schema from "@/server/db/schema";

import type { PhoneOtpProvider } from "./otp-provider";

const MINUTE_MS = 60_000;

export interface CustomerActor {
  id: string;
  phoneE164: string;
  displayName: string | null;
}

export type RequestCodeResult = "sent" | "rate_limited" | "unavailable";
export type VerifyCodeResult =
  | { status: "verified"; rawToken: string; expiresAt: Date; created: boolean }
  | { status: "invalid" | "rate_limited" | "unavailable" };

type Database = PostgresJsDatabase<typeof schema>;

export class CustomerAuthService {
  constructor(
    private readonly database: Database,
    private readonly limiter: PostgresRateLimiter,
    private readonly provider: PhoneOtpProvider | null,
    private readonly pepper: string,
  ) {}

  private key(scope: string, identifier: string) {
    return hashRateLimitIdentifier(this.pepper, scope, identifier);
  }

  private async allow(
    scope: string,
    identifier: string,
    limit: number,
    windowMs: number,
  ) {
    const result = await this.limiter.hit({
      scope,
      keyHash: this.key(scope, identifier),
      limit,
      windowMs,
    });
    return result.allowed;
  }

  // The same answer is returned whether or not an account exists for the number.
  async requestCode(
    phoneE164: string,
    networkKey: string | null,
  ): Promise<RequestCodeResult> {
    if (!this.provider) return "unavailable";
    if (!isSupportedWhatsAppE164(phoneE164)) return "sent";
    const allowed =
      (await this.allow("customer_otp_phone", phoneE164, 3, 15 * MINUTE_MS)) &&
      (await this.allow(
        "customer_otp_phone_day",
        phoneE164,
        8,
        1_440 * MINUTE_MS,
      )) &&
      (!networkKey ||
        (await this.allow(
          "customer_otp_network",
          networkKey,
          10,
          15 * MINUTE_MS,
        )));
    if (!allowed) return "rate_limited";
    await this.provider.send(phoneE164);
    return "sent";
  }

  async verifyCode(input: {
    phoneE164: string;
    code: string;
    networkKey: string | null;
    previousToken: string | null;
    now?: Date;
  }): Promise<VerifyCodeResult> {
    if (!this.provider) return { status: "unavailable" };
    const now = input.now ?? new Date();
    const allowed =
      (await this.allow(
        "customer_verify_phone",
        input.phoneE164,
        5,
        15 * MINUTE_MS,
      )) &&
      (!input.networkKey ||
        (await this.allow(
          "customer_verify_network",
          input.networkKey,
          20,
          15 * MINUTE_MS,
        )));
    if (!allowed) return { status: "rate_limited" };
    if (
      !isSupportedWhatsAppE164(input.phoneE164) ||
      !OTP_CODE_PATTERN.test(input.code) ||
      !(await this.provider.verify(input.phoneE164, input.code))
    ) {
      return { status: "invalid" };
    }

    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: schema.customerAccounts.id })
        .from(schema.customerAccounts)
        .where(
          and(
            eq(schema.customerAccounts.phoneE164, input.phoneE164),
            isNull(schema.customerAccounts.deletedAt),
          ),
        )
        .for("update");
      let accountId = existing?.id;
      if (!accountId) {
        const [created] = await transaction
          .insert(schema.customerAccounts)
          .values({ phoneE164: input.phoneE164, lastLoginAt: now })
          .returning({ id: schema.customerAccounts.id });
        accountId = created!.id;
        await transaction.insert(schema.customerAccountEvents).values({
          accountId,
          type: "account_created",
        });
      } else {
        await transaction
          .update(schema.customerAccounts)
          .set({ lastLoginAt: now })
          .where(eq(schema.customerAccounts.id, accountId));
      }

      // A fresh token every login; any session the browser already carried is revoked.
      if (input.previousToken && isSessionTokenFormat(input.previousToken)) {
        await transaction
          .update(schema.customerSessions)
          .set({ revokedAt: now })
          .where(
            eq(
              schema.customerSessions.tokenHash,
              hashSessionToken(input.previousToken),
            ),
          );
      }
      const rawToken = generateSessionToken();
      const expiresAt = new Date(now.getTime() + CUSTOMER_SESSION_ABSOLUTE_MS);
      await transaction.insert(schema.customerSessions).values({
        accountId,
        tokenHash: hashSessionToken(rawToken),
        createdAt: now,
        expiresAt,
        lastUsedAt: now,
      });
      await transaction.insert(schema.customerAccountEvents).values({
        accountId,
        type: "login",
      });
      return {
        status: "verified" as const,
        rawToken,
        expiresAt,
        created: !existing,
      };
    });
  }

  async lookup(
    rawToken: string,
    now = new Date(),
  ): Promise<CustomerActor | null> {
    if (!isSessionTokenFormat(rawToken)) return null;
    const [row] = await this.database
      .select({
        sessionId: schema.customerSessions.id,
        expiresAt: schema.customerSessions.expiresAt,
        lastUsedAt: schema.customerSessions.lastUsedAt,
        revokedAt: schema.customerSessions.revokedAt,
        account: schema.customerAccounts,
      })
      .from(schema.customerSessions)
      .innerJoin(
        schema.customerAccounts,
        eq(schema.customerSessions.accountId, schema.customerAccounts.id),
      )
      .where(eq(schema.customerSessions.tokenHash, hashSessionToken(rawToken)))
      .limit(1);
    if (
      !row ||
      row.revokedAt ||
      row.account.deletedAt ||
      !row.account.phoneE164 ||
      row.expiresAt.getTime() <= now.getTime() ||
      now.getTime() - row.lastUsedAt.getTime() > CUSTOMER_SESSION_IDLE_MS
    ) {
      return null;
    }
    if (now.getTime() - row.lastUsedAt.getTime() > 60 * MINUTE_MS) {
      await this.database
        .update(schema.customerSessions)
        .set({ lastUsedAt: now })
        .where(eq(schema.customerSessions.id, row.sessionId));
    }
    return {
      id: row.account.id,
      phoneE164: row.account.phoneE164,
      displayName: row.account.displayName,
    };
  }

  async logout(rawToken: string, now = new Date()): Promise<void> {
    if (!isSessionTokenFormat(rawToken)) return;
    await this.database
      .update(schema.customerSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.customerSessions.tokenHash, hashSessionToken(rawToken)),
          isNull(schema.customerSessions.revokedAt),
        ),
      );
  }

  async logoutAll(accountId: string, now = new Date()): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(schema.customerSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(schema.customerSessions.accountId, accountId),
            isNull(schema.customerSessions.revokedAt),
          ),
        );
      await transaction
        .insert(schema.customerAccountEvents)
        .values({ accountId, type: "logout_all" });
    });
  }
}
