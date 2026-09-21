import { createHmac } from "node:crypto";

export function hashRateLimitIdentifier(
  pepper: string,
  scope: string,
  identifier: string,
): string {
  return createHmac("sha256", pepper)
    .update(`${scope}:${identifier}`, "utf8")
    .digest("hex");
}

export function getApprovedNetworkKey(
  headers: Headers,
  trustProxy: boolean,
): string | null {
  if (!trustProxy) return null;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const client = forwarded.split(",")[0]?.trim();
    if (client && client.length <= 45) return client;
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp && realIp.length <= 45) return realIp;
  return null;
}
