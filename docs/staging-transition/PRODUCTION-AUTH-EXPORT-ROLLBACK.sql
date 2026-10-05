-- Requires explicit approval. Revoke the export before removing its objects.
-- No CASCADE, Auth table changes, credential changes, or broad schema removal.
BEGIN;
SET LOCAL lock_timeout='5s';
REVOKE SELECT ON "itrader_sync_export".auth_users, "itrader_sync_export".auth_identities FROM itrader_staging_reader;
REVOKE USAGE ON SCHEMA "itrader_sync_export" FROM itrader_staging_reader;
DROP VIEW "itrader_sync_export".auth_users;
DROP VIEW "itrader_sync_export".auth_identities;
DROP SCHEMA "itrader_sync_export";
COMMIT;
-- Set the staging-only DATABASE_SYNC_AUTH_SOURCE_MODE back to direct, or disable
-- the feature. Direct mode will safely block while auth USAGE remains absent.
