import { AUTH_TOKEN_COLUMNS } from "../../lib/database-sync/auth-clone";
import { AUTH_EXPORT_COLUMNS, AUTH_EXPORT_SCHEMA, AUTH_EXPORT_TABLES, AUTH_EXPORT_VERSION, type AuthExportTable } from "../../lib/database-sync/auth-export-contract";
import { quoteIdent } from "../../lib/database-sync/codec";

const schema = quoteIdent(AUTH_EXPORT_SCHEMA);
const reader = "itrader_staging_reader";
const secretColumns = new Set<string>(["encrypted_password", ...AUTH_TOKEN_COLUMNS]);
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Pure generator: never opens a database connection or executes SQL. */
export function authExportViewSql(table: AuthExportTable): string {
  const projection = AUTH_EXPORT_COLUMNS[table].map((column) => {
    const ref = `src.${quoteIdent(column.name)}`;
    let value = ref;
    if (table === "users" && secretColumns.has(column.name)) value = `''::${column.type}`;
    if (table === "users" && column.name === "banned_until") value = `'infinity'::${column.type}`;
    if (table === "identities" && column.name === "identity_data") {
      value = `CASE WHEN pg_catalog.jsonb_typeof(${ref}) = 'object' THEN
      (SELECT COALESCE(pg_catalog.jsonb_object_agg(item.key, item.value), '{}'::jsonb)
       FROM pg_catalog.jsonb_each(${ref}) AS item
       WHERE item.key !~* 'token|secret|password|credential|refresh') ELSE ${ref} END`;
    }
    return `  ${value} AS ${quoteIdent(column.name)}`;
  }).join(",\n");
  return `CREATE VIEW ${schema}.${quoteIdent(`auth_${table}`)} WITH (security_barrier=true, security_invoker=false) AS\nSELECT\n${projection}\nFROM auth.${quoteIdent(table)} AS src;`;
}

function shapeCheck(table: AuthExportTable): string {
  const expected = JSON.stringify(AUTH_EXPORT_COLUMNS[table]);
  return `
  SELECT jsonb_agg(jsonb_build_object('name', a.attname::text,
    'type', format_type(a.atttypid,a.atttypmod), 'generated', a.attgenerated::text) ORDER BY a.attnum)
    INTO actual_shape
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth' AND c.relname=${literal(table)} AND a.attnum>0 AND NOT a.attisdropped;
  IF actual_shape IS DISTINCT FROM ${literal(expected)}::jsonb THEN
    RAISE EXCEPTION 'Auth export shape differs for ${table}; review the versioned contract';
  END IF;`;
}

export function authExportProvisioningSql(): string {
  const views = AUTH_EXPORT_TABLES.map(authExportViewSql).join("\n\n");
  const comments = AUTH_EXPORT_TABLES.map((table) => `
  SELECT ${literal(`${AUTH_EXPORT_VERSION}:`)} || md5(pg_get_viewdef(${literal(`${AUTH_EXPORT_SCHEMA}.auth_${table}`)}::regclass, false)) INTO marker;
  EXECUTE format('COMMENT ON VIEW %I.%I IS %L', ${literal(AUTH_EXPORT_SCHEMA)}, ${literal(`auth_${table}`)}, marker);`).join("\n");
  return `-- PROPOSED PRODUCTION PROVISIONING. Requires separate explicit approval.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${reader}' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) THEN
    RAISE EXCEPTION 'Restricted runtime reader is absent or elevated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=${literal(AUTH_EXPORT_SCHEMA)}) THEN
    RAISE EXCEPTION 'Private export schema already exists; review rather than overwriting';
  END IF;
  ${AUTH_EXPORT_TABLES.map(shapeCheck).join("\n")}
END;
$prerequisites$;

CREATE SCHEMA ${schema} AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
COMMENT ON SCHEMA ${schema} IS ${literal(AUTH_EXPORT_VERSION)};

${views}

-- New views can inherit global default grants. Remove API-role access explicitly.
DO $privacy$
DECLARE api_role text; marker text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', ${literal(AUTH_EXPORT_SCHEMA)}, api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', ${literal(AUTH_EXPORT_SCHEMA)}, api_role);
    END IF;
  END LOOP;
  ${comments}
END;
$privacy$;
REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${schema} TO ${reader};
GRANT SELECT ON ${schema}.auth_users, ${schema}.auth_identities TO ${reader};

-- Unexpected global default grants abort the entire provisioning transaction.
DO $verify_acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname=${literal(AUTH_EXPORT_SCHEMA)} AND a.grantee<>n.nspowner
      AND (a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='${reader}') OR a.privilege_type<>'USAGE' OR a.is_grantable)
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname=${literal(AUTH_EXPORT_SCHEMA)} AND a.grantee<>c.relowner
      AND (a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='${reader}') OR a.privilege_type<>'SELECT' OR a.is_grantable)
  ) THEN RAISE EXCEPTION 'Unexpected export ACL; nothing was installed'; END IF;
END;
$verify_acl$;
COMMIT;
`;
}

export function authExportRollbackSql(): string {
  return `-- Requires explicit approval. Revoke the export before removing its objects.
-- No CASCADE, Auth table changes, credential changes, or broad schema removal.
BEGIN;
SET LOCAL lock_timeout='5s';
REVOKE SELECT ON ${schema}.auth_users, ${schema}.auth_identities FROM ${reader};
REVOKE USAGE ON SCHEMA ${schema} FROM ${reader};
DROP VIEW ${schema}.auth_users;
DROP VIEW ${schema}.auth_identities;
DROP SCHEMA ${schema};
COMMIT;
-- Set the staging-only DATABASE_SYNC_AUTH_SOURCE_MODE back to direct, or disable
-- the feature. Direct mode will safely block while auth USAGE remains absent.
`;
}
