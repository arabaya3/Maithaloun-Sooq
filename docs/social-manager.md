# MAYTHA MARKET — Facebook manager

Prepares, renders, schedules and publishes Facebook posts and Reels from the store's real catalog,
answers verified questions in comments, and reports engagement. **Nothing is published without the
owner's approval**, and the whole feature is off until `SOCIAL_MANAGER=on`.

## How it works

```
 live catalog (published products only, same mapping as /api/v1/catalog)
        │
        ▼
 discover ─► draft (30-day plan: 4 posts + 2 Reels / week) ─► render (sharp + FFmpeg)
                                                                   │
                         owner reviews in /admin/social ◄──────────┘
                                   │ approve (owner only, caption guard + live availability)
                                   ▼
                    publish when due (claim lock, re-check catalog) ─► Facebook Graph API
                                   │
              reconcile stalled claims · engagement · comments · weekly report
```

| Piece                                                                     | Where                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Rules (captions, guard, plan, state machine, comment policy, Meta errors) | `src/features/social/domain`                                               |
| Graph API client, Facebook Login, token vault, media store, renderers     | `src/features/social/infrastructure`                                       |
| Service, jobs, server actions                                             | `src/features/social/application`                                          |
| Dashboard (Arabic, RTL)                                                   | `src/app/admin/(console)/social`                                           |
| Cron endpoint                                                             | `GET /api/cron/social?run=tick\|daily\|<job>` (Bearer `CRON_SECRET`)       |
| Worker (FFmpeg)                                                           | `pnpm social:worker [daily\|<job>]`, `.github/workflows/social-worker.yml` |
| First batch for review                                                    | `pnpm social:batch [startDate] [outDir]`                                   |
| Tables                                                                    | `drizzle/0028_social_manager.sql` (`social_*`, RLS on)                     |

### Guarantees

- **Approval gate**: only `owner` can approve; a database check refuses any queued/published row
  without `approved_by`, `approved_at` and `publish_key`. Approving freezes caption and media.
- **No duplicates** (details below): publishing claims a row with a conditional update (one worker wins); a published
  row can't be claimed again; `meta_post_id` is unique. A claim that never finished is reconciled
  against the Page's recent posts before any retry.
- **No invented content**: captions come from catalog facts; the caption guard blocks discounts,
  offers, "free" without the real threshold, testimonials, rankings/guarantees, percentages not in the
  owner's own product names, unknown prices and delivery outside Maythaloun. AI wording (optional) must
  pass the same guard or the template is kept.
- **No unavailable products**: availability is checked at drafting, at approval and again right before
  publishing.
- **Retries**: transient and rate-limit errors back off 5 min × 3ⁿ (max 6 h, Meta's `Retry-After`
  wins), at most 4 attempts. Expired tokens stop publishing and mark the connection expired.
- **Comments**: replies only to verified store-rule questions (delivery area/fee, payment, how to
  order), and only when the owner turns auto-replies on; otherwise the answer waits in the inbox.
  Complaints, refunds, delivery disputes, availability/price questions and personal data are escalated.
  No private messages, no unsolicited messages, no ads.
- **Secrets**: Page token AES-256-GCM sealed with `SOCIAL_TOKEN_KEY`; never logged or audited in clear.
  No Facebook password is ever requested.

## Permissions

| Role     | Can                                                                        |
| -------- | -------------------------------------------------------------------------- |
| owner    | everything: approve, connect the Page, settings, send held replies         |
| operator | view, draft, edit captions, schedule drafts, reject drafts, close comments |

## Meta requirements (checked against Meta's documentation, October 2026)

