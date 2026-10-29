import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { environment, login, trackPageIssues, withTestDb } from "./support";

// The server is a production build, the runner is not: both session cookie names, made up.
const FORGED_SESSION = "__Host-souq-admin=forged; souq_admin_session=forged";

// The whole Reel path on an isolated server: the owner shapes a Reel, the real render-only worker
// (tools/social-render-worker.ts with FFmpeg) renders it into the local media store, and the
// owner plays and downloads it from the dashboard. The worker gets the test database only, and
// no Supabase, Make or Meta settings.
function runWorker(origin: string) {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      "tools/social-render-worker.ts",
      "1",
    ],
    {
      encoding: "utf8",
      timeout: 180_000,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NODE_ENV: "production",
        REELS_RENDER_WORKER: "on",
        DATABASE_URL: environment.TEST_DATABASE_URL,
        // Empty, so .env.local can fill nothing in: the local media store, never Storage.
        SUPABASE_URL: "",
        SUPABASE_SECRET_KEY: "",
        APP_ORIGIN: origin,
        SOCIAL_PUBLIC_ORIGIN: origin,
        SOCIAL_CATALOG_ORIGIN: origin,
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {
    rendered: number;
    failed: number;
  };
}

// The isolated catalog has no product with a public https photo (the only kind a Reel may show),
// so the path runs on «ميثو يعرّف بمايثا», which shows Meetho and the store's delivery facts.
async function shapeReel(page: Page, hook: string) {
  await page.goto("/admin/social/reels");
  const settings = page.getByRole("complementary", { name: "إعدادات الريل" });
  await settings.locator('select[name="concept"]').selectOption("meet-meetho");
  await settings.locator('select[name="seconds"]').selectOption("10");
  await settings.locator('input[name="hookText"]').fill(hook);
  await settings.getByRole("button", { name: "اعرضي اللوحة" }).click();
  await expect(page.locator(".social-storyboard img").first()).toBeVisible();
}

/**
 * What a price change does to a stored Reel: today's catalog no longer draws the storyboard it was
 * asked for. Real price changes against the real rebuild are covered by the database tests; here
 * the stored fingerprint is changed instead, since the isolated catalog's facts are constants.
 */
async function catalogMovesOn() {
  await withTestDb(
    (sql) =>
      sql`update social_reel_renders set storyboard_key = repeat('0', 64)`,
  );
}

test.describe.configure({ mode: "serial" });

test("a Reel goes from idea to a playable, downloadable video; nothing is posted", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(300_000);
  const issues = trackPageIssues(page);
  await withTestDb(async (sql) => {
    await sql`delete from social_reel_renders`;
    await sql`delete from social_posts`;
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await shapeReel(page, "أهلا من ميثو");
  await page.getByRole("button", { name: "اطلبي تجهيز الفيديو" }).click();
  await expect(page.getByText("بانتظار عامل الفيديو")).toBeVisible();

  expect(runWorker(baseURL!)).toEqual({ rendered: 1, failed: 0 });
  await page.reload();

  // Plays in the dashboard: a 1080×1920 video whose time moves.
  const video = page.locator(".social-render video").first();
  await expect(video).toBeVisible();
  const played = await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      width: element.videoWidth,
      height: element.videoHeight,
      duration: element.duration,
      time: element.currentTime,
    };
  });
  expect(played).toMatchObject({ width: 1080, height: 1920 });
  expect(played.duration).toBeGreaterThan(9);
  expect(played.time).toBeGreaterThan(0.5);
  await page.screenshot({
    path: testInfo.outputPath("reel-ready.png"),
    fullPage: true,
  });

  // Downloads as a file, not a page.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "نزّلي الفيديو" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^maytha-reel-[0-9a-f]{8}\.mp4$/,
  );
  const file = testInfo.outputPath("downloaded-reel.mp4");
  await download.saveAs(file);
  const bytes = readFileSync(file);
  expect(bytes.length).toBeGreaterThan(100_000);
  expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  );
  expect(probe.stdout.trim()).toBe("h264,1080,1920");

  const [renders, posts] = await withTestDb(async (sql) => [
    await sql<{ status: string; attempts: number }[]>`
      select status, attempts from social_reel_renders`,
    await sql`select id from social_posts`,
  ]);
  expect(renders).toEqual([{ status: "ready", attempts: 1 }]);
  expect(posts).toEqual([]);

  // The catalog changes after the Reel was made: it is marked, hidden and refused for download.
  await catalogMovesOn();
  await page.reload();
  await expect(
    page.getByText(/فوقفناه عشان ما يطلع بأسعار قديمة/),
  ).toBeVisible();
  await expect(page.locator(".social-render video")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "نزّلي الفيديو" })).toHaveCount(
    0,
  );
  const [render] = await withTestDb(
    (sql) => sql<{ id: string }[]>`select id from social_reel_renders`,
  );
  const refused = await page.request.get(
    `/admin/api/social/reels/${render!.id}/video`,
  );
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "prices_changed" });
  expect(issues.consoleErrors).toEqual([]);
});

test("a catalog change before the worker runs fails the Reel instead of rendering old prices", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await withTestDb((sql) => sql`delete from social_reel_renders`);
  await login(page);
  await shapeReel(page, "ميثو بيسلّم عليكم");
  await page.getByRole("button", { name: "اطلبي تجهيز الفيديو" }).click();
  await expect(page.getByText("بانتظار عامل الفيديو")).toBeVisible();
  await catalogMovesOn();
  expect(runWorker(baseURL!)).toEqual({ rendered: 0, failed: 1 });
  await page.reload();
  await expect(
    page.getByText(
      "تغيّر سعر أو منتج منذ الطلب؛ اطلبي الريل من جديد بأسعار اليوم.",
    ),
  ).toBeVisible();
  // Another try would draw the same old prices: no retry button for it.
  await expect(
    page.getByRole("button", { name: "أعيدي المحاولة" }),
  ).toHaveCount(0);
  const [render] = await withTestDb(
    (sql) => sql<{ status: string; video_url: string | null }[]>`
      select status, video_url from social_reel_renders`,
  );
  expect(render).toEqual({ status: "failed", video_url: null });
});

test("without a signed-in admin, Reel videos, campaign files and artwork are refused", async ({
  playwright,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  for (const url of [
    "/admin/api/social/reels/00000000-0000-0000-0000-000000000000/video",
    "/admin/api/social/campaigns/00000000-0000-0000-0000-000000000000/export?format=square",
    "/admin/api/social/mascot/presenting",
  ]) {
    // No session: sent to the sign-in page, never the file.
    const response = await anonymous.get(url, { maxRedirects: 0 });
    expect(response.status(), url).toBe(307);
    expect(response.headers().location, url).toContain("/admin/login");
    // A made-up session cookie gets past the redirect but not the route's own check.
    const forged = await anonymous.get(url, {
      maxRedirects: 0,
      headers: { cookie: FORGED_SESSION },
    });
    expect(forged.status(), url).toBe(401);
  }
  await anonymous.dispose();
});
