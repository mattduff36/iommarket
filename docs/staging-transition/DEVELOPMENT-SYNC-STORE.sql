-- Apply only to development project syneonzucehwlghqmfbg, never production.
-- This private schema is not exposed through Supabase's public Data API.
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
REVOKE ALL ON ALL TABLES IN SCHEMA staging_admin FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS database_sync_runs_created ON staging_admin.database_sync_runs(created_at DESC);
