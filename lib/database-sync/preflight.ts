import pg from "pg";
import { requiredPublicRelations } from "./catalog";
import { buildDatabasePoolOptions } from "@/lib/db/pool-options";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";
import { resolvePreviewSessionUrl } from "./session";

export type DatabaseSyncInspection = {
  ready: boolean;
  source: string;
  destination: string;
  sourceReadOnlyRole: boolean;
  schemaCompatible: boolean;
  migrationsCompatible: boolean;
  sourceTables: number;
  destinationTables: number;
  rows: Array<{ table: string; production: number; development: number }>;
  blockers: string[];
};

export const SOURCE_READER_ROLE = "itrader_staging_reader";
export const SYNC_READ_TABLES: readonly string[] = requiredPublicRelations().filter((table) => table !== "spatial_ref_sys");
const COUNT_TABLES = SYNC_READ_TABLES;
const AUTH_READ_TABLES = ["users", "identities"] as const;

function parseDatabaseUrl(raw: string | undefined, ref: string, dedicatedSource = false): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    const username = decodeURIComponent(url.username);
    if (url.hostname === `db.${ref}.supabase.co`) {
      return username && (!dedicatedSource || username === SOURCE_READER_ROLE) ? raw : null;
    }
    if (url.hostname.endsWith(".pooler.supabase.com")) {
      const suffix = `.${ref}`;
      const role = username.endsWith(suffix) ? username.slice(0, -suffix.length) : "";
      return role && (!dedicatedSource || role === SOURCE_READER_ROLE) ? raw : null;
    }
  } catch { /* Malformed URL is never a valid target. */ }
  return null;
}

function destinationUrl(env: NodeJS.ProcessEnv): string | null {
  const urls = [env.DATABASE_SYNC_SESSION_URL, env.POSTGRES_URL, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL]
    .filter((value): value is string => Boolean(value?.trim()));
  if (urls.length === 0 || !urls.every((url) => parseDatabaseUrl(url, PREVIEW_PROJECT_REF))) return null;
  try {
    return resolvePreviewSessionUrl(env);
  } catch {
    return null;
  }
}

export function inspectDatabaseSyncConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const blockers: string[] = [];
  const source = parseDatabaseUrl(env.DATABASE_SYNC_SOURCE_READONLY_URL, PRODUCTION_PROJECT_REF, true);
  const destination = destinationUrl(env);
  if (!source) blockers.push("A dedicated production read-only connection is not configured or points to the wrong project.");
  if (!destination) blockers.push("The development database connection is missing or does not point exclusively to the preview project.");
  return { source, destination, blockers };
}

export type TableRow = {
  schema_name: string;
  table_name: string;
  column_signature: string;
  row_security: boolean;
  owner_member: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_truncate: boolean;
  can_references: boolean;
  can_trigger: boolean;
  can_select: boolean;
};

export type RolePermissions = {
  role_name: string;
  role_memberships: boolean;
  superuser: boolean;
  bypass_rls: boolean;
  create_role: boolean;
  create_db: boolean;
  replication: boolean;
  database_owner: boolean;
  database_create: boolean;
  schema_create: boolean;
  elevated_file_role: boolean;
};

