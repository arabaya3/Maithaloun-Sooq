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
- **No duplicates**: publishing claims a row with a conditional update (one worker wins); a published
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

## Connecting the Facebook Page (owner)

1. Create a Meta app at developers.facebook.com (type **Business**), add **Facebook Login for Business**.
2. Valid OAuth redirect URI: `https://<store-domain>/admin/api/social/meta/callback`.
3. Permissions used: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`,
   `pages_read_user_content`, `pages_manage_engagement`, `read_insights`. While the app is in
   **Development mode** these work for the app's admins on Pages they manage — enough for the store's
   own Page. Public/Live mode for other users would need App Review; this store does not need it.
4. Set `META_APP_ID`, `META_APP_SECRET`, `SOCIAL_TOKEN_KEY`, `SOCIAL_PAGE_ID`, `SOCIAL_MANAGER=on`.
5. In **/admin/social/settings** press «ربط عبر فيسبوك». Alternatively paste a **system user** Page
   token from Business Manager (does not expire).

## Running the schedule

- Vercel cron (daily, 04:00 UTC): `/api/cron/social?run=daily` — catalog discovery, drafts for the
  next 14 days, image rendering, engagement, comments, token check, Sunday report.
- GitHub Actions every 15 min (free): renders Reels with FFmpeg, then publishes what is due. Enable with
  repository variable `SOCIAL_MANAGER=on` and secrets `DATABASE_URL`, `SOCIAL_TOKEN_KEY`,
  `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (and optionally `META_APP_ID`, `META_APP_SECRET`).

Why a separate worker: Vercel functions have no FFmpeg and a 60 s limit; GitHub Actions is free for
this load and already used by the repo. Media is stored in the public Supabase bucket `social-media`
because Meta fetches images/videos by URL.

## Verifying live publishing (not yet done)

Live publishing has only been tested against a mocked Graph API. To verify with the real Page:
connect, approve one post scheduled a few minutes ahead, run `pnpm social:worker publish`, and check
the Page and the post's history in the dashboard.
