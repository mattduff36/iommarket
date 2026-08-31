BEGIN;

CREATE OR REPLACE FUNCTION public.cost_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'cost ledger rows are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_vehicle_model_name_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'VehicleModel' THEN
    IF EXISTS (
      SELECT 1
      FROM public."VehicleModelAlias"
      WHERE "makeId" = NEW."makeId"
        AND "normalizedName" = NEW."normalizedName"
    ) THEN
      RAISE EXCEPTION 'vehicle model name conflicts with an alias for this make'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public."VehicleModel"
      WHERE "id" = NEW."modelId"
        AND "makeId" = NEW."makeId"
    ) THEN
      RAISE EXCEPTION 'vehicle model alias make does not match its model'
        USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public."VehicleModel"
      WHERE "makeId" = NEW."makeId"
        AND "normalizedName" = NEW."normalizedName"
    ) THEN
      RAISE EXCEPTION 'vehicle model alias conflicts with a model name for this make'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_dealer_review_response_approved_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  affected_response_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'DealerReviewResponse' THEN
      affected_response_id := OLD.id;
    ELSIF TG_TABLE_NAME = 'DealerReviewResponseRevision' THEN
      affected_response_id := OLD."responseId";
    ELSE
      RAISE EXCEPTION 'Unexpected approved-response trigger table: %', TG_TABLE_NAME;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'DealerReviewResponse' THEN
      affected_response_id := NEW.id;
    ELSIF TG_TABLE_NAME = 'DealerReviewResponseRevision' THEN
      affected_response_id := NEW."responseId";
    ELSE
      RAISE EXCEPTION 'Unexpected approved-response trigger table: %', TG_TABLE_NAME;
    END IF;
  END IF;

  IF affected_response_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."DealerReviewResponse" response
    LEFT JOIN public."DealerReviewResponseRevision" revision
      ON revision.id = response."approvedRevisionId"
      AND revision."responseId" = response.id
    WHERE response.id = affected_response_id
      AND response."approvedRevisionId" IS NOT NULL
      AND (
        revision.id IS NULL
        OR revision.status <> 'APPROVED'
        OR revision.body IS DISTINCT FROM response."approvedBody"
      )
  ) THEN
    RAISE EXCEPTION 'Approved dealer response must reference its own approved revision';
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  fn record;
  trigger_count integer;
BEGIN
  FOR fn IN
    SELECT p.proname, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'cost_forbid_mutation',
        'enforce_vehicle_model_name_uniqueness',
        'check_dealer_review_response_approved_revision'
      )
  LOOP
    IF fn.prosecdef THEN
      RAISE EXCEPTION 'pin_function_search_path aborted: % must remain SECURITY INVOKER', fn.proname;
    END IF;
    IF fn.proconfig IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(fn.proconfig) AS cfg
        WHERE cfg IN ('search_path=', 'search_path=""')
      )
    THEN
      RAISE EXCEPTION 'pin_function_search_path aborted: % is missing an empty search_path', fn.proname;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO trigger_count
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND p.proname IN (
      'cost_forbid_mutation',
      'enforce_vehicle_model_name_uniqueness',
      'check_dealer_review_response_approved_revision'
    );

  IF trigger_count < 11 THEN
    RAISE EXCEPTION 'pin_function_search_path aborted: expected at least 11 attached triggers, found %', trigger_count;
  END IF;
END $$;

COMMIT;
