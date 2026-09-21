import "server-only";

import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { AdminActor } from "@/features/admin/domain/admin-actor";
import * as schema from "@/server/db/schema";

import {
  LOGIN_FAILURE_MESSAGE,
  LOGIN_GLOBAL_LIMIT,
  LOGIN_HONEYPOT_MAX_LENGTH,
  LOGIN_PASSWORD_MAX_LENGTH,
  LOGIN_RATE_LIMIT,
  LOGIN_RATE_WINDOW_MS,
  LOGIN_USERNAME_MAX_LENGTH,
  MAX_LOGIN_REQUEST_BYTES,
} from "./login-policy";
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "./password";
import { PostgresRateLimiter } from "./postgres-rate-limiter";
import { hashRateLimitIdentifier } from "./rate-limit-key";
import { loginLockDelayMs } from "./rate-limit";
import { SessionService } from "./session-service";
import { normalizeAdminUsername } from "./username";

export type LoginResult =
  | {
      ok: true;
      actor: AdminActor;
      rawToken: string;
      expiresAt: Date;
    }
  | { ok: false; message: string };

export class LoginService {
  constructor(
    private readonly database: PostgresJsDatabase<typeof schema>,
    private readonly pepper: string,
    private readonly limiter = new PostgresRateLimiter(database),
    private readonly sessions = new SessionService(database),
  ) {}

  async login(input: {
    username: string;
    password: string;
    honeypot: string;
    requestSize: number;
    networkKey: string | null;
    currentToken: string | null;
  }): Promise<LoginResult> {
    if (
      input.requestSize > MAX_LOGIN_REQUEST_BYTES ||
      input.username.length > LOGIN_USERNAME_MAX_LENGTH ||
      input.password.length > LOGIN_PASSWORD_MAX_LENGTH ||
      input.honeypot.length > LOGIN_HONEYPOT_MAX_LENGTH ||
      input.honeypot.trim()
    ) {
      return { ok: false, message: LOGIN_FAILURE_MESSAGE };
    }

    const username = normalizeAdminUsername(input.username);
    const usernameHash = hashRateLimitIdentifier(
      this.pepper,
      "login-user",
      username ?? input.username.trim().toLowerCase(),
    );
    const globalHash = hashRateLimitIdentifier(
      this.pepper,
      "login-global",
      "all",
    );

    const [usernameLimit, globalLimit, networkLimit] = await Promise.all([
      this.limiter.hit({
        scope: "login-user",
        keyHash: usernameHash,
        limit: LOGIN_RATE_LIMIT,
        windowMs: LOGIN_RATE_WINDOW_MS,
        delayMs: loginLockDelayMs,
      }),
      this.limiter.hit({
        scope: "login-global",
        keyHash: globalHash,
        limit: LOGIN_GLOBAL_LIMIT,
        windowMs: LOGIN_RATE_WINDOW_MS,
        delayMs: loginLockDelayMs,
      }),
      input.networkKey
        ? this.limiter.hit({
            scope: "login-net",
            keyHash: hashRateLimitIdentifier(
              this.pepper,
              "login-net",
              input.networkKey,
            ),
            limit: LOGIN_RATE_LIMIT,
            windowMs: LOGIN_RATE_WINDOW_MS,
            delayMs: loginLockDelayMs,
          })
        : Promise.resolve({ allowed: true, retryAfterMs: 0 }),
    ]);

    if (
      !usernameLimit.allowed ||
      !globalLimit.allowed ||
      !networkLimit.allowed
    ) {
      return { ok: false, message: LOGIN_FAILURE_MESSAGE };
    }

    if (!username || !validatePasswordPolicy(input.password)) {
      return { ok: false, message: LOGIN_FAILURE_MESSAGE };
    }

    const [admin] = await this.database
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.username, username))
      .limit(1);

    const passwordMatches = admin
      ? await verifyPassword(input.password, admin.passwordHash)
      : await verifyPassword(input.password, await dummyHash());

    if (!admin || !admin.active || !passwordMatches) {
      return { ok: false, message: LOGIN_FAILURE_MESSAGE };
    }

    if (input.currentToken) {
      await this.sessions.revokeByToken(input.currentToken);
    }

    const session = await this.sessions.create(admin.id);
    await this.limiter.reset("login-user", usernameHash);
    if (input.networkKey) {
      await this.limiter.reset(
        "login-net",
        hashRateLimitIdentifier(this.pepper, "login-net", input.networkKey),
      );
    }

    await this.database.insert(schema.adminAuditEvents).values({
      adminUserId: admin.id,
      actionType: "login",
      entityType: "admin_user",
      entityId: admin.username,
      beforeState: null,
      afterState: { username: admin.username },
    });

    return {
      ok: true,
      actor: {
        id: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
        active: admin.active,
      },
      rawToken: session.rawToken,
      expiresAt: session.expiresAt,
    };
  }
}

let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("unused-dummy-password");
  return dummyHashPromise;
}
