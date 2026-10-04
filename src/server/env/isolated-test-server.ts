// A production build started by the e2e gate against the local test database.
// It may use the same test doubles as development; a deployed server never can,
// because it would also need the flag, no Vercel runtime and the local maithalun_test database.
export function isIsolatedTestServer(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (environment.E2E_ISOLATED_TEST_SERVER !== "1") return false;
  if (environment.VERCEL) return false;
  try {
    const url = new URL(environment.DATABASE_URL ?? "");
    return (
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.pathname === "/maithalun_test"
    );
  } catch {
    return false;
  }
}

// Development, or the isolated production-build test server.
export function testDoublesAllowed(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return (
    (environment.NODE_ENV !== "production" && !environment.VERCEL) ||
    isIsolatedTestServer(environment)
  );
}
