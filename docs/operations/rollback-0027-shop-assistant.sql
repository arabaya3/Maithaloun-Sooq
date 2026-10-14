-- Rollback for migration 0027_shop_assistant (WhatsApp shop assistant).
-- 0027 only adds two tables; nothing else in the schema depends on them, so dropping them
-- restores the exact pre-0027 schema. Orders placed through the assistant stay in "orders";
-- only the conversation history in these two tables is lost.
-- Run in one transaction, then redeploy a build without the assistant code.
BEGIN;
DROP TABLE IF EXISTS "shop_messages";
DROP TABLE IF EXISTS "shop_conversations";
-- Forget the migration so a later release can apply it again.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = 1791980327893;
COMMIT;
