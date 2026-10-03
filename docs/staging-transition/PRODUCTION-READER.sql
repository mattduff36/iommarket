-- Production permission setup only. No application rows are changed.
-- The provisioning script creates itrader_staging_reader with a generated
-- password kept out of this file, logs and version control.
-- Role attributes: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
-- NOREPLICATION, NOBYPASSRLS. default_transaction_read_only is enabled.
-- Do not grant this role to the application, anonymous or authenticated roles.

GRANT CONNECT ON DATABASE postgres TO itrader_staging_reader;
GRANT USAGE ON SCHEMA public TO itrader_staging_reader;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Region', 'Category', 'AttributeDefinition', 'VehicleMake', 'VehicleModel',
    'VehicleModelAlias', 'User', 'DealerProfile', 'Listing', 'ListingImage',
    'ListingAttributeValue', 'ContentPage', 'DealerPreviewPack', 'Subscription',
    '_prisma_migrations'
  ] LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO itrader_staging_reader', table_name);
    -- An explicit role-scoped SELECT policy provides a complete snapshot despite
    -- RLS. It does not change the access of any existing role.
    EXECUTE format('CREATE POLICY itrader_staging_reader_select ON public.%I FOR SELECT TO itrader_staging_reader USING (true)', table_name);
  END LOOP;
END $$;

ALTER ROLE itrader_staging_reader SET default_transaction_read_only = on;
ALTER ROLE itrader_staging_reader SET statement_timeout = '30s';
ALTER ROLE itrader_staging_reader SET idle_in_transaction_session_timeout = '60s';
