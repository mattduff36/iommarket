import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyClone, prepareClone, restoreClone, type IsolatedDatabaseSync } from "@/lib/database-sync/clone-engine";
import { inspectConnection, validateSourceClient } from "@/lib/database-sync/preflight";
import { authFixtureSql } from "./database-sync-auth-fixture";
import { authExportProvisioningSql, authExportViewSql } from "@/scripts/database-sync/auth-export-provisioning";
import { AUTH_EXPORT_SCHEMA } from "@/lib/database-sync/auth-source";

const BIN = "C:/Program Files/PostgreSQL/18/bin";
const PRIVATE_AUTH = process.env.DATABASE_SYNC_TEST_PRIVATE_AUTH_EXPORT === "1";
const PORT = PRIVATE_AUTH ? 55436 : 55435;
const DATA = mkdtempSync(join(tmpdir(), "iommarket-auth-export-it-"));
const SCHEMA = join(DATA, "fixture-schema.sql");
const postgresAvailable = existsSync(join(BIN, "initdb.exe"));
const ADMIN_AUTH = "11111111-1111-4111-8111-111111111111";
const UPDATE_AUTH = "33333333-3333-4333-8333-333333333333";
const IMPORTED_AUTH = "22222222-2222-4222-8222-222222222222";
const DEV_AUTH = "44444444-4444-4444-8444-444444444444";
const DEST_INSTANCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_INSTANCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_SYNC_ISOLATED_TEST: "1",
  DATABASE_SYNC_AUTH_SOURCE_MODE: PRIVATE_AUTH ? "private-views" : "direct",
  DATABASE_SYNC_ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
};
const WRITE_SQL = /^\s*(insert|update|delete|truncate|alter|drop|create|grant|revoke|copy|lock|call|do)\b/i;

type PlanCounts = { captured?: number; insert: number; update: number; delete: number; preserve: number; skip: number };
type PlanRow = { id: string; status: string; summary: unknown; backup_bytes?: string | number | null };

function exe(name: string) {
  return join(BIN, `${name}.exe`);
}

function run(name: string, args: string[]) {
  // pg_ctl start leaves postgres holding inherited pipes, so execFileSync must not wait on them.
  execFileSync(exe(name), args, { stdio: "ignore", timeout: 120_000 });
}

function connect(database: string, user = "fixture_root"): Client {
  return new Client({ host: "127.0.0.1", port: PORT, database, user, password: user === "itrader_staging_reader" ? "reader" : undefined });
}

let sourceOwner: Client;
let destination: Client;
let sourceReader: Client;
let exportOwner: Client | undefined;
let sourceSql: string[] = [];
let started = false;

