-- Production permission setup only. No application rows are changed.
-- Apply manually as a privileged production role after review. The application
-- does not run this file. The provisioning script creates itrader_staging_reader
-- with a generated password kept out of this file, logs and version control.
-- Role attributes: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
-- NOREPLICATION, NOBYPASSRLS. default_transaction_read_only is enabled.
-- Do not grant this role to the application, anonymous or authenticated roles.
-- Fail closed until this reader and the development store are both version 2.

GRANT CONNECT ON DATABASE postgres TO itrader_staging_reader;
GRANT USAGE ON SCHEMA public TO itrader_staging_reader;
GRANT USAGE ON SCHEMA auth TO itrader_staging_reader;

DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'spatial_ref_sys'
  LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO itrader_staging_reader', table_name);
    EXECUTE format('DROP POLICY IF EXISTS itrader_staging_reader_select ON public.%I', table_name);
    EXECUTE format('CREATE POLICY itrader_staging_reader_select ON public.%I FOR SELECT TO itrader_staging_reader USING (true)', table_name);
  END LOOP;
END $$;

GRANT SELECT ON TABLE auth.users, auth.identities TO itrader_staging_reader;

ALTER ROLE itrader_staging_reader SET default_transaction_read_only = on;
ALTER ROLE itrader_staging_reader SET statement_timeout = '240s';
ALTER ROLE itrader_staging_reader SET idle_in_transaction_session_timeout = '240s';
