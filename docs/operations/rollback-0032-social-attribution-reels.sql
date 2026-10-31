-- Rollback for migration 0032_social_attribution_reels (campaign results and the Reels queue).
-- 0032 only adds three tables; nothing else in the schema depends on them, so dropping them
-- restores the exact pre-0032 schema. Orders, social posts and their history are untouched:
-- the tables only point at them. Lost: campaign visit counts, which order came from which
-- campaign, and the list of requested Reels (rendered videos stay in Storage until deleted).
-- Stop the render worker first (REELS_RENDER_WORKER off), run in one transaction, then
-- redeploy a build without the Creative Studio milestone 2 code.
BEGIN;
DROP TABLE IF EXISTS "social_reel_renders";
DROP TABLE IF EXISTS "social_order_attributions";
DROP TABLE IF EXISTS "social_campaign_visits";
-- Forget the migration so a later release can apply it again.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = 1793258138739;
COMMIT;
