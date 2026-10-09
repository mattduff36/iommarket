-- Run only on the pinned preview connection, inside a transaction with this marker.
DO $$ BEGIN
  IF current_setting('preview_mirror.install_target', true) IS DISTINCT FROM 'syneonzucehwlghqmfbg' THEN
    RAISE EXCEPTION 'Preview target was not explicitly verified';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS preview_mirror;
REVOKE ALL ON SCHEMA preview_mirror FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS preview_mirror.state (
  id integer PRIMARY KEY CHECK (id = 1),
  generation_id uuid,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text
);
INSERT INTO preview_mirror.state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS preview_mirror.runs (
  id uuid PRIMARY KEY,
  trigger_kind text NOT NULL,
  actor_id text,
  completed_at timestamptz NOT NULL DEFAULT now(),
  copied_tables integer NOT NULL,
  copied_rows bigint NOT NULL,
  verification jsonb NOT NULL,
  backup bytea NOT NULL
);
CREATE TABLE IF NOT EXISTS preview_mirror.provenance (
  generation_id uuid NOT NULL,
  table_name text NOT NULL,
  row_key text NOT NULL,
  PRIMARY KEY(generation_id, table_name, row_key)
);
CREATE TABLE IF NOT EXISTS preview_mirror.protected_references (
  generation_id uuid NOT NULL,
  kind text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY(generation_id, kind, value)
);
REVOKE ALL ON ALL TABLES IN SCHEMA preview_mirror FROM PUBLIC, anon, authenticated;
