-- Preview only. Install the secret with a parameterized vault.create_secret call first.
DO $$ BEGIN
  IF current_setting('preview_mirror.install_target', true) IS DISTINCT FROM 'syneonzucehwlghqmfbg' THEN
    RAISE EXCEPTION 'Preview target was not explicitly verified';
  END IF;
END $$;
ALTER TABLE preview_mirror.state ADD COLUMN IF NOT EXISTS last_dispatched_at timestamptz;
ALTER TABLE preview_mirror.state ADD COLUMN IF NOT EXISTS last_request_id bigint;

CREATE OR REPLACE FUNCTION preview_mirror.dispatch_if_due() RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  mirror_state preview_mirror.state%ROWTYPE;
  signing_key text;
  stamp text;
  signature text;
  request_id bigint;
BEGIN
  SELECT * INTO mirror_state FROM preview_mirror.state WHERE id=1 FOR UPDATE;
  IF mirror_state.last_success_at > now() - interval '72 hours' OR
     mirror_state.last_dispatched_at > now() - interval '15 minutes' THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO signing_key FROM vault.decrypted_secrets WHERE name='preview_mirror_cron_secret';
  IF signing_key IS NULL THEN RAISE EXCEPTION 'Preview scheduler secret missing'; END IF;
  stamp := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text;
  signature := encode(extensions.hmac(E'POST\n/api/cron/preview-mirror\n' || stamp, signing_key, 'sha256'), 'hex');
  SELECT net.http_post(
    url := 'https://itrader.dev/api/cron/preview-mirror',
    headers := jsonb_build_object('Content-Type','application/json','x-preview-mirror-timestamp',stamp,'x-preview-mirror-signature',signature),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) INTO request_id;
  UPDATE preview_mirror.state SET last_dispatched_at=clock_timestamp(),last_request_id=request_id WHERE id=1;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION preview_mirror.dispatch_if_due() FROM PUBLIC, anon, authenticated;

-- The job starts paused until the deployed route has been verified.
SELECT cron.schedule('preview-production-mirror-72h', '* * * * *', 'SELECT preview_mirror.dispatch_if_due()');
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname='preview-production-mirror-72h';
