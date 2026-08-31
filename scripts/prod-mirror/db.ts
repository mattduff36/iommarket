import pg from "pg";
import type { WaitlistSnapshotRow } from "./waitlist";

export function cleanUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("supa");
    return parsed.toString();
  } catch {
    return raw.trim();
  }
}

export function createReadPool(connectionString: string) {
  return new pg.Pool({
    connectionString: cleanUrl(connectionString),
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
}

export function createWritePool(connectionString: string) {
  return new pg.Pool({
    connectionString: cleanUrl(connectionString),
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
}

export async function snapshotWaitlist(pool: pg.Pool): Promise<WaitlistSnapshotRow[]> {
  const result = await pool.query(
    `SELECT id, email, interests, source,
            "deletedAt", "deletedByAdminId", "deletionReason",
            "marketingConsentAt", "marketingPolicyVersion", "marketingWithdrawnAt",
            "createdAt", "updatedAt"
     FROM "WaitlistUser"
     ORDER BY email ASC`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    interests: row.interests,
    source: String(row.source),
    deletedAt: toIso(row.deletedAt),
    deletedByAdminId: row.deletedByAdminId ? String(row.deletedByAdminId) : null,
    deletionReason: row.deletionReason ? String(row.deletionReason) : null,
    marketingConsentAt: toIso(row.marketingConsentAt),
    marketingPolicyVersion: row.marketingPolicyVersion
      ? String(row.marketingPolicyVersion)
      : null,
    marketingWithdrawnAt: toIso(row.marketingWithdrawnAt),
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
  }));
}

export async function publicTableNames(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename ASC`,
  );
  return result.rows.map((row) => String(row.tablename));
}

export async function tableCounts(pool: pg.Pool, tables: string[]) {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await pool.query(`SELECT COUNT(*)::int AS count FROM "${table.replaceAll('"', "")}"`);
    counts[table] = result.rows[0]?.count ?? 0;
  }
  return counts;
}

export async function readAuthInstanceId(pool: pg.Pool): Promise<string | null> {
  const instances = await pool.query(`SELECT id::text AS id FROM auth.instances LIMIT 1`);
  if (instances.rows[0]?.id) return String(instances.rows[0].id);
  const users = await pool.query(
    `SELECT instance_id::text AS id FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1`,
  );
  return users.rows[0]?.id ? String(users.rows[0].id) : null;
}

export async function appliedPrismaMigrationNames(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query(
    `SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name ASC`,
  );
  return result.rows.map((row) => String(row.migration_name));
}

export async function listAuthEmails(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query(
    `SELECT email FROM auth.users WHERE email IS NOT NULL ORDER BY email ASC`,
  );
  return result.rows.map((row) => String(row.email).trim().toLowerCase());
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
