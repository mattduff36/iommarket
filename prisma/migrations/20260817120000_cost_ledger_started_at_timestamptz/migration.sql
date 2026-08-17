BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE
  "CostLedgerConfig",
  "CostSyncLock",
  "CostSyncRun",
  "CostSourceSnapshot",
  "FxRateSnapshot",
  "CostEntry",
  "InvoiceRequest",
  "InvoiceRequestLine",
  "CostSettlement",
  "CostWorkflowEvent",
  "CostEmailOutbox"
IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CostSyncLock"
    WHERE id = 'default'
      AND "expiresAt" > CLOCK_TIMESTAMP()
  ) THEN
    RAISE EXCEPTION 'cost ledger migration aborted: active sync lock';
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "CostSyncRun") <> 0
     OR (SELECT COUNT(*) FROM "CostSourceSnapshot") <> 0
     OR (SELECT COUNT(*) FROM "FxRateSnapshot") <> 0
     OR (SELECT COUNT(*) FROM "CostEntry") <> 0
     OR (SELECT COUNT(*) FROM "InvoiceRequest") <> 0
     OR (SELECT COUNT(*) FROM "InvoiceRequestLine") <> 0
     OR (SELECT COUNT(*) FROM "CostSettlement") <> 0
     OR (SELECT COUNT(*) FROM "CostWorkflowEvent") <> 0
     OR (SELECT COUNT(*) FROM "CostEmailOutbox") <> 0
  THEN
    RAISE EXCEPTION 'cost ledger migration aborted: financial or provenance rows exist';
  END IF;
END $$;

DO $$
DECLARE
  config_count integer;
  started_at_naive timestamp;
  policy_version text;
  trigger_enabled char;
BEGIN
  SELECT COUNT(*) INTO config_count FROM "CostLedgerConfig";
  IF config_count <> 1 THEN
    RAISE EXCEPTION 'cost ledger migration aborted: expected exactly one config row';
  END IF;

  SELECT "startedAt", "policyVersion"
    INTO started_at_naive, policy_version
  FROM "CostLedgerConfig"
  WHERE id = 'default';

  IF started_at_naive IS NULL THEN
    RAISE EXCEPTION 'cost ledger migration aborted: default config row is missing';
  END IF;

  IF started_at_naive IS DISTINCT FROM TIMESTAMP '2026-09-01 07:00:00' THEN
    RAISE EXCEPTION 'cost ledger migration aborted: unexpected existing startedAt';
  END IF;

  IF policy_version IS DISTINCT FROM 'gbp-markup-v1' THEN
    RAISE EXCEPTION 'cost ledger migration aborted: unexpected policy version';
  END IF;

  SELECT t.tgenabled
    INTO trigger_enabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'CostLedgerConfig'
    AND t.tgname = 'cost_ledger_config_immutable'
    AND NOT t.tgisinternal;

  IF trigger_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'cost ledger migration aborted: immutability trigger is missing or disabled';
  END IF;
END $$;

DROP TRIGGER cost_ledger_config_immutable ON "CostLedgerConfig";

ALTER TABLE "CostLedgerConfig"
  ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3)
  USING "startedAt" AT TIME ZONE 'Europe/London';

DO $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE "CostLedgerConfig"
  SET "startedAt" = TIMESTAMPTZ '2026-08-13 23:00:00+00'
  WHERE id = 'default';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'cost ledger migration aborted: expected to update exactly one config row';
  END IF;
END $$;

CREATE TRIGGER cost_ledger_config_immutable
  BEFORE UPDATE OR DELETE ON "CostLedgerConfig"
  FOR EACH ROW EXECUTE FUNCTION public.cost_forbid_mutation();

DO $$
DECLARE
  started_at timestamptz;
  column_type text;
  trigger_enabled char;
BEGIN
  SELECT "startedAt" INTO started_at
  FROM "CostLedgerConfig"
  WHERE id = 'default';

  IF started_at IS DISTINCT FROM TIMESTAMPTZ '2026-08-13 23:00:00+00' THEN
    RAISE EXCEPTION 'cost ledger migration aborted: startedAt did not round-trip';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod)
    INTO column_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'CostLedgerConfig'
    AND a.attname = 'startedAt'
    AND NOT a.attisdropped;

  IF column_type IS DISTINCT FROM 'timestamp(3) with time zone' THEN
    RAISE EXCEPTION 'cost ledger migration aborted: startedAt is not timestamptz(3)';
  END IF;

  SELECT t.tgenabled
    INTO trigger_enabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'CostLedgerConfig'
    AND t.tgname = 'cost_ledger_config_immutable'
    AND NOT t.tgisinternal;

  IF trigger_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'cost ledger migration aborted: immutability trigger was not restored';
  END IF;
END $$;

COMMIT;