export function isReadOnlySourceRole(role: RolePermissions, tables: TableRow[]): boolean {
  return role.role_name === SOURCE_READER_ROLE && role.role_memberships === false && !role.superuser && !role.bypass_rls && !role.create_role &&
    !role.create_db && !role.replication && !role.database_owner &&
    !role.database_create && !role.schema_create && !role.elevated_file_role &&
    tables.every((table) => !table.owner_member && !table.can_insert &&
      !table.can_update && !table.can_delete && !table.can_truncate &&
      !table.can_references && !table.can_trigger);
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function inspectionPoolOptions(url: string, env: NodeJS.ProcessEnv = process.env) {
  return {
    ...buildDatabasePoolOptions(url, env),
    max: 1,
    connectionTimeoutMillis: 5_000,
  };
}

export type SourcePolicy = {
  table_name: string;
  permissive: boolean;
  role_specific: boolean;
  applies: boolean;
  expression: string | null;
};

/** Exact unconditional reader policy prevents silently partial RLS snapshots. */
export function hasCompleteSourceReadPolicy(table: TableRow, policies: SourcePolicy[]): boolean {
  if (!table.row_security) return true;
  const applicable = policies.filter((policy) => policy.table_name === table.table_name && policy.applies);
  return !applicable.some((policy) => !policy.permissive) && applicable.some((policy) =>
    policy.permissive && policy.role_specific && policy.expression?.trim() === "true");
}

async function inspectPermissions(client: pg.PoolClient, requireSourceReadOnly: boolean) {
    const role = await client.query<RolePermissions>(`SELECT current_user AS role_name,
        EXISTS (SELECT 1 FROM pg_roles other WHERE other.rolname <> current_user
          AND pg_has_role(current_user, other.oid, 'MEMBER')) AS role_memberships,
        r.rolsuper AS superuser, r.rolbypassrls AS bypass_rls,
        r.rolcreaterole AS create_role, r.rolcreatedb AS create_db, r.rolreplication AS replication,
        pg_has_role(current_user, d.datdba, 'MEMBER') AS database_owner,
        has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
        EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public', 'auth', 'storage')
          AND has_schema_privilege(current_user, n.oid, 'CREATE')) AS schema_create,
        (pg_has_role(current_user, 'pg_write_server_files', 'MEMBER') OR
          pg_has_role(current_user, 'pg_execute_server_program', 'MEMBER')) AS elevated_file_role
      FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
      WHERE r.rolname = current_user`);
    const permissions = role.rows[0];
    if (!permissions) throw new Error("Database role could not be inspected.");
    const tables = await client.query<TableRow>(`SELECT n.nspname AS schema_name, c.relname AS table_name,
        COALESCE((SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '') AS column_signature,
        c.relrowsecurity AS row_security,
        pg_has_role(current_user, c.relowner, 'MEMBER') AS owner_member,
        (has_table_privilege(current_user, c.oid, 'INSERT') OR has_any_column_privilege(current_user, c.oid, 'INSERT')) AS can_insert,
        (has_table_privilege(current_user, c.oid, 'UPDATE') OR has_any_column_privilege(current_user, c.oid, 'UPDATE')) AS can_update,
        has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
        has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
        (has_table_privilege(current_user, c.oid, 'REFERENCES') OR has_any_column_privilege(current_user, c.oid, 'REFERENCES')) AS can_references,
        has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_trigger,
        has_table_privilege(current_user, c.oid, 'SELECT') AS can_select
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'auth', 'storage') AND c.relkind IN ('r', 'p') ORDER BY n.nspname, c.relname`);
    const readOnlyRole = isReadOnlySourceRole(permissions, tables.rows);
    if (requireSourceReadOnly && !readOnlyRole) {
      throw new Error("Production source role has write, ownership, or elevated privileges.");
    }
    const publicTables = tables.rows.filter((table) => table.schema_name === "public" && SYNC_READ_TABLES.includes(table.table_name));
    const authTables = tables.rows.filter((table) => table.schema_name === "auth" && AUTH_READ_TABLES.includes(table.table_name as typeof AUTH_READ_TABLES[number]));
    const missingPublic = SYNC_READ_TABLES.find((table) => !publicTables.some((row) => row.table_name === table));
    const missingAuth = AUTH_READ_TABLES.find((table) => !authTables.some((row) => row.table_name === table));
    if (requireSourceReadOnly && (missingPublic || missingAuth)) {
      throw new Error(`Database role cannot inspect required sync table ${missingPublic ?? missingAuth}.`);
    }
    const unreadable = [...publicTables, ...authTables].find((table) => !table.can_select);
    if (requireSourceReadOnly && unreadable) {
      throw new Error(`Production source role lacks SELECT on ${unreadable.schema_name}.${unreadable.table_name}.`);
    }
    if (requireSourceReadOnly) {
      const policies = await client.query<SourcePolicy>(`SELECT c.relname AS table_name,
        p.polpermissive AS permissive,
        (SELECT oid FROM pg_roles WHERE rolname = current_user) = ANY(p.polroles) AS role_specific,
        (0::oid = ANY(p.polroles) OR EXISTS (SELECT 1 FROM unnest(p.polroles) AS policy_role(oid)
          WHERE CASE WHEN policy_role.oid = 0 THEN false
            ELSE pg_has_role(current_user, policy_role.oid, 'MEMBER') END)) AS applies,
        pg_get_expr(p.polqual, p.polrelid) AS expression
        FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) AND p.polcmd IN ('r', '*')`, [publicTables.map((table) => table.table_name)]);
      const blockedPolicy = publicTables.find((table) => !hasCompleteSourceReadPolicy(table, policies.rows));
      if (blockedPolicy) {
        throw new Error(`Production source role lacks an unconditional reader RLS policy on ${blockedPolicy.table_name}.`);
      }
    }
    return { tables: publicTables, readOnlyRole };
}

export async function assertRequiredRelations(client: pg.PoolClient, relations: ReadonlyArray<{ schema: string; name: string }>, label: "source" | "destination") {
  const result = await client.query<{ schema: string; name: string }>(
    `SELECT n.nspname AS schema, c.relname AS name
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND (n.nspname, c.relname) IN (
       SELECT schema_name, table_name FROM unnest($1::text[], $2::text[]) AS required(schema_name, table_name)
     )`,
    [relations.map((relation) => relation.schema), relations.map((relation) => relation.name)],
  );
  const present = new Set(result.rows.map((row) => `${row.schema}.${row.name}`));
  const missing = relations.find((relation) => !present.has(`${relation.schema}.${relation.name}`));
  if (missing) throw new Error(`Required ${label} table ${missing.schema}.${missing.name} is missing.`);
}

/** Call inside the same READ ONLY transaction used to read the source snapshot. */
export async function validateSourceClient(client: pg.PoolClient) {
  const transaction = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
  if (transaction.rows[0]?.transaction_read_only !== "on") {
    throw new Error("Production source role requires a read-only transaction.");
  }
  const functions = await client.query<{ count: string }>(`SELECT count(*)::text AS count
    FROM pg_proc p WHERE p.prosecdef AND has_function_privilege(current_user, p.oid, 'EXECUTE')`);
  if (functions.rows[0]?.count !== "0") {
    throw new Error("Production source role can execute privileged functions; review EXECUTE grants before copying.");
  }
  return inspectPermissions(client, true);
}

/** Does not begin, commit, or release: caller owns the snapshot transaction. */
export async function inspectClient(client: pg.PoolClient, requireSourceReadOnly: boolean) {
    const { tables: publicTables, readOnlyRole } = requireSourceReadOnly
      ? await validateSourceClient(client) : await inspectPermissions(client, false);
    const selectedCounts: Record<string, number> = {};
    for (const table of COUNT_TABLES) {
      if (!publicTables.some((row) => row.table_name === table)) continue;
      const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.${quoteIdentifier(table)}`);
      selectedCounts[table] = Number(result.rows[0]?.count ?? 0);
    }
    const migrations = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM public._prisma_migrations WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL ORDER BY migration_name`,
    );
    return {
      tables: publicTables,
      counts: selectedCounts,
      migrations: migrations.rows.map((row) => row.migration_name),
      readOnlyRole,
      rowSecurityTables: publicTables.filter((table) => table.row_security).map((table) => table.table_name),
    };
}

export async function inspectConnection(url: string, requireSourceReadOnly: boolean, env: NodeJS.ProcessEnv = process.env) {
  const pool = new pg.Pool(inspectionPoolOptions(url, env));
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    return await inspectClient(client, requireSourceReadOnly);
  } finally {
    await client?.query("ROLLBACK").catch(() => undefined);
    client?.release();
    await pool.end();
  }
}

