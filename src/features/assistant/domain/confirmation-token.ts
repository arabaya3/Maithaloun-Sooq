import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function payloadHash(operation: string, payload: unknown): string {
  return sha256(`${operation}\n${canonicalJson(payload)}`);
}

export function issueConfirmationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

export function tokenMatches(token: string, storedHash: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const actual = Buffer.from(sha256(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type ConfirmationRejection =
  | "not_found"
  | "wrong_owner"
  | "wrong_operation"
  | "bad_token"
  | "expired"
  | "already_used"
  | "tampered"
  | "stale";

export interface StoredConfirmation {
  adminUserId: string;
  operation: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  recordVersion: string;
  tokenHash: string;
  status: string;
  expiresAt: Date;
}

// Every check fails closed; the first failing reason is reported.
export function verifyConfirmation(
  stored: StoredConfirmation | null,
  request: { adminUserId: string; operation: string; token: string },
  currentVersion: string | null,
  now: Date,
): ConfirmationRejection | null {
  if (!stored) return "not_found";
  if (stored.adminUserId !== request.adminUserId) return "wrong_owner";
  if (stored.operation !== request.operation) return "wrong_operation";
  if (!tokenMatches(request.token, stored.tokenHash)) return "bad_token";
  if (stored.status !== "pending") return "already_used";
  if (stored.expiresAt.getTime() <= now.getTime()) return "expired";
  if (payloadHash(stored.operation, stored.payload) !== stored.payloadHash) {
    return "tampered";
  }
  if (currentVersion === null || currentVersion !== stored.recordVersion) {
    return "stale";
  }
  return null;
}
