import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "../wipe-preview-marketplace/target";

export {
  KEEP_ACCOUNT_EMAILS,
  PREVIEW_DB_HOST,
  PREVIEW_POOLER_USER,
  PREVIEW_PROJECT_REF,
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_PROJECT_REF,
} from "../wipe-preview-marketplace/target";

export const WORKSTREAM_ID = "prod-mirror-20260831";
export const BACKUPS_DIR = ".local/db-backups";

export const PRODUCTION_DB_HOST = `db.${PRODUCTION_PROJECT_REF}.supabase.co`;
export const PRODUCTION_SUPABASE_HOST = `${PRODUCTION_PROJECT_REF}.supabase.co`;
export const PRODUCTION_POOLER_USER = `postgres.${PRODUCTION_PROJECT_REF}`;

export const STORAGE_BUCKET = "user-avatars";
export const STORAGE_PUBLIC_PREFIX = `/storage/v1/object/public/${STORAGE_BUCKET}/`;

export const AUTH_RESTORE_SKIP_TABLES = [
  "sessions",
  "refresh_tokens",
  "flow_state",
  "one_time_tokens",
  "mfa_challenges",
  "mfa_amr_claims",
  "schema_migrations",
  "instances",
] as const;

export const SAFETY_ENV_KEYS = [
  "PROD_MIRROR_ALLOW",
  "SOURCE_REF",
  "DEST_REF",
  "PROD_MIRROR_BACKUP_ID",
  "CONFIRM_DB",
  "WRITERS_PAUSED",
  "SEED_BACKUP_ID",
] as const;
