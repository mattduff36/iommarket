-- PROPOSED PRODUCTION PROVISIONING. Requires separate explicit approval.
-- Target: snlqivvogfqesxpbjiei. Verify the connection independently before running.
-- Run as the existing postgres role, NOT as the runtime reader.
-- Creates only one private schema and two masked views. No Auth table/policy edits.
-- No API exposed-schema settings are changed. Do not add this schema to the Data API.
-- Create-only: reruns and pre-existing objects fail closed for review.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $prerequisites$
DECLARE actual_shape jsonb;
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolbypassrls AND NOT rolsuper) THEN
    RAISE EXCEPTION 'Requires the existing non-superuser postgres role with its verified Auth RLS access';
  END IF;
  IF NOT has_database_privilege(current_user,current_database(),'CREATE') OR NOT has_schema_privilege(current_user,'auth','USAGE') THEN
    RAISE EXCEPTION 'Provisioning role lacks the required existing permissions';
  END IF;
  IF NOT has_table_privilege(current_user,'auth.users','SELECT') OR NOT has_table_privilege(current_user,'auth.identities','SELECT') THEN
    RAISE EXCEPTION 'Provisioning role cannot read the Auth source tables';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='itrader_staging_reader' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) THEN
    RAISE EXCEPTION 'Restricted runtime reader is absent or elevated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='itrader_sync_export') THEN
    RAISE EXCEPTION 'Private export schema already exists; review rather than overwriting';
  END IF;
  
  SELECT jsonb_agg(jsonb_build_object('name', a.attname::text,
    'type', format_type(a.atttypid,a.atttypmod), 'generated', a.attgenerated::text) ORDER BY a.attnum)
    INTO actual_shape
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth' AND c.relname='users' AND a.attnum>0 AND NOT a.attisdropped;
  IF actual_shape IS DISTINCT FROM '[{"name":"instance_id","type":"uuid","generated":""},{"name":"id","type":"uuid","generated":""},{"name":"aud","type":"character varying(255)","generated":""},{"name":"role","type":"character varying(255)","generated":""},{"name":"email","type":"character varying(255)","generated":""},{"name":"encrypted_password","type":"character varying(255)","generated":""},{"name":"email_confirmed_at","type":"timestamp with time zone","generated":""},{"name":"invited_at","type":"timestamp with time zone","generated":""},{"name":"confirmation_token","type":"character varying(255)","generated":""},{"name":"confirmation_sent_at","type":"timestamp with time zone","generated":""},{"name":"recovery_token","type":"character varying(255)","generated":""},{"name":"recovery_sent_at","type":"timestamp with time zone","generated":""},{"name":"email_change_token_new","type":"character varying(255)","generated":""},{"name":"email_change","type":"character varying(255)","generated":""},{"name":"email_change_sent_at","type":"timestamp with time zone","generated":""},{"name":"last_sign_in_at","type":"timestamp with time zone","generated":""},{"name":"raw_app_meta_data","type":"jsonb","generated":""},{"name":"raw_user_meta_data","type":"jsonb","generated":""},{"name":"is_super_admin","type":"boolean","generated":""},{"name":"created_at","type":"timestamp with time zone","generated":""},{"name":"updated_at","type":"timestamp with time zone","generated":""},{"name":"phone","type":"text","generated":""},{"name":"phone_confirmed_at","type":"timestamp with time zone","generated":""},{"name":"phone_change","type":"text","generated":""},{"name":"phone_change_token","type":"character varying(255)","generated":""},{"name":"phone_change_sent_at","type":"timestamp with time zone","generated":""},{"name":"confirmed_at","type":"timestamp with time zone","generated":"s"},{"name":"email_change_token_current","type":"character varying(255)","generated":""},{"name":"email_change_confirm_status","type":"smallint","generated":""},{"name":"banned_until","type":"timestamp with time zone","generated":""},{"name":"reauthentication_token","type":"character varying(255)","generated":""},{"name":"reauthentication_sent_at","type":"timestamp with time zone","generated":""},{"name":"is_sso_user","type":"boolean","generated":""},{"name":"deleted_at","type":"timestamp with time zone","generated":""},{"name":"is_anonymous","type":"boolean","generated":""}]'::jsonb THEN
    RAISE EXCEPTION 'Auth export shape differs for users; review the versioned contract';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('name', a.attname::text,
    'type', format_type(a.atttypid,a.atttypmod), 'generated', a.attgenerated::text) ORDER BY a.attnum)
    INTO actual_shape
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth' AND c.relname='identities' AND a.attnum>0 AND NOT a.attisdropped;
  IF actual_shape IS DISTINCT FROM '[{"name":"provider_id","type":"text","generated":""},{"name":"user_id","type":"uuid","generated":""},{"name":"identity_data","type":"jsonb","generated":""},{"name":"provider","type":"text","generated":""},{"name":"last_sign_in_at","type":"timestamp with time zone","generated":""},{"name":"created_at","type":"timestamp with time zone","generated":""},{"name":"updated_at","type":"timestamp with time zone","generated":""},{"name":"email","type":"text","generated":"s"},{"name":"id","type":"uuid","generated":""}]'::jsonb THEN
    RAISE EXCEPTION 'Auth export shape differs for identities; review the versioned contract';
  END IF;
