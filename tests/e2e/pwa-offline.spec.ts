import { expect, test } from "@playwright/test";

// Serwist only emits the worker in production builds (`pnpm test:e2e:production`).
test.skip(
  process.env.E2E_EXTERNAL_SERVER !== "1",
  "the service worker is generated only by the production build",
);

test("production build serves the service worker and the offline page", async ({
  page,
  request,
}) => {
  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toContain("javascript");
  const source = await worker.text();
  expect(source).toContain("/~offline");
  expect(source).toContain("/admin");

  const offline = await request.get("/~offline");
  expect(offline.status()).toBe(200);

  await page.goto("/");
  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(new URL(scope).pathname).toBe("/");
});

test("authenticated, admin and API responses are never cacheable", async ({
  request,
}) => {
  for (const path of ["/admin", "/account", "/api/health"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl, path).toMatch(/no-store|private/);
    expect(cacheControl, path).not.toMatch(/\bpublic\b|s-maxage/);
  }
});