export async function inspectDatabaseSync(env: NodeJS.ProcessEnv = process.env): Promise<DatabaseSyncInspection> {
  const config = inspectDatabaseSyncConfiguration(env);
  const base: DatabaseSyncInspection = {
    ready: false,
    source: `Production Supabase project ${PRODUCTION_PROJECT_REF}`,
    destination: `Development Supabase project ${PREVIEW_PROJECT_REF}`,
    sourceReadOnlyRole: false,
    schemaCompatible: false,
    migrationsCompatible: false,
    sourceTables: 0,
    destinationTables: 0,
    rows: [],
    blockers: [...config.blockers],
  };
  if (!config.source || !config.destination) return base;
  try {
    // Verify the source role before opening any connection to the destination.
    const source = await inspectConnection(config.source, true, env);
    base.sourceReadOnlyRole = source.readOnlyRole;
    const destination = await inspectConnection(config.destination, false, env);
    base.sourceTables = source.tables.length;
    base.destinationTables = destination.tables.length;
    const sourceSignatures = new Map(source.tables.map((table) => [table.table_name, table.column_signature]));
    const destinationSignatures = new Map(destination.tables.map((table) => [table.table_name, table.column_signature]));
    base.schemaCompatible = sourceSignatures.size === destinationSignatures.size &&
      [...sourceSignatures].every(([name, signature]) => destinationSignatures.get(name) === signature);
    base.migrationsCompatible = source.migrations.join("\n") === destination.migrations.join("\n");
    if (!base.schemaCompatible) base.blockers.push("Selected sync table schemas differ. Apply and verify reviewed migrations before any copy.");
    if (!base.migrationsCompatible) base.blockers.push("Applied Prisma migrations differ between production and development.");
    base.rows = COUNT_TABLES.map((table) => ({
      table,
      production: source.counts[table] ?? 0,
      development: destination.counts[table] ?? 0,
    }));
    base.ready = base.blockers.length === 0;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Production source role")
      ? error.message
      : error instanceof Error && error.message.startsWith("Database role")
        ? error.message
        : "Database inspection failed. Check read-only credentials, SELECT grants, network access, and schema compatibility in server logs.";
    base.blockers.push(message);
  }
  return base;
}