END;
$prerequisites$;

CREATE SCHEMA "itrader_sync_export" AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA "itrader_sync_export" FROM PUBLIC;
COMMENT ON SCHEMA "itrader_sync_export" IS 'itrader-auth-export:v1';

CREATE VIEW "itrader_sync_export"."auth_users" WITH (security_barrier=true, security_invoker=false) AS
SELECT
  src."instance_id" AS "instance_id",
  src."id" AS "id",
  src."aud" AS "aud",
  src."role" AS "role",
  src."email" AS "email",
  ''::character varying(255) AS "encrypted_password",
  src."email_confirmed_at" AS "email_confirmed_at",
  src."invited_at" AS "invited_at",
  ''::character varying(255) AS "confirmation_token",
  src."confirmation_sent_at" AS "confirmation_sent_at",
  ''::character varying(255) AS "recovery_token",
  src."recovery_sent_at" AS "recovery_sent_at",
  ''::character varying(255) AS "email_change_token_new",
  ''::character varying(255) AS "email_change",
  src."email_change_sent_at" AS "email_change_sent_at",
  src."last_sign_in_at" AS "last_sign_in_at",
  src."raw_app_meta_data" AS "raw_app_meta_data",
  src."raw_user_meta_data" AS "raw_user_meta_data",
  src."is_super_admin" AS "is_super_admin",
  src."created_at" AS "created_at",
  src."updated_at" AS "updated_at",
  src."phone" AS "phone",
  src."phone_confirmed_at" AS "phone_confirmed_at",
  ''::text AS "phone_change",
  ''::character varying(255) AS "phone_change_token",
  src."phone_change_sent_at" AS "phone_change_sent_at",
  src."confirmed_at" AS "confirmed_at",
  ''::character varying(255) AS "email_change_token_current",
  src."email_change_confirm_status" AS "email_change_confirm_status",
  'infinity'::timestamp with time zone AS "banned_until",
  ''::character varying(255) AS "reauthentication_token",
  src."reauthentication_sent_at" AS "reauthentication_sent_at",
  src."is_sso_user" AS "is_sso_user",
  src."deleted_at" AS "deleted_at",
  src."is_anonymous" AS "is_anonymous"
FROM auth."users" AS src;

CREATE VIEW "itrader_sync_export"."auth_identities" WITH (security_barrier=true, security_invoker=false) AS
SELECT
  src."provider_id" AS "provider_id",
  src."user_id" AS "user_id",
  CASE WHEN pg_catalog.jsonb_typeof(src."identity_data") = 'object' THEN
      (SELECT COALESCE(pg_catalog.jsonb_object_agg(item.key, item.value), '{}'::jsonb)
       FROM pg_catalog.jsonb_each(src."identity_data") AS item
       WHERE item.key !~* 'token|secret|password|credential|refresh') ELSE src."identity_data" END AS "identity_data",
  src."provider" AS "provider",
  src."last_sign_in_at" AS "last_sign_in_at",
  src."created_at" AS "created_at",
  src."updated_at" AS "updated_at",
  src."email" AS "email",
  src."id" AS "id"
FROM auth."identities" AS src;

-- New views can inherit global default grants. Remove API-role access explicitly.
DO $privacy$
DECLARE api_role text; marker text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', 'itrader_sync_export', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', 'itrader_sync_export', api_role);
    END IF;
  END LOOP;
  
  SELECT 'itrader-auth-export:v1:' || md5(pg_get_viewdef('itrader_sync_export.auth_users'::regclass, false)) INTO marker;
  EXECUTE format('COMMENT ON VIEW %I.%I IS %L', 'itrader_sync_export', 'auth_users', marker);

  SELECT 'itrader-auth-export:v1:' || md5(pg_get_viewdef('itrader_sync_export.auth_identities'::regclass, false)) INTO marker;
  EXECUTE format('COMMENT ON VIEW %I.%I IS %L', 'itrader_sync_export', 'auth_identities', marker);
END;
$privacy$;
REVOKE ALL ON ALL TABLES IN SCHEMA "itrader_sync_export" FROM PUBLIC;
GRANT USAGE ON SCHEMA "itrader_sync_export" TO itrader_staging_reader;
GRANT SELECT ON "itrader_sync_export".auth_users, "itrader_sync_export".auth_identities TO itrader_staging_reader;

-- Unexpected global default grants abort the entire provisioning transaction.
DO $verify_acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname='itrader_sync_export' AND a.grantee<>n.nspowner
      AND (a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='itrader_staging_reader') OR a.privilege_type<>'USAGE' OR a.is_grantable)
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='itrader_sync_export' AND a.grantee<>c.relowner
      AND (a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='itrader_staging_reader') OR a.privilege_type<>'SELECT' OR a.is_grantable)
  ) THEN RAISE EXCEPTION 'Unexpected export ACL; nothing was installed'; END IF;
END;
$verify_acl$;
COMMIT;
