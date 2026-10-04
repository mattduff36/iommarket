import { describe, expect, it, vi } from "vitest";
import {
  inspectDatabaseSync,
  inspectDatabaseSyncConfiguration,
  inspectionPoolOptions,
  isReadOnlySourceRole,
  hasCompleteSourceReadPolicy,
  validateSourceClient,
} from "@/lib/database-sync/preflight";

const productionRead = "postgres://itrader_staging_reader:example@db.snlqivvogfqesxpbjiei.supabase.co:5432/postgres";
const productionPoolerRead = "postgres://itrader_staging_reader.snlqivvogfqesxpbjiei:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";
const development = "postgres://postgres.syneonzucehwlghqmfbg:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";

describe("database sync preflight", () => {
  it("rejects executable security-definer functions before reading source data", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ transaction_read_only: "on" }] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });
    await expect(validateSourceClient({ query } as unknown as import("pg").PoolClient)).rejects.toThrow("privileged functions");
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain("has_function_privilege");
  });
  it("rejects a writable source transaction before querying permissions or data", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ transaction_read_only: "off" }] });
    await expect(validateSourceClient({ query } as unknown as import("pg").PoolClient)).rejects.toThrow("read-only transaction");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("requires a dedicated source URL and a preview-project destination", () => {
    expect(inspectDatabaseSyncConfiguration({ NODE_ENV: "test", DATABASE_URL: development }).blockers).toHaveLength(1);
    expect(inspectDatabaseSyncConfiguration({
      NODE_ENV: "test",
      DATABASE_SYNC_SOURCE_READONLY_URL: productionRead,
      DATABASE_URL: development,
    }).blockers).toEqual([]);
    expect(inspectDatabaseSyncConfiguration({
      NODE_ENV: "test",
      DATABASE_SYNC_SOURCE_READONLY_URL: productionPoolerRead,
      DATABASE_URL: development,
    }).blockers).toEqual([]);
    expect(inspectDatabaseSyncConfiguration({
      NODE_ENV: "test",
      DATABASE_SYNC_SOURCE_READONLY_URL: "postgres://postgres.snlqivvogfqesxpbjiei:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
      DATABASE_URL: development,
    }).blockers).toHaveLength(1);
    expect(inspectDatabaseSyncConfiguration({
      NODE_ENV: "test",
      DATABASE_SYNC_SOURCE_READONLY_URL: "postgres://itrader_staging_reader.wrongref:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
      DATABASE_URL: development,
    }).blockers).toHaveLength(1);
    expect(inspectDatabaseSyncConfiguration({
      NODE_ENV: "test",
      DATABASE_SYNC_SOURCE_READONLY_URL: development,
      DATABASE_URL: development,
    }).blockers).toHaveLength(1);
    expect(inspectDatabaseSyncConfiguration({
      NODE_ENV: "test",
      DATABASE_SYNC_SOURCE_READONLY_URL: productionRead,
      DATABASE_URL: productionRead,
    }).blockers).toHaveLength(1);
  });

  it("inspects through the same IPv4 session endpoint used by plans", () => {
    const result = inspectDatabaseSyncConfiguration({
      NODE_ENV: "test",
      DATABASE_SYNC_SOURCE_READONLY_URL: productionRead,
      POSTGRES_URL_NON_POOLING: "postgres://postgres:example@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
      POSTGRES_URL: "postgres://postgres.syneonzucehwlghqmfbg:example@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true",
    });

    expect(result.blockers).toEqual([]);
    expect(new URL(result.destination ?? "").hostname).toBe("aws-1-eu-west-2.pooler.supabase.com");
    expect(new URL(result.destination ?? "").port).toBe("5432");
  });

  it("strips URL TLS overrides while preserving verified CA settings", () => {
    const cert = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";
    const options = inspectionPoolOptions(`${productionPoolerRead}?sslmode=disable&pgbouncer=true&supa=base`, {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      SUPABASE_DB_CA_CERT: cert,
    });
    const parsed = new URL(options.connectionString ?? "");
    expect(parsed.searchParams.has("sslmode")).toBe(false);
    expect(parsed.searchParams.has("pgbouncer")).toBe(false);
    expect(parsed.searchParams.has("supa")).toBe(false);
    expect(options.ssl).toEqual({ ca: cert, rejectUnauthorized: true });
    expect(options.max).toBe(1);
  });

  it("returns blockers without opening a connection when configuration is missing", async () => {
    const result = await inspectDatabaseSync({ NODE_ENV: "test" });
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(2);
    expect(result.rows).toEqual([]);
  });

  it("rejects source roles with table writes or elevated privileges", () => {
    const role = {
      role_name: "itrader_staging_reader", role_memberships: false, superuser: false, bypass_rls: false, create_role: false, create_db: false,
      replication: false, database_owner: false, database_create: false,
      schema_create: false, elevated_file_role: false,
    };
    const table = {
      schema_name: "public", table_name: "Listing", column_signature: "id:text:true",
      row_security: false, owner_member: false, can_insert: false,
      can_update: false, can_delete: false, can_truncate: false,
      can_references: false, can_trigger: false, can_select: true,
    };
    expect(isReadOnlySourceRole(role, [table])).toBe(true);
    expect(isReadOnlySourceRole({ ...role, role_name: "another_reader" }, [table])).toBe(false);
    const secured = { ...table, row_security: true };
    const policy = { table_name: "Listing", permissive: true, role_specific: true, applies: true, expression: "true" };
    expect(hasCompleteSourceReadPolicy(secured, [policy])).toBe(true);
    expect(hasCompleteSourceReadPolicy(secured, [])).toBe(false);
    expect(hasCompleteSourceReadPolicy(secured, [{ ...policy, role_specific: false }])).toBe(false);
    expect(hasCompleteSourceReadPolicy(secured, [{ ...policy, expression: "(user_id = auth.uid())" }])).toBe(false);
    expect(hasCompleteSourceReadPolicy(secured, [policy, { ...policy, permissive: false }])).toBe(false);
    expect(hasCompleteSourceReadPolicy(secured, [policy, { ...policy, permissive: false, applies: false }])).toBe(true);
    expect(isReadOnlySourceRole({ ...role, database_owner: true }, [table])).toBe(false);
    expect(isReadOnlySourceRole({ ...role, role_memberships: true }, [table])).toBe(false);
    expect(isReadOnlySourceRole(role, [{ ...table, can_update: true }])).toBe(false);
    expect(isReadOnlySourceRole(role, [{ ...table, owner_member: true }])).toBe(false);
  });
});
