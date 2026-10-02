-- Permanent account deletion may remove that account's upgrade records only.
-- Normal updates and deletes retain the existing immutable-record protections.
CREATE FUNCTION public.prepare_account_purge(target_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF target_user_id IS NULL OR pg_catalog.btrim(target_user_id) = '' THEN
    RAISE EXCEPTION 'An account ID is required to prepare account deletion';
  END IF;

  PERFORM pg_catalog.set_config('app.account_purge_user_id', target_user_id, true);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_account_purge(text) FROM PUBLIC;

-- Supabase or installation-specific default privileges can grant function access
-- to named roles. Remove those grants too, leaving the function owner access.
DO $$
DECLARE
  granted_role record;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT roles.rolname
    FROM pg_catalog.pg_proc AS functions
    CROSS JOIN LATERAL pg_catalog.aclexplode(functions.proacl) AS grants
    JOIN pg_catalog.pg_roles AS roles ON roles.oid = grants.grantee
    WHERE functions.oid = 'public.prepare_account_purge(text)'::pg_catalog.regprocedure
      AND grants.grantee <> functions.proowner
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION public.prepare_account_purge(text) FROM %I',
      granted_role.rolname
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_dealer_upgrade_terminal_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND OLD."userId" = pg_catalog.current_setting('app.account_purge_user_id', true)
    AND pg_catalog.has_function_privilege(
      current_user, 'public.prepare_account_purge(text)', 'EXECUTE'
    )
  THEN
    RETURN OLD;
  END IF;

  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'Terminal dealer upgrade offers are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_dealer_upgrade_acceptance_receipt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND OLD."userId" = pg_catalog.current_setting('app.account_purge_user_id', true)
    AND pg_catalog.has_function_privilege(
      current_user, 'public.prepare_account_purge(text)', 'EXECUTE'
    )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Dealer upgrade acceptance receipts are immutable';
END;
$$;
