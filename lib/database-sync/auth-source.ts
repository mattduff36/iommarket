import type { PoolClient } from "pg";
import { loadPhysicalColumns } from "./columns";
import { quoteIdent } from "./codec";
import { AUTH_EXPORT_COLUMNS, AUTH_EXPORT_SCHEMA, AUTH_EXPORT_TABLES, AUTH_EXPORT_VERSION, type AuthExportTable } from "./auth-export-contract";

export { AUTH_EXPORT_SCHEMA } from "./auth-export-contract";
export type AuthSourceEnv = { [key: string]: string | undefined; DATABASE_SYNC_AUTH_SOURCE_MODE?: string };
export type AuthSourceMode = "direct" | "private-views";

/** Never silently fall back to a less restricted or unprovisioned access path. */
export function authSourceMode(env: AuthSourceEnv = process.env): AuthSourceMode {
  const mode = env.DATABASE_SYNC_AUTH_SOURCE_MODE?.trim() || "direct";
  if (mode !== "direct" && mode !== "private-views") {
    throw new Error("Production source role has an invalid DATABASE_SYNC_AUTH_SOURCE_MODE configuration.");
  }
  return mode;
}

export function sourceAuthTable(table: string, env: AuthSourceEnv = process.env): string {
  if (table !== "users" && table !== "identities") throw new Error("Unsupported source Auth relation.");
  return authSourceMode(env) === "private-views"
    ? `${quoteIdent(AUTH_EXPORT_SCHEMA)}.${quoteIdent(`auth_${table}`)}`
    : `auth.${table}`;
}

type ExportView = {
  table_name: string;
  kind: string;
  schema_owner: string;
  view_owner: string;
  owner_bypass: boolean;
  owner_select: boolean;
  can_select: boolean;
  security_barrier: boolean;
  security_invoker: boolean;
  definition_matches: boolean;
  unsafe_schema_acl: boolean;
  unsafe_view_acl: boolean;
  column_acl: boolean;
  other_dependencies: boolean;
  extra_rules_or_triggers: boolean;
};

/**
 * The versioned provisioning script creates fixed, unfiltered, masked SELECTs.
 * Its owner (postgres) must already bypass Auth RLS. The runtime reader never
 * receives that privilege. A definition digest catches later view edits, while
 * the independent physical-schema comparison catches stale exported columns.
 */
export async function assertPrivateAuthSource(client: PoolClient) {
  const result = await client.query<ExportView>(
    `SELECT c.relname AS table_name, c.relkind::text AS kind,
      pg_get_userbyid(n.nspowner) AS schema_owner, r.rolname AS view_owner,
      r.rolbypassrls AS owner_bypass,
      has_table_privilege(c.relowner, base.oid, 'SELECT') AS owner_select,
      has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
      COALESCE('security_barrier=true' = ANY(c.reloptions), false) AS security_barrier,
      COALESCE('security_invoker=true' = ANY(c.reloptions), false) AS security_invoker,
      COALESCE(obj_description(c.oid, 'pg_class') = $2 || ':' || md5(pg_get_viewdef(c.oid, false)), false) AS definition_matches,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
        WHERE acl.grantee <> n.nspowner AND (acl.grantee <> (SELECT oid FROM pg_roles WHERE rolname='itrader_staging_reader')
          OR acl.privilege_type <> 'USAGE' OR acl.is_grantable)) AS unsafe_schema_acl,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
        WHERE acl.grantee <> c.relowner AND (acl.grantee <> (SELECT oid FROM pg_roles WHERE rolname='itrader_staging_reader')
          OR acl.privilege_type <> 'SELECT' OR acl.is_grantable)) AS unsafe_view_acl,
      EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL AND cardinality(a.attacl)>0) AS column_acl,
      EXISTS (SELECT 1 FROM pg_rewrite rw JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
        WHERE rw.ev_class=c.oid AND d.refclassid='pg_class'::regclass AND d.refobjid NOT IN (c.oid, base.oid)) AS other_dependencies,
      (EXISTS (SELECT 1 FROM pg_rewrite rw WHERE rw.ev_class=c.oid AND rw.rulename <> '_RETURN')
        OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) AS extra_rules_or_triggers
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
     JOIN pg_namespace auth_ns ON auth_ns.nspname='auth'
     JOIN pg_class base ON base.relnamespace=auth_ns.oid AND c.relname='auth_' || base.relname
     WHERE n.nspname=$1 AND c.relname=ANY($3::text[]) AND base.relkind='r'`,
    [AUTH_EXPORT_SCHEMA, AUTH_EXPORT_VERSION, AUTH_EXPORT_TABLES.map((table) => `auth_${table}`)],
  );
  for (const table of AUTH_EXPORT_TABLES) {
    const view = result.rows.find((row) => row.table_name === `auth_${table}`);
    if (!view || view.kind !== "v") throw new Error(`Production source role requires private Auth export view auth_${table}.`);
    if (view.schema_owner !== "postgres" || view.view_owner !== "postgres" || !view.owner_bypass || !view.owner_select) {
      throw new Error(`Production source role cannot verify complete Auth export access for ${table}.`);
    }
    if (!view.can_select || view.unsafe_schema_acl || view.unsafe_view_acl || view.column_acl) {
      throw new Error(`Production source role found unsafe or missing private Auth export permissions for ${table}.`);
    }
    if (!view.security_barrier || view.security_invoker || !view.definition_matches || view.other_dependencies || view.extra_rules_or_triggers) {
      throw new Error(`Production source role found an altered or unverified Auth export definition for ${table}.`);
    }
    await assertExportColumns(client, table);
    // This exercises the actual reader rather than treating catalog grants as a probe.
    await client.query(`SELECT * FROM ${sourceAuthTable(table, { DATABASE_SYNC_AUTH_SOURCE_MODE: "private-views" })} LIMIT 0`);
  }
}

async function assertExportColumns(client: PoolClient, table: AuthExportTable) {
  const base = await loadPhysicalColumns(client, "auth", table);
  const view = await loadPhysicalColumns(client, AUTH_EXPORT_SCHEMA, `auth_${table}`);
  const expected = AUTH_EXPORT_COLUMNS[table];
  const matches = base.length === expected.length && view.length === expected.length && expected.every((column, index) =>
    base[index]?.name === column.name && base[index]?.dataType === column.type &&
    base[index]?.generated === Boolean(column.generated) &&
    view[index]?.name === column.name && view[index]?.dataType === column.type);
  if (!matches) throw new Error(`Production source role found Auth export schema drift for ${table}. Review provisioning before copying.`);
}