| Call                                                                                                  | Permissions                                                                                                 | Page task               |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| `POST /{page}/photos` (≤ 4 MB)                                                                        | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`                                            | CREATE_CONTENT          |
| Reels `video_reels` start → rupload → finish (3–90 s, 9:16, H.264 + AAC 48 kHz; 30 per Page per 24 h) | same as photos                                                                                              | CREATE_CONTENT          |
| `published_posts`, reactions/comments/shares counts                                                   | `pages_read_engagement`                                                                                     | CREATE_CONTENT / MANAGE |
| Post insights `post_total_media_view_unique`, `post_media_view`; Reels `video_insights`               | `read_insights`                                                                                             | ANALYZE                 |
| Read comments / reply                                                                                 | `pages_read_user_content` (Meta's guide also names `pages_read_user_engagement`), `pages_manage_engagement` | MODERATE                |
| `debug_token`                                                                                         | app access token (app id + secret)                                                                          | —                       |

Graph API **v25.0** (supported until July 2028). Discontinued metrics such as `post_impressions_unique`
are not used for posts. Every call carries `appsecret_proof`.

Sources: developers.facebook.com/docs/graph-api/changelog, …/reference/page/photos,
…/video-api/guides/reels-publishing, …/graph-api/overview/access-levels,
…/development/build-and-test/app-modes, …/facebook-login/facebook-login-for-business,
…/graph-api/securing-requests, …/graph-api/reference/v24.0/insights.

### What works without App Review, and what does not

- **Standard Access** (automatic for Business apps) lets the app use these permissions **only for people
  who have a role on the app** (admin, developer, tester). The owner is the app admin and an admin of
  the MAYTHA MARKET Page, so the owner can grant every permission above to this app without App Review.
- **Advanced Access** (needed only to serve people without a role on the app, e.g. other businesses'
  Pages) requires **App Review per permission** and **Business Verification**. This store does not need it.
- **Development mode vs Live mode — important:** Meta states that content an app creates while in
  **Development mode can only be seen by people with a role on the app**. Posts made in Development mode
  would not be public. The app must be switched to **Live mode** before the live test. Switching to Live
  mode needs a privacy policy URL and app icon/category; it does not by itself require App Review for
  permissions used at Standard Access. (Meta does not state this last point in one sentence; if the
  dashboard demands review when switching, stop and report it.)

## Setting up the Meta app (owner, about 20 minutes)

1. At **developers.facebook.com → My Apps → Create app**, choose use case **Other** → app type
   **Business**. Name it e.g. «MAYTHA Market Publisher». Connect it to the business portfolio that owns
   the MAYTHA MARKET Page if asked.
2. **App settings → Basic:** add privacy policy URL `https://maithaloun-sooq.vercel.app/privacy`,
   app icon (the store logo), category «Shopping». Copy the **App ID** and **App Secret**.
3. **App settings → Advanced → Security:** turn on **Require App Secret**. Leave «Allowed domains»
   empty unless asked.
4. **Add product → Facebook Login for Business.** In **Settings**: Valid OAuth Redirect URIs =
   `https://maithaloun-sooq.vercel.app/admin/api/social/meta/callback`; Client OAuth login on,
   Web OAuth login on, Enforce HTTPS on.
5. **Facebook Login for Business → Configurations → Create:** token type **User access token**,
   assets **Pages** (select MAYTHA MARKET), permissions: `pages_show_list`, `pages_manage_posts`,
   `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `read_insights`
   (add `pages_read_user_engagement` too if the list offers it). Copy the **Configuration ID**.
6. **App roles:** the owner's Facebook account is the app admin (it created the app). Add nobody else.
7. Confirm in **App Review → Permissions and features** that each permission above shows «Standard
   access» and «Ready to use». Do not request Advanced Access.
8. Switch the app to **Live** (top bar toggle) only when ready for the live test (step below).

Vercel (Production) environment variables, set by the owner or with their approval:
`META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `SOCIAL_PAGE_ID=61595987361563`,
`SOCIAL_TOKEN_KEY` (32 random bytes, base64), `SOCIAL_PUBLIC_ORIGIN=https://maithaloun-sooq.vercel.app`,
then `SOCIAL_MANAGER=on`. `CRON_SECRET` and the Supabase variables already exist.

## Connecting the Facebook Page (owner)

1. Sign in to `/admin`, open **فيسبوك → الإعدادات**, press «ربط عبر فيسبوك».
2. Facebook asks you to sign in (on facebook.com — the store never sees your password) and to confirm
   the MAYTHA MARKET Page and the permissions. Approve.
