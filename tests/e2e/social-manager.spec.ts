import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  login,
  trackPageIssues,
  withTestDb,
} from "./support";

// The e2e server runs with SOCIAL_MANAGER=on and no Facebook connection: nothing can reach Meta.
const CAPTION =
  "🚚 التوصيل من مايثا ماركت\n\nالتوصيل داخل ميثلون بـ 5 ₪، ومجاني للطلبات من 100 ₪ وفوق.\n#مايثا_ماركت";

async function seedDraft(): Promise<string> {
  return withTestDb(async (sql) => {
    await sql`delete from social_posts`;
    const [row] = await sql<{ id: string }[]>`
      insert into social_posts (format, kind, status, caption, caption_source, media_status, media_url, poster_url, scheduled_for)
      values ('image', 'delivery_info', 'draft', ${CAPTION}, 'template', 'ready',
              '/brand/kit/maytha-logo-rounded.png', '/brand/kit/maytha-logo-rounded.png', now() + interval '3 days')
      returning id`;
    return row!.id;
  });
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include(".admin-body")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(result.violations.map((violation) => violation.id)).toEqual([]);
}

test.describe("Facebook manager", () => {
  test("owner reviews and approves one draft; nothing is published without a connection", async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    const id = await seedDraft();
    await login(page);

    await page.goto("/admin/social");
    await expect(
      page.getByRole("heading", { name: "فيسبوك", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("صفحة فيسبوك غير مربوطة")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);

    await page.goto(`/admin/social/posts/${id}`);
    await expect(page.getByText("مسودة").first()).toBeVisible();
    await page.getByRole("button", { name: "موافقة ونشر في الموعد" }).click();
    await expect(
      page.getByText("تمت الموافقة. سيُنشر في موعده."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "إلغاء الموافقة" }),
    ).toBeVisible();

    const row = await withTestDb(
      (sql) => sql<
        {
          status: string;
          meta_post_id: string | null;
          approved_by: string | null;
        }[]
      >`
        select status, meta_post_id, approved_by from social_posts where id = ${id}`,
    );
    expect(row[0]).toMatchObject({ status: "approved", meta_post_id: null });
    expect(row[0]!.approved_by).not.toBeNull();
    expect(issues.consoleErrors).toEqual([]);
  });

  test("«انشر الآن» names the exact post, needs a confirmation and sends nothing without a publisher", async ({
    page,
  }) => {
    const issues = trackPageIssues(page);
    const id = await seedDraft();
    // A second approved post that must stay untouched.
    const [other] = await withTestDb(
      (sql) => sql<{ id: string }[]>`
        insert into social_posts (format, kind, status, caption, caption_source, media_status, media_url, poster_url, scheduled_for)
        values ('image', 'delivery_info', 'draft', ${CAPTION}, 'template', 'ready',
                '/brand/kit/maytha-logo-rounded.png', '/brand/kit/maytha-logo-rounded.png', now() + interval '4 days')
        returning id`,
    );
    await login(page);
    for (const postId of [other!.id, id]) {
      await page.goto(`/admin/social/posts/${postId}`);
      await page.getByRole("button", { name: "موافقة ونشر في الموعد" }).click();
      await expect(
        page.getByText("تمت الموافقة. سيُنشر في موعده."),
      ).toBeVisible();
    }

    await page.getByRole("button", { name: "انشر الآن" }).click();
    const confirm = page.getByRole("form", { name: "نشر هذا المنشور الآن؟" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(id)).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);

    // The confirmation box is required before anything is sent.
    const send = confirm.getByRole("button", { name: "نعم، انشري الآن" });
    await send.click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole("checkbox").check();
    await send.click();
    await expect(
      page.getByText("طريقة النشر غير مضبوطة على الخادم، فلم يُرسل شيء."),
    ).toBeVisible();

    const rows = await withTestDb(
      (sql) => sql<{ id: string; status: string; attempts: number }[]>`
        select id, status, attempts from social_posts order by scheduled_for`,
    );
    expect(rows).toEqual([
      { id, status: "approved", attempts: 0 },
      { id: other!.id, status: "approved", attempts: 0 },
    ]);
    expect(issues.consoleErrors).toEqual([]);
  });

  test("«انشر الآن» refuses a request replayed from another site", async ({
    page,
  }) => {
    const id = await seedDraft();
    await login(page);
    await page.goto(`/admin/social/posts/${id}`);
    await page.getByRole("button", { name: "موافقة ونشر في الموعد" }).click();
    await expect(
      page.getByText("تمت الموافقة. سيُنشر في موعده."),
    ).toBeVisible();

    // Capture the real server-action request, without letting it reach the server.
    let captured: {
      url: string;
      headers: Record<string, string>;
      body: Buffer;
    } | null = null;
    await page.route("**/admin/social/posts/**", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        captured = {
          url: request.url(),
          headers: request.headers(),
          body: request.postDataBuffer() ?? Buffer.alloc(0),
        };
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "انشر الآن" }).click();
    const confirm = page.getByRole("form", { name: "نشر هذا المنشور الآن؟" });
    await confirm.getByRole("checkbox").check();
    await confirm.getByRole("button", { name: "نعم، انشري الآن" }).click();
    await expect.poll(() => captured !== null).toBe(true);
    await page.unroute("**/admin/social/posts/**");

    // The same action, with the owner's cookies, sent as if from another website.
    const replay = captured!;
    const forged = await page.request.post(replay.url, {
      headers: {
        ...replay.headers,
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      data: replay.body,
      maxRedirects: 0,
    });
    const text = await forged.text();
    // Never the outcome of a real attempt: the guard stops it before the service runs.
    expect(text).not.toContain("publisher_missing");
    expect(
      forged.status() >= 400 ||
        (forged.headers()["x-action-redirect"] ?? "").includes("/admin/login"),
    ).toBe(true);

    const [row] = await withTestDb(
      (sql) => sql<{ status: string; attempts: number }[]>`
        select status, attempts from social_posts where id = ${id}`,
    );
    expect(row).toEqual({ status: "approved", attempts: 0 });
  });

  test("blocked captions cannot be approved", async ({ page }) => {
    const id = await seedDraft();
    await withTestDb(
      (sql) =>
        sql`update social_posts set caption = 'خصم كبير اليوم فقط' where id = ${id}`,
    );
    await login(page);
    await page.goto(`/admin/social/posts/${id}`);
    await expect(page.getByText("يذكر خصماً أو عرضاً")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "موافقة ونشر في الموعد" }),
    ).toBeDisabled();
  });

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`pages fit and stay usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await seedDraft();
      await login(page);
      for (const path of [
        "/admin/social",
        "/admin/social/queue?status=draft",
        "/admin/social/inbox",
        "/admin/social/analytics",
        "/admin/social/settings",
      ]) {
        await page.goto(path);
        await expect(page.locator(".social-tabs")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        await expectNoHorizontalOverflow(page);
      }
      await expectAccessible(page);
    });
  }

  test("the cron endpoint refuses callers without the secret", async ({
    request,
  }) => {
    expect((await request.get("/api/cron/social?run=publish")).status()).toBe(
      401,
    );
  });
});
