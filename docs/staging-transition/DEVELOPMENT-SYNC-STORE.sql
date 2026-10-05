-- Apply only to development project syneonzucehwlghqmfbg, never production.
-- This private schema is not exposed through Supabase's public Data API.
-- Store version 2. Do not apply this file automatically from the application.
CREATE SCHEMA IF NOT EXISTS staging_admin;
REVOKE ALL ON SCHEMA staging_admin FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS staging_admin.database_sync_runs (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('merge', 'replace', 'reset')),
  status text NOT NULL CHECK (status IN ('prepared', 'applied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  applied_at timestamptz,
  encrypted_snapshot text NOT NULL,
  summary jsonb NOT NULL,
  post_hash text
);

ALTER TABLE staging_admin.database_sync_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'sync';
ALTER TABLE staging_admin.database_sync_runs ADD COLUMN IF NOT EXISTS restored_from_id uuid;
ALTER TABLE staging_admin.database_sync_runs ADD COLUMN IF NOT EXISTS schema_fingerprint text;
ALTER TABLE staging_admin.database_sync_runs ADD COLUMN IF NOT EXISTS backup_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE staging_admin.database_sync_runs ADD COLUMN IF NOT EXISTS backup_expires_at timestamptz;
ALTER TABLE staging_admin.database_sync_runs ADD COLUMN IF NOT EXISTS payload_pruned_at timestamptz;
ALTER TABLE staging_admin.database_sync_runs DROP CONSTRAINT IF EXISTS database_sync_runs_kind_check;
ALTER TABLE staging_admin.database_sync_runs ADD CONSTRAINT database_sync_runs_kind_check CHECK (kind IN ('sync', 'restore'));

CREATE TABLE IF NOT EXISTS staging_admin.database_sync_chunks (
  run_id uuid NOT NULL REFERENCES staging_admin.database_sync_runs(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('source', 'backup')),
  table_name text NOT NULL,
  seq integer NOT NULL,
  ciphertext text NOT NULL,
  plaintext_sha256 text NOT NULL,
  row_count integer NOT NULL,
  byte_size integer NOT NULL,
  PRIMARY KEY (run_id, purpose, table_name, seq)
);

CREATE TABLE IF NOT EXISTS staging_admin.database_sync_provenance (
  id bigserial PRIMARY KEY,
  generation_id uuid NOT NULL,
  table_name text NOT NULL,
  row_key text NOT NULL,
  UNIQUE (generation_id, table_name, row_key)
);

CREATE TABLE IF NOT EXISTS staging_admin.database_sync_state (
  id integer PRIMARY KEY,
  active_generation_id uuid,
  schema_fingerprint text,
  store_version integer NOT NULL
);

INSERT INTO staging_admin.database_sync_state (id, active_generation_id, schema_fingerprint, store_version)
VALUES (1, NULL, NULL, 2)
ON CONFLICT (id) DO UPDATE SET store_version = 2;

REVOKE ALL ON ALL TABLES IN SCHEMA staging_admin FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS database_sync_runs_created ON staging_admin.database_sync_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS database_sync_provenance_lookup ON staging_admin.database_sync_provenance(generation_id, table_name, row_key);