3. You return to the settings page. It must show: **مربوطة**, the Page id `61595987361563`, a token hint,
   and «الصلاحيات: كاملة». A token for another app or Page, or without every permission, is refused.

Alternative: a **system user** token from Business Settings → Users → System users (assign the app and
the Page with «Create content», «Moderate», «View insights»), pasted in «ربط برمز صفحة». It is checked
the same way; in production an unchecked token is never stored.

## Running the schedule

- Vercel cron (daily, 04:00 UTC): `/api/cron/social?run=daily`. Without `SOCIAL_MANAGER=on` it answers
  `{ ok: true, skipped: "disabled" }` and runs nothing.
- GitHub Actions every 15 min (free): renders Reels with FFmpeg, then publishes what is due. The job is
  skipped entirely unless repository variable `SOCIAL_MANAGER` is `on`. Secrets, present only in the
  worker step: `SOCIAL_WORKER_DATABASE_URL`, `SOCIAL_TOKEN_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
  `META_APP_ID`, `META_APP_SECRET`. Actions are pinned to commits; the manual command is a fixed list.
- Vercel ticks publish at most one post per call, so a publish always fits the 60 s limit.

### Least-privilege database role for the worker

The worker only needs the `social_*` tables (it reads the catalog over the public API). Run once in the
Supabase SQL editor and use this role's connection string as `SOCIAL_WORKER_DATABASE_URL`:

```sql
create role social_worker login password '<generate a long random password>';
grant usage on schema public to social_worker;
grant select, insert, update, delete on
  social_posts, social_post_events, social_connections, social_catalog_seen,
  social_job_runs, social_engagement, social_comments, social_settings to social_worker;
-- RLS is on for these tables with no public policies; this role gets its own.
do $$ declare t text; begin
  foreach t in array array['social_posts','social_post_events','social_connections','social_catalog_seen',
    'social_job_runs','social_engagement','social_comments','social_settings'] loop
    execute format('create policy %I on %I for all to social_worker using (true) with check (true)', t || '_worker', t);
  end loop; end $$;
```

## Duplicate-publishing safeguards

- One claim per post (conditional update); two workers can never both send it.
- If Facebook's answer to the publishing request is lost (timeout, dropped connection, 5xx, unreadable
  reply), the post stays claimed as «unknown outcome» and is **never re-sent automatically**. After
  15 minutes the reconciler looks for it on the Page (posts and photos by caption; a Reel by the video id
  saved before its final publish step). Found → recorded as published. Certainly absent → queued again.
  Lookup failed → left alone until the next run.
- Every retry, automatic or the owner's «أعيدي المحاولة», checks the Page first.
- A held comment reply is taken («sending») before it is sent, so a double click sends one reply.

## Controlled live test (one post, owner-approved)

Preconditions: PR merged and deployed with `SOCIAL_MANAGER=on`; Meta app in **Live** mode; Page
connected and showing «الصلاحيات: كاملة»; in **الإعدادات**, «انشري الموافق عليه في موعده» **off**
(manual mode) so the schedule publishes nothing; GitHub variable `SOCIAL_MANAGER` **not** set yet.

1. In **المسودات**, pick one simple feed post (the delivery-information post is ideal: no product prices
   that could change). Read the caption and image; fix anything.
2. Press «موافقة ونشر في الموعد». Only this one post is approved; check **قائمة النشر** shows exactly one.
3. From a machine with the production environment (or a one-off GitHub Actions run), run
   `pnpm social:worker connection` — expect `"state":"connected"`.
4. Run `pnpm social:worker publish-one <post-id> --confirm`. It publishes that post only, even in manual
   mode, and refuses anything not approved.
5. Check: the post is visible on the Page **while logged out** (proves Live mode); the dashboard shows
   «منشور» with the Facebook post id; the history shows one «نُشر على فيسبوك».
6. Next day, `pnpm social:worker engagement` and check numbers appear in **التحليلات**.
7. Only after this succeeds: decide whether to turn on automatic publishing and the GitHub schedule.

Rollback at any point: «إيقاف مؤقت لكل شيء» in settings, or remove `SOCIAL_MANAGER`; delete the post
on Facebook if needed (the system never deletes posts).
