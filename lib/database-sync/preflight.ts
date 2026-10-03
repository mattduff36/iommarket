import pg from "pg";
import { buildDatabasePoolOptions } from "@/lib/db/pool-options";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";

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

const COUNT_TABLES = [
  "User", "Listing", "DealerProfile", "DealerPreviewPack", "SiteSetting",
  "Payment", "Subscription", "PaymentWebhookInbox", "SampleCheckout",
  "MonitoringIssue", "MonitoringEvent", "MonitoringAlertDelivery", "AdminAuditLog",
] as const;

function parseDatabaseUrl(raw: string | undefined, ref: string, dedicatedSource = false): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    const username = decodeURIComponent(url.username);
    if (url.hostname === `db.${ref}.supabase.co`) {
      return username && (!dedicatedSource || username !== "postgres") ? raw : null;
    }
    if (url.hostname.endsWith(".pooler.supabase.com")) {
      const suffix = `.${ref}`;
      const role = username.endsWith(suffix) ? username.slice(0, -suffix.length) : "";
      return role && (!dedicatedSource || role !== "postgres") ? raw : null;
    }
  } catch { /* Malformed URL is never a valid target. */ }
  return null;
}

function destinationUrl(env: NodeJS.ProcessEnv): string | null {
  const urls = [env.POSTGRES_URL, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL]
    .filter((value): value is string => Boolean(value?.trim()));
  if (urls.length === 0 || !urls.every((url) => parseDatabaseUrl(url, PREVIEW_PROJECT_REF))) return null;
  return urls[0];
}

export function inspectDatabaseSyncConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const blockers: string[] = [];
  const source = parseDatabaseUrl(env.DATABASE_SYNC_SOURCE_READONLY_URL, PRODUCTION_PROJECT_REF, true);
  const destination = destinationUrl(env);
  if (!source) blockers.push("A dedicated production read-only connection is not configured or points to the wrong project.");
  if (!destination) blockers.push("The development database connection is missing or does not point exclusively to the preview project.");
  return { source, destination, blockers };
}

type TableRow = {
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

type RolePermissions = {
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
  return !role.superuser && !role.bypass_rls && !role.create_role &&
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

async function inspectConnection(url: string, requireSourceReadOnly: boolean, env: NodeJS.ProcessEnv) {
  const pool = new pg.Pool(inspectionPoolOptions(url, env));
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    const role = await client.query<RolePermissions>(`SELECT r.rolsuper AS superuser, r.rolbypassrls AS bypass_rls,
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
        has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
        has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
        has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
        has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
        has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_references,
        has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_trigger,
        has_table_privilege(current_user, c.oid, 'SELECT') AS can_select
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'auth', 'storage') AND c.relkind IN ('r', 'p') ORDER BY n.nspname, c.relname`);
    const readOnlyRole = isReadOnlySourceRole(permissions, tables.rows);
    if (requireSourceReadOnly && !readOnlyRole) {
      throw new Error("Production source role has write, ownership, or elevated privileges.");
    }
    const publicTables = tables.rows.filter((table) => table.schema_name === "public");
    const missingSelect = publicTables.filter((table) => !table.can_select).length;
    if (requireSourceReadOnly && missingSelect > 0) {
      throw new Error(`Production source role lacks SELECT on ${missingSelect} public table(s).`);
    }
    const selectedCounts: Record<string, number> = {};
    for (const table of COUNT_TABLES) {
      if (!publicTables.some((row) => row.table_name === table)) continue;
      const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.${quoteIdentifier(table)}`);
      selectedCounts[table] = Number(result.rows[0]?.count ?? 0);
    }
    const migrations = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM public._prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name`,
    );
    await client.query("ROLLBACK");
    return {
      tables: publicTables,
      counts: selectedCounts,
      migrations: migrations.rows.map((row) => row.migration_name),
      readOnlyRole,
      rowSecurityTables: publicTables.filter((table) => table.row_security).map((table) => table.table_name),
    };
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
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
    if (!base.schemaCompatible) base.blockers.push("Public table schemas differ. Apply and verify reviewed migrations before any copy.");
    if (!base.migrationsCompatible) base.blockers.push("Applied Prisma migrations differ between production and development.");
    if (source.rowSecurityTables.length) base.blockers.push("Production has row-level security on public tables; counts may be partial.");
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
