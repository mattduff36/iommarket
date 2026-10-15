-- Retire the preview mirror dispatcher. Guarded and idempotent. Never creates jobs.
DO $$
DECLARE
  job_ids bigint[];
  job_id bigint;
BEGIN
  IF current_setting('preview_mirror.install_target', true) IS DISTINCT FROM 'syneonzucehwlghqmfbg' THEN
    RAISE EXCEPTION 'Preview target was not explicitly verified';
  END IF;

  IF to_regnamespace('cron') IS NOT NULL AND to_regclass('cron.job') IS NOT NULL THEN
    SELECT array_agg(jobid) INTO job_ids FROM cron.job
    WHERE jobname = 'preview-production-mirror-72h'
       OR command ILIKE '%preview_mirror.dispatch_if_due%';
    IF job_ids IS NOT NULL THEN
      FOREACH job_id IN ARRAY job_ids LOOP
        PERFORM cron.unschedule(job_id);
      END LOOP;
    END IF;
  END IF;

  IF to_regprocedure('preview_mirror.dispatch_if_due()') IS NOT NULL THEN
    DROP FUNCTION preview_mirror.dispatch_if_due();
  END IF;
END $$;
