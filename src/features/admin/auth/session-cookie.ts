import { SESSION_ABSOLUTE_MS } from "./session-absolute";

export function getAdminSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-souq-admin"
    : "souq_admin_session";
}

export function getAdminSessionCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: isProduction,
    path: isProduction ? "/" : "/admin",
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  };
}