function recordedSource(): PoolClient {
  const query = sourceReader.query.bind(sourceReader);
  return new Proxy(sourceReader, {
    get(target, property, receiver) {
      if (property === "query") {
        return (sql: unknown, parameters?: unknown) => {
          if (typeof sql === "string") sourceSql.push(sql);
          return query(sql as never, parameters as never);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as PoolClient;
}

function isolated(): IsolatedDatabaseSync {
  return {
    destination: destination as unknown as PoolClient,
    openSource: async () => ({ client: recordedSource(), close: async () => undefined }),
  };
}

function summaryOf(row: PlanRow) {
  return row.summary as { counts: Record<string, PlanCounts>; blockers: string[] };
}

async function settle(client: Client) {
  await client.query("ROLLBACK").catch(() => undefined);
}

async function resetRows() {
  await settle(sourceOwner);
  await settle(destination);
  await settle(sourceReader);
  const truncate = `DO $$ DECLARE stmt text; BEGIN
    SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', n.nspname, c.relname), ', ') || ' RESTART IDENTITY CASCADE' INTO stmt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations';
    IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
  END $$`;
  await sourceOwner.query(truncate);
  await destination.query(truncate);
  await sourceOwner.query(`TRUNCATE TABLE auth.identities, auth.users CASCADE`);
  await destination.query(`TRUNCATE TABLE auth.sessions, auth.identities, auth.users CASCADE`);
  await destination.query(`DELETE FROM staging_admin.database_sync_chunks`);
  await destination.query(`DELETE FROM staging_admin.database_sync_runs`);
  await destination.query(`UPDATE staging_admin.database_sync_state SET active_generation_id = NULL`);
}

async function insertUser(client: Client, id: string, authUserId: string, email: string, name: string, role: "ADMIN" | "USER", regionId: string | null = null) {
  await client.query(
    `INSERT INTO public."User"(id, "authUserId", email, name, role, "regionId", "updatedAt") VALUES ($1,$2,$3,$4,$5::"UserRole",$6,'2026-10-04 12:00:00')`,
    [id, authUserId, email, name, role, regionId],
  );
}

async function insertAuth(client: Client, instanceId: string, id: string, email: string, password: string, token: string) {
  await client.query(
    `INSERT INTO auth.users(instance_id, id, email, encrypted_password, email_confirmed_at, phone_confirmed_at, confirmation_token)
     VALUES ($1::uuid,$2::uuid,$3,$4,'2026-10-04 10:00:00+00','2026-10-04 12:00:00+00',$5)`,
    [instanceId, id, email, password, token],
  );
  await client.query(
    `INSERT INTO auth.identities(id, user_id, identity_data, provider, provider_id)
     VALUES ($1::uuid, $1::uuid, $2::jsonb, 'email', $1)`,
    [id, JSON.stringify({ email, password: "hidden" })],
  );
}

async function seedAdmins() {
  await insertUser(sourceOwner, "admin", ADMIN_AUTH, "admin@example.com", "Production Admin", "ADMIN");
  await insertUser(destination, "admin", ADMIN_AUTH, "admin@example.com", "Staging Admin", "ADMIN");
  await insertAuth(sourceOwner, SOURCE_INSTANCE, ADMIN_AUTH, "admin@example.com", "source-secret", "source-token");
  await insertAuth(destination, DEST_INSTANCE, ADMIN_AUTH, "admin@example.com", "dest-secret", "dest-token");
}

async function seedMinimal() {
  await resetRows();
  await seedAdmins();
}

function assertSourceSql(sql: readonly string[]) {
  expect(sql.filter((statement) => WRITE_SQL.test(statement))).toEqual([]);
  expect(sql.some((statement) => statement.includes("REPEATABLE READ READ ONLY"))).toBe(true);
  expect(sql.some((statement) => statement.includes("f.contype::text"))).toBe(true);
  expect(sql.some((statement) => statement.includes("SHOW transaction_read_only"))).toBe(true);
  if (PRIVATE_AUTH) {
    expect(sql.some((statement) => statement.includes(AUTH_EXPORT_SCHEMA))).toBe(true);
    expect(sql.some((statement) => /FROM\s+auth\.(users|identities)\b/i.test(statement))).toBe(false);
  }
}

describe.skipIf(!postgresAvailable)(`isolated production-to-development merge (${PRIVATE_AUTH ? "private Auth views" : "direct Auth"})`, () => {
  beforeAll(async () => {
    // This run owns its unique directory. Never stop or delete another test cluster.
    run("initdb", ["-D", DATA, "--username=fixture_root", "--auth=trust", "--encoding=UTF8", "--locale=C", "--no-sync"]);
    appendFileSync(join(DATA, "postgresql.conf"), `\nport=${PORT}\nlisten_addresses='127.0.0.1'\n`);
    run("pg_ctl", ["-D", DATA, "-l", join(DATA, "server.log"), "-w", "start"]);
    started = true;
    const configDir = join(DATA, "prisma-config");
    mkdirSync(configDir, { recursive: true });
    const configFile = join(configDir, "prisma.config.ts");
    writeFileSync(configFile, `import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: ${JSON.stringify(join(process.cwd(), "prisma/schema.prisma"))},
  datasource: { url: "postgresql://fixture_root@127.0.0.1:${PORT}/postgres" },
});
`);
    execFileSync(process.execPath, [
      join(process.cwd(), "node_modules/prisma/build/index.js"),
      "migrate", "diff", "--config", configFile, "--from-empty", "--to-schema", join(process.cwd(), "prisma/schema.prisma"), "--script", "-o", SCHEMA,
    ], {
      cwd: process.cwd(),
      stdio: "ignore",
      timeout: 90_000,
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        NODE_PATH: join(process.cwd(), "node_modules"),
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
    });
    run("createdb", ["-h", "127.0.0.1", "-p", String(PORT), "-U", "fixture_root", "sync_source"]);
    run("createdb", ["-h", "127.0.0.1", "-p", String(PORT), "-U", "fixture_root", "sync_dest"]);
    for (const database of ["sync_source", "sync_dest"]) {
      run("psql", ["-h", "127.0.0.1", "-p", String(PORT), "-U", "fixture_root", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", SCHEMA]);
    }
    sourceOwner = connect("sync_source");
    destination = connect("sync_dest");
    await sourceOwner.connect();
    await destination.connect();
    await sourceOwner.query(`CREATE ROLE supabase_admin NOLOGIN;
      CREATE ROLE supabase_auth_admin NOLOGIN;
      CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
      CREATE ROLE service_role NOLOGIN;`);
    const extra = `
      ${authFixtureSql()}
      CREATE TABLE IF NOT EXISTS public._prisma_migrations (
        id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
        migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
        started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0
      );
      INSERT INTO public._prisma_migrations(id, checksum, finished_at, migration_name, applied_steps_count)
      VALUES ('m1', 'abc', now(), 'baseline', 1);
      ALTER TABLE public."Region"
        ADD COLUMN probe_bytea bytea,
        ADD COLUMN probe_amount numeric(20,8),
        ADD COLUMN probe_seen timestamptz,
        ADD COLUMN probe_tags text[],
        ADD COLUMN probe_seq integer GENERATED ALWAYS AS IDENTITY,
        ADD COLUMN probe_label text GENERATED ALWAYS AS (name || '!') STORED;
    `;
    await sourceOwner.query(extra);
    await destination.query(`${extra}
      CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL);
    `);
    await destination.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$`);
    await destination.query(readFileSync(join(process.cwd(), "docs/staging-transition/DEVELOPMENT-SYNC-STORE.sql"), "utf8"));
    await sourceOwner.query(`
      CREATE ROLE itrader_staging_reader LOGIN PASSWORD 'reader' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      ALTER ROLE itrader_staging_reader SET default_transaction_read_only = on;
      GRANT CONNECT ON DATABASE sync_source TO itrader_staging_reader;
      GRANT USAGE ON SCHEMA public, auth TO itrader_staging_reader;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE CREATE ON SCHEMA auth FROM PUBLIC;
    `);
    await sourceOwner.query(`DO $$ DECLARE table_name text; BEGIN
      FOR table_name IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'spatial_ref_sys'
      LOOP
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO itrader_staging_reader', table_name);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('DROP POLICY IF EXISTS itrader_staging_reader_select ON public.%I', table_name);
        EXECUTE format('CREATE POLICY itrader_staging_reader_select ON public.%I FOR SELECT TO itrader_staging_reader USING (true)', table_name);
      END LOOP;
    END $$`);
    await sourceOwner.query(`GRANT SELECT ON TABLE auth.users, auth.identities TO itrader_staging_reader`);
    if (PRIVATE_AUTH) {
      await sourceOwner.query(`ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
        ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;
        GRANT USAGE ON SCHEMA auth TO postgres;
        GRANT SELECT ON auth.users, auth.identities TO postgres;
        GRANT CREATE ON DATABASE sync_source TO postgres;
        REVOKE USAGE ON SCHEMA auth FROM itrader_staging_reader;`);
      exportOwner = connect("sync_source", "postgres");
      await exportOwner.connect();
      await exportOwner.query(authExportProvisioningSql());
    }
    const privileged = await sourceOwner.query<{ name: string }>(`SELECT n.nspname || '.' || p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND has_function_privilege('itrader_staging_reader', p.oid, 'EXECUTE') LIMIT 5`);
    if (privileged.rows.length) throw new Error(`Restricted reader can execute privileged functions: ${privileged.rows.map((row) => row.name).join(", ")}`);
    sourceReader = connect("sync_source", "itrader_staging_reader");
    await sourceReader.connect();
    await expect(sourceReader.query(`INSERT INTO public."Category"(id, name, slug) VALUES ('refused','Refused','refused')`)).rejects.toThrow();
    await settle(sourceReader);
  }, 240_000);

  afterAll(async () => {
    await sourceReader?.end().catch(() => undefined);
    await exportOwner?.end().catch(() => undefined);
    await sourceOwner?.end().catch(() => undefined);
    await destination?.end().catch(() => undefined);
    if (!started) return;
    try { run("pg_ctl", ["-D", DATA, "-m", "fast", "-w", "stop"]); } catch { /* already stopped */ }
    rmSync(DATA, { recursive: true, force: true });
  }, 60_000);

  it("prepares, stores and applies a nonempty merge, then restores the backup", async () => {
    await seedMinimal();
    await insertUser(sourceOwner, "user-update", UPDATE_AUTH, "update@example.com", "New Name", "USER");
    await insertUser(destination, "user-update", UPDATE_AUTH, "update@example.com", "Old Name", "USER");
    await insertUser(destination, "user-dev-only", DEV_AUTH, "devonly@example.com", "Development Only", "USER");
    await insertUser(sourceOwner, "user-0001", IMPORTED_AUTH, "user0001@example.com", "Imported", "USER");
    await sourceOwner.query(`INSERT INTO public."User"(id, "authUserId", email, name, role, "updatedAt")
      SELECT 'user-' || lpad(i::text, 4, '0'), '00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'),
        'user' || lpad(i::text, 4, '0') || '@example.com', 'User ' || i, 'USER'::"UserRole", '2026-10-04 12:00:00'
      FROM generate_series(2, 1999) AS i`);
    await insertAuth(sourceOwner, SOURCE_INSTANCE, UPDATE_AUTH, "update@example.com", "source-secret", "source-token");
    await insertAuth(destination, DEST_INSTANCE, UPDATE_AUTH, "update@example.com", "dest-update-secret", "dest-update-token");
    await insertAuth(sourceOwner, SOURCE_INSTANCE, IMPORTED_AUTH, "user0001@example.com", "source-secret", "source-token");
    await insertAuth(destination, DEST_INSTANCE, DEV_AUTH, "devonly@example.com", "dev-secret", "dev-token");
    await sourceOwner.query(`INSERT INTO public."Region"(id, name, slug, probe_bytea, probe_amount, probe_seen, probe_tags, probe_seq)
      OVERRIDING SYSTEM VALUE VALUES ('region-1','Douglas','douglas', decode('deadbeef','hex'), 123456789.12345678, '2026-10-04 12:00:00+00', ARRAY['isle','man'], 7)`);
    await destination.query(`INSERT INTO auth.sessions(id, user_id) VALUES (gen_random_uuid(), $1::uuid), (gen_random_uuid(), $2::uuid)`, [ADMIN_AUTH, IMPORTED_AUTH]);
    sourceSql = [];
    const prepared = await prepareClone("merge", "admin", env, isolated()) as PlanRow;
    const plan = summaryOf(prepared);
    expect(plan.blockers).toEqual([]);
    expect(plan.counts.User).toEqual({ captured: 2001, insert: 1999, update: 1, delete: 0, preserve: 2, skip: 1 });
    expect(plan.counts.Category).toEqual({ captured: 0, insert: 0, update: 0, delete: 0, preserve: 0, skip: 0 });
    expect(plan.counts.Region).toEqual({ captured: 1, insert: 1, update: 0, delete: 0, preserve: 0, skip: 0 });
    expect(plan.counts["auth.users"]).toMatchObject({ captured: 3, insert: 1, update: 1, delete: 0, preserve: 2, skip: 1 });
    const chunks = await destination.query<{ chunks: string; rows: string }>(
      `SELECT count(*)::text AS chunks, COALESCE(sum(row_count),0)::text AS rows
       FROM staging_admin.database_sync_chunks WHERE run_id=$1 AND purpose='source' AND table_name='User'`,
      [prepared.id],
    );
    expect(Number(chunks.rows[0]?.chunks)).toBeGreaterThanOrEqual(2);
    expect(chunks.rows[0]?.rows).toBe("2001");
    assertSourceSql(sourceSql);

    const applied = await applyClone(prepared.id, "admin", env, isolated()) as PlanRow;
    expect(applied.status).toBe("applied");
    expect(Number(applied.backup_bytes ?? 0)).toBeGreaterThan(0);
    const region = await destination.query<{ label: string; seq: number; bytea: string; amount: boolean; seen: boolean; tags: boolean }>(
      `SELECT probe_label AS label, probe_seq AS seq, encode(probe_bytea,'hex') AS bytea,
        probe_amount = 123456789.12345678::numeric(20,8) AS amount,
        probe_seen = '2026-10-04 12:00:00+00'::timestamptz AS seen,
        probe_tags = ARRAY['isle','man']::text[] AS tags
       FROM public."Region" WHERE id='region-1'`,
    );
    expect(region.rows[0]).toMatchObject({ label: "Douglas!", seq: 7, bytea: "deadbeef", amount: true, seen: true, tags: true });
    const names = await destination.query<{ id: string; name: string }>(`SELECT id, name FROM public."User" WHERE id = ANY($1::text[]) ORDER BY id`, [["admin", "user-update", "user-dev-only", "user-0001"]]);
    expect(names.rows).toEqual([
      { id: "admin", name: "Staging Admin" },
      { id: "user-0001", name: "Imported" },
      { id: "user-dev-only", name: "Development Only" },
      { id: "user-update", name: "New Name" },
    ]);
    expect((await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User"`)).rows[0]?.count).toBe("2002");
    const imported = await destination.query<{ password: string; token: string; banned: boolean; instance: string; confirmed: boolean; secret: boolean }>(
      `SELECT encrypted_password AS password, confirmation_token AS token,
        banned_until = 'infinity'::timestamptz AS banned, instance_id::text AS instance,
        confirmed_at = LEAST(email_confirmed_at, phone_confirmed_at) AS confirmed,
        NOT (identity_data ? 'password') AS secret
       FROM auth.users u JOIN auth.identities i ON i.user_id = u.id WHERE u.id=$1::uuid`,
      [IMPORTED_AUTH],
    );
    expect(imported.rows[0]).toMatchObject({ password: "", token: "", banned: true, instance: DEST_INSTANCE, confirmed: true, secret: true });
    const adminAuth = await destination.query<{ password: string; token: string }>(`SELECT encrypted_password AS password, confirmation_token AS token FROM auth.users WHERE id=$1::uuid`, [ADMIN_AUTH]);
    expect(adminAuth.rows[0]).toEqual({ password: "dest-secret", token: "dest-token" });
    const sessions = await destination.query<{ user_id: string }>(`SELECT user_id::text AS user_id FROM auth.sessions ORDER BY user_id`);
    expect(sessions.rows.map((row) => row.user_id)).toEqual([ADMIN_AUTH]);
    expect((await sourceOwner.query<{ name: string }>(`SELECT name FROM public."User" WHERE id='admin'`)).rows[0]?.name).toBe("Production Admin");
    expect((await sourceOwner.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User"`)).rows[0]?.count).toBe("2001");

    const repeated = await applyClone(prepared.id, "admin", env, isolated()) as PlanRow;
    expect(repeated.status).toBe("applied");
    expect((await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User"`)).rows[0]?.count).toBe("2002");
    sourceSql = [];
    const second = await prepareClone("merge", "admin", env, isolated()) as PlanRow;
    expect(summaryOf(second).counts.User).toMatchObject({ captured: 2001, insert: 0, update: 2000, skip: 1, preserve: 2, delete: 0 });
    assertSourceSql(sourceSql);
    await applyClone(second.id, "admin", env, isolated());
    expect((await destination.query<{ seq: number }>(`SELECT probe_seq AS seq FROM public."Region" WHERE id='region-1'`)).rows[0]?.seq).toBe(7);
    expect((await destination.query<{ name: string }>(`SELECT name FROM public."User" WHERE id='admin'`)).rows[0]?.name).toBe("Staging Admin");
    expect((await sourceOwner.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User"`)).rows[0]?.count).toBe("2001");

    await destination.query(`UPDATE public."User" SET name='Mutated' WHERE id='user-update'`);
    const restored = await restoreClone(prepared.id, "admin", env, isolated()) as PlanRow;
    expect(restored.status).toBe("applied");
    expect((await destination.query<{ name: string }>(`SELECT name FROM public."User" WHERE id='user-update'`)).rows[0]?.name).toBe("Old Name");
    expect((await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User" WHERE id='user-0001'`)).rows[0]?.count).toBe("0");
    expect((await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User"`)).rows[0]?.count).toBe("3");
    expect((await sourceOwner.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User"`)).rows[0]?.count).toBe("2001");
  }, 240_000);

  it("blocks a unique conflict without copying the conflicting development row", async () => {
    await seedMinimal();
    await insertUser(destination, "dest-shared", "55555555-5555-4555-8555-555555555551", "shared@example.com", "Dest", "USER");
    await insertUser(sourceOwner, "source-shared", "55555555-5555-4555-8555-555555555552", "shared@example.com", "Source", "USER");
    const prepared = await prepareClone("merge", "admin", env, isolated()) as PlanRow;
    const blockers = summaryOf(prepared).blockers;
    expect(blockers.some((blocker) => blocker.includes("unique key") && blocker.includes("User"))).toBe(true);
    expect(summaryOf(prepared).blockers.some((blocker) => blocker.includes("administrator"))).toBe(false);
    expect(summaryOf(prepared).blockers.join(" ")).not.toContain("shared@example.com");
    await expect(applyClone(prepared.id, "admin", env, isolated())).rejects.toThrow(/Resolve all preview blockers/);
    expect((await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User" WHERE id='source-shared'`)).rows[0]?.count).toBe("0");
  }, 120_000);

  it("reports missing SELECT and a missing reader policy without changing development data", async () => {
    await seedMinimal();
    const before = (await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User"`)).rows[0]?.count;
    await sourceOwner.query(`REVOKE SELECT ON TABLE public."Category" FROM itrader_staging_reader`);
    try {
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(/Production source role lacks SELECT on public\.Category\. Reference /);
    } finally {
      await settle(sourceReader);
      await sourceOwner.query(`GRANT SELECT ON TABLE public."Category" TO itrader_staging_reader`);
    }
    await sourceOwner.query(`DROP POLICY itrader_staging_reader_select ON public."Category"`);
    try {
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(/Production source role lacks an unconditional reader RLS policy on Category\. Reference /);
    } finally {
      await settle(sourceReader);
      await sourceOwner.query(`CREATE POLICY itrader_staging_reader_select ON public."Category" FOR SELECT TO itrader_staging_reader USING (true)`);
    }
    expect((await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User"`)).rows[0]?.count).toBe(before);
  }, 120_000);

  it("blocks a schema mismatch before copying", async () => {
    await seedMinimal();
    await sourceOwner.query(`ALTER TABLE public."Category" ADD COLUMN merge_probe text`);
    try {
      const prepared = await prepareClone("merge", "admin", env, isolated()) as PlanRow;
      expect(summaryOf(prepared).blockers).toContain("Source and destination schema or migrations differ. Review them before copying.");
      const chunks = await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM staging_admin.database_sync_chunks WHERE run_id=$1`, [prepared.id]);
      expect(chunks.rows[0]?.count).toBe("0");
      await expect(applyClone(prepared.id, "admin", env, isolated())).rejects.toThrow(/Resolve all preview blockers/);
    } finally {
      await sourceOwner.query(`ALTER TABLE public."Category" DROP COLUMN merge_probe`);
    }
  }, 120_000);

  it("rolls back a foreign-key conflict and an injected trigger failure", async () => {
    await seedMinimal();
    await sourceOwner.query(`INSERT INTO public."Region"(id, name, slug) VALUES ('fk-region','FK','fk-region')`);
    await insertUser(sourceOwner, "fk-user", "55555555-5555-4555-8555-555555555553", "fk@example.com", "FK", "USER", "fk-region");
    const prepared = await prepareClone("merge", "admin", env, isolated()) as PlanRow;
    await destination.query(`DELETE FROM staging_admin.database_sync_chunks WHERE run_id=$1 AND table_name='Region'`, [prepared.id]);
    expect(summaryOf(prepared).blockers).toEqual([]);
    await expect(applyClone(prepared.id, "admin", env, isolated())).rejects.toThrow(/User refers to a record that is not available in development/);
    expect((await destination.query<{ status: string }>(`SELECT status FROM staging_admin.database_sync_runs WHERE id=$1`, [prepared.id])).rows[0]?.status).toBe("prepared");
    expect((await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."User" WHERE id='fk-user'`)).rows[0]?.count).toBe("0");

    await resetRows();
    await seedAdmins();
    await sourceOwner.query(`INSERT INTO public."Region"(id, name, slug) VALUES ('boom-region','boom','boom')`);
    await destination.query(`CREATE OR REPLACE FUNCTION public.sync_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name = 'boom' THEN RAISE EXCEPTION 'injected merge failure'; END IF; RETURN NEW; END $$`);
    await destination.query(`CREATE TRIGGER sync_test_fail BEFORE INSERT ON public."Region" FOR EACH ROW EXECUTE FUNCTION public.sync_test_fail()`);
    try {
      const triggered = await prepareClone("merge", "admin", env, isolated()) as PlanRow;
      await expect(applyClone(triggered.id, "admin", env, isolated())).rejects.toThrow(/injected merge failure/);
      expect((await destination.query<{ status: string }>(`SELECT status FROM staging_admin.database_sync_runs WHERE id=$1`, [triggered.id])).rows[0]?.status).toBe("prepared");
      expect((await destination.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."Region" WHERE id='boom-region'`)).rows[0]?.count).toBe("0");
    } finally {
      await destination.query(`DROP TRIGGER IF EXISTS sync_test_fail ON public."Region"`);
      await destination.query(`DROP FUNCTION IF EXISTS public.sync_test_fail()`);
    }
  }, 180_000);

  it.skipIf(PRIVATE_AUTH)("stops inspection and preparation when auth schema USAGE is missing but SELECT remains", async () => {
    await seedMinimal();
    await settle(sourceReader);
    const privileges = () => sourceOwner.query<{
      users_select: boolean;
      identities_select: boolean;
      auth_usage: boolean;
      public_usage: boolean;
    }>(`SELECT
      has_table_privilege('itrader_staging_reader', 'auth.users', 'SELECT') AS users_select,
      has_table_privilege('itrader_staging_reader', 'auth.identities', 'SELECT') AS identities_select,
      has_schema_privilege('itrader_staging_reader', 'auth', 'USAGE') AS auth_usage,
      has_schema_privilege('itrader_staging_reader', 'public', 'USAGE') AS public_usage`);
    expect((await privileges()).rows[0]).toEqual({
      users_select: true,
      identities_select: true,
      auth_usage: true,
      public_usage: true,
    });
    await sourceOwner.query("REVOKE USAGE ON SCHEMA auth FROM itrader_staging_reader");
    try {
      expect((await privileges()).rows[0]).toEqual({
        users_select: true,
        identities_select: true,
        auth_usage: false,
        public_usage: true,
      });
      const readerUrl = `postgresql://itrader_staging_reader:reader@127.0.0.1:${PORT}/sync_source`;
      await expect(inspectConnection(readerUrl, true, env)).rejects.toThrow(
        "Production source role lacks USAGE on schema auth.",
      );
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(
        /Production source role lacks USAGE on schema auth\. Reference /,
      );
    } finally {
      await settle(sourceReader);
      await sourceOwner.query("GRANT USAGE ON SCHEMA auth TO itrader_staging_reader");
    }
    expect((await privileges()).rows[0]?.auth_usage).toBe(true);
    await sourceReader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      await validateSourceClient(sourceReader as unknown as PoolClient, env);
      await sourceReader.query("SELECT * FROM auth.users LIMIT 0");
      await sourceReader.query("SELECT * FROM auth.identities LIMIT 0");
    } finally {
      await settle(sourceReader);
    }
  }, 120_000);

  it.skipIf(!PRIVATE_AUTH)("exports complete masked Auth rows without a superuser creator or reader auth USAGE", async () => {
    await seedMinimal();
    const rights = await sourceOwner.query(`SELECT
      (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') AS creator_superuser,
      has_schema_privilege('postgres','auth','USAGE WITH GRANT OPTION') AS creator_can_grant_auth,
      has_schema_privilege('itrader_staging_reader','auth','USAGE') AS reader_auth_usage,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname='itrader_staging_reader') AS reader_bypass`);
    expect(rights.rows[0]).toEqual({ creator_superuser: false, creator_can_grant_auth: false, reader_auth_usage: false, reader_bypass: false });
    await expect(sourceReader.query("SELECT * FROM auth.users LIMIT 0")).rejects.toMatchObject({ code: "42501" });
    const owners = await sourceOwner.query("SELECT count(*)::text AS count FROM auth.users");
    const exported = await sourceReader.query(`SELECT count(*)::text AS count, bool_and(encrypted_password='' AND confirmation_token='' AND banned_until='infinity'::timestamptz) AS masked FROM ${AUTH_EXPORT_SCHEMA}.auth_users`);
    expect(exported.rows[0]).toEqual({ count: owners.rows[0].count, masked: true });
    const identities = await sourceReader.query(`SELECT identity_data FROM ${AUTH_EXPORT_SCHEMA}.auth_identities`);
    expect(identities.rows).toHaveLength(1);
    expect(identities.rows[0].identity_data).not.toHaveProperty("password");
    const inspected = await inspectConnection(`postgresql://itrader_staging_reader:reader@127.0.0.1:${PORT}/sync_source`, true, env);
    expect(inspected.counts["auth.users"]).toBe(1);
    expect(inspected.counts["auth.identities"]).toBe(1);
  }, 120_000);

  it.skipIf(!PRIVATE_AUTH)("denies view writes even in a read-write transaction and denies API-role access", async () => {
    await seedMinimal();
    for (const sql of [
      `INSERT INTO ${AUTH_EXPORT_SCHEMA}.auth_users(id) VALUES (gen_random_uuid())`,
      `UPDATE ${AUTH_EXPORT_SCHEMA}.auth_users SET email='blocked@example.com'`,
      `DELETE FROM ${AUTH_EXPORT_SCHEMA}.auth_users`,
    ]) {
      await sourceReader.query("BEGIN READ WRITE");
      try { await expect(sourceReader.query(sql)).rejects.toMatchObject({ code: "42501" }); }
      finally { await settle(sourceReader); }
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      await sourceOwner.query("BEGIN READ ONLY");
      try {
        await sourceOwner.query(`SET LOCAL ROLE ${role}`);
        await expect(sourceOwner.query(`SELECT * FROM ${AUTH_EXPORT_SCHEMA}.auth_users LIMIT 0`)).rejects.toMatchObject({ code: "42501" });
      } finally { await settle(sourceOwner); }
    }
    expect((await sourceOwner.query("SELECT count(*)::text AS count FROM auth.users")).rows[0].count).toBe("1");
    await sourceOwner.query(`GRANT SELECT ON ${AUTH_EXPORT_SCHEMA}.auth_users TO authenticated`);
    try {
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(/unsafe or missing private Auth export permissions/);
    } finally { await sourceOwner.query(`REVOKE SELECT ON ${AUTH_EXPORT_SCHEMA}.auth_users FROM authenticated`); }
  }, 120_000);

  it.skipIf(!PRIVATE_AUTH)("blocks missing export-schema access or a missing view without fallback to Auth", async () => {
    await seedMinimal();
    await exportOwner!.query(`REVOKE USAGE ON SCHEMA ${AUTH_EXPORT_SCHEMA} FROM itrader_staging_reader`);
    try {
      await expect(inspectConnection(`postgresql://itrader_staging_reader:reader@127.0.0.1:${PORT}/sync_source`, true, env)).rejects.toThrow(`lacks USAGE on schema ${AUTH_EXPORT_SCHEMA}`);
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(`lacks USAGE on schema ${AUTH_EXPORT_SCHEMA}`);
    } finally { await exportOwner!.query(`GRANT USAGE ON SCHEMA ${AUTH_EXPORT_SCHEMA} TO itrader_staging_reader`); }
    await exportOwner!.query(`ALTER VIEW ${AUTH_EXPORT_SCHEMA}.auth_identities RENAME TO hidden_identities`);
    try {
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(/requires private Auth export view auth_identities/);
    } finally { await exportOwner!.query(`ALTER VIEW ${AUTH_EXPORT_SCHEMA}.hidden_identities RENAME TO auth_identities`); }
    await expect(prepareClone("merge", "admin", { ...env, DATABASE_SYNC_AUTH_SOURCE_MODE: "direct" }, isolated())).rejects.toThrow(/lacks USAGE on schema auth/);
  }, 120_000);

  it.skipIf(!PRIVATE_AUTH)("refuses filtered definitions, RLS-truncated access, and export column drift", async () => {
    await seedMinimal();
    const original = authExportViewSql("users").replace("CREATE VIEW", "CREATE OR REPLACE VIEW");
    const filtered = original.replace('FROM auth."users" AS src;', 'FROM auth."users" AS src WHERE false;');
    await exportOwner!.query(filtered);
    try {
      expect((await sourceReader.query(`SELECT count(*)::text AS count FROM ${AUTH_EXPORT_SCHEMA}.auth_users`)).rows[0].count).toBe("0");
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(/altered or unverified Auth export definition/);
    } finally { await exportOwner!.query(original); }
    await sourceOwner.query("ALTER ROLE postgres NOBYPASSRLS");
    try {
      expect((await sourceReader.query(`SELECT count(*)::text AS count FROM ${AUTH_EXPORT_SCHEMA}.auth_users`)).rows[0].count).toBe("0");
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(/cannot verify complete Auth export access/);
    } finally { await sourceOwner.query("ALTER ROLE postgres BYPASSRLS"); }
    await sourceOwner.query("ALTER TABLE auth.users ADD COLUMN export_drift_probe text");
    try {
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(/Auth export schema drift for users/);
    } finally { await sourceOwner.query("ALTER TABLE auth.users DROP COLUMN export_drift_probe"); }
    expect((await destination.query("SELECT count(*)::text AS count FROM staging_admin.database_sync_runs")).rows[0].count).toBe("0");
    expect((await destination.query("SELECT count(*)::text AS count FROM public.\"User\"")).rows[0].count).toBe("1");
  }, 120_000);

  it.skipIf(PRIVATE_AUTH)("direct Auth access rejects silent RLS filtering despite valid schema and table grants", async () => {
    await seedMinimal();
    await sourceOwner.query("ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY");
    try {
      expect((await sourceReader.query("SELECT count(*)::text AS count FROM auth.users")).rows[0].count).toBe("0");
      await expect(inspectConnection(`postgresql://itrader_staging_reader:reader@127.0.0.1:${PORT}/sync_source`, true, env)).rejects.toThrow(/unconditional reader RLS policy on users/);
      await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(/unconditional reader RLS policy on users/);
    } finally { await sourceOwner.query("ALTER TABLE auth.users DISABLE ROW LEVEL SECURITY"); }
  }, 120_000);


  it("blocks a missing required source table instead of treating it as empty", async () => {
    await seedMinimal();
    const leaf = await sourceOwner.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'
        AND NOT EXISTS (SELECT 1 FROM pg_constraint f WHERE f.confrelid = c.oid)
      ORDER BY c.relname LIMIT 1`);
    const name = leaf.rows[0]?.name;
    if (!name) throw new Error("No leaf table was available for the missing-table regression.");
    await sourceOwner.query(`DROP TABLE public."${name.replaceAll('"', '""')}"`);
    await expect(prepareClone("merge", "admin", env, isolated())).rejects.toThrow(new RegExp(`Required source table public\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is missing`));
  }, 120_000);
});
