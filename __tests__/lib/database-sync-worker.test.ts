import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "@/lib/database-sync/store";
import { hashSchemaLines } from "@/lib/database-sync/fingerprint";
import { applyDatabaseSync, prepareDatabaseSync } from "@/lib/database-sync/worker";
import type { CloneManifest } from "@/lib/database-sync/clone-engine";

const mocks = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn(), release: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({ default: { Pool: class {
  constructor(options: unknown) { mocks.pool(options); }
  async connect() { return { query: mocks.query, release: mocks.release }; }
  end = mocks.end;
} } }));
vi.mock("@/lib/database-sync/preflight", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/database-sync/preflight")>(),
  inspectionPoolOptions: (url: string) => ({ connectionString: url }),
}));

const runId = "00000000-0000-4000-8000-000000000001";
const destination = "postgres://postgres.syneonzucehwlghqmfbg@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production", VERCEL_ENV: "preview", ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev", NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: destination, DATABASE_SYNC_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
};
const manifest = (blockers: string[] = []): CloneManifest => ({
  v: 2, mode: "replace", fingerprint: hashSchemaLines([]), blockers, tables: [], insertOrder: [], deleteOrder: [],
  deferredConstraints: [], nullThenUpdate: [], preservedAdminIds: ["admin"], preservedAuthIds: ["auth-admin"], previewInstanceId: null,
});
let row: Record<string, unknown>;
let locked = true;
let activeActor = true;
let schemaLines: string[] = [];
let failColumns = false;
let failPrepareChecks = false;
function statements() { return mocks.query.mock.calls.map(([sql]) => String(sql)); }
beforeEach(() => {
  vi.clearAllMocks();
  locked = true; activeActor = true; schemaLines = []; failColumns = false; failPrepareChecks = false;
  row = {
    id: runId, actor_id: "admin", mode: "replace", status: "prepared", created_at: new Date(), expires_at: new Date(Date.now() + 60_000),
    summary: { counts: {}, blockers: [] }, encrypted_snapshot: seal(manifest(), runId, env), kind: "sync", backup_bytes: "0",
    backup_expires_at: null, payload_pruned_at: null,
  };
  mocks.query.mockReset().mockImplementation(async (sql: string, parameters?: unknown[]) => {
    if (sql.includes("to_regclass")) return { rows: [{ present: true }], rowCount: 1 };
    if (sql.includes("store_version")) return { rows: [], rowCount: 0 };
    if (sql.includes("pg_try_advisory")) return { rows: [{ locked }], rowCount: 1 };
    if (sql.startsWith("SELECT id FROM") || sql.startsWith("SELECT \"authUserId\"")) return { rows: activeActor ? [{ id: "admin", authUserId: "auth-admin" }] : [], rowCount: activeActor ? 1 : 0 };
    if (sql.includes("SELECT * FROM staging_admin.database_sync_runs")) return { rows: [row], rowCount: 1 };
    if (sql.includes("SELECT line FROM")) return { rows: schemaLines.map((line) => ({ line })), rowCount: schemaLines.length };
    if (failPrepareChecks && sql.includes("FROM pg_constraint f") && sql.includes("child.relname")) throw new Error("simulated prepare failure");
    if (sql.includes("pg_attribute") && sql.includes("nspname=$1")) {
      if (failColumns) throw new Error("simulated SQL failure");
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("count(*)::text") || sql.includes("count(*) FROM staging_admin")) return { rows: [{ count: "0" }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO staging_admin.database_sync_runs")) {
      row.mode = parameters?.[2];
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE staging_admin.database_sync_runs SET encrypted_snapshot")) {
      row.summary = JSON.parse(String(parameters?.[2] ?? "{}"));
      return { rows: [{ ...row, status: "prepared" }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE staging_admin.database_sync_runs SET status='applied'")) {
      row.status = "applied"; row.backup_bytes = parameters?.[1];
      return { rows: [row], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe("database clone transaction boundaries", () => {
  it("prepares Reset without a production connection", async () => {
    const run = await prepareDatabaseSync("reset", "admin", env);
    expect(run.mode).toBe("reset");
    expect(run.status).toBe("prepared");
    expect(mocks.pool).toHaveBeenCalledTimes(1);
    expect(mocks.pool).toHaveBeenCalledWith({ connectionString: destination });
    expect(statements().some((sql) => /^(INSERT|UPDATE|DELETE) .*public\./i.test(sql))).toBe(false);
  });

  it("returns a safe preparation stage when an unexpected preview query fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    failPrepareChecks = true;
    await expect(prepareDatabaseSync("reset", "admin", env)).rejects.toThrow(
      "Plan preparation failed during preview checks. No development data was changed.",
    );
    expect(statements()).toContain("ROLLBACK");
    expect(errorLog).toHaveBeenCalledWith("Database sync prepare stage failed.", { stage: "preview checks" });
    errorLog.mockRestore();
  });

  it.each([
    { VERCEL_ENV: "production" },
    { DATABASE_URL: "postgres://postgres@db.snlqivvogfqesxpbjiei.supabase.co/postgres" },
  ])("rejects production configuration before opening any connection: %j", async (override) => {
    await expect(applyDatabaseSync(runId, "admin", { ...env, ...override, POSTGRES_URL: undefined, POSTGRES_URL_NON_POOLING: undefined })).rejects.toThrow(/verified staging|could not be verified/);
    expect(mocks.pool).not.toHaveBeenCalled();
  });

  it("converts a verified preview transaction pooler to session mode", async () => {
    await expect(applyDatabaseSync(runId, "admin", {
      ...env,
      DATABASE_URL: "postgres://postgres.syneonzucehwlghqmfbg@aws-1-eu-west-2.pooler.supabase.com:6543/postgres",
    })).resolves.toHaveProperty("status", "applied");
    expect(mocks.pool).toHaveBeenCalledWith({
      connectionString: "postgres://postgres.syneonzucehwlghqmfbg@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
    });
  });

  it.each(["actor", "disabled", "expired", "blocked", "locked"])("rejects %s preview without mutations", async (scenario) => {
    if (scenario === "actor") row.actor_id = "other-admin";
    if (scenario === "disabled") activeActor = false;
    if (scenario === "expired") row.expires_at = new Date(0);
    if (scenario === "blocked") row.encrypted_snapshot = seal(manifest(["dependency"]), runId, env);
    if (scenario === "locked") locked = false;
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow();
    expect(statements().some((sql) => /^(INSERT|UPDATE|DELETE) /i.test(sql) && !sql.includes("staging_admin"))).toBe(false);
    expect(statements()).toContain("ROLLBACK");
  });

  it("locks tables and rechecks the administrator before schema drift rolls back", async () => {
    schemaLines = ["column|public|Listing|featured|boolean|true|0|"];
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow("Schema changed");
    const sql = statements();
    const lockAt = sql.findIndex((statement) => statement.startsWith("LOCK TABLE"));
    const adminChecks = sql.map((statement, index) => statement.startsWith("SELECT id FROM") ? index : -1).filter((index) => index >= 0);
    expect(lockAt).toBeGreaterThan(adminChecks[0]);
    expect(adminChecks[1]).toBeGreaterThan(lockAt);
    expect(sql.some((statement) => statement.includes("statement_timeout='240s'"))).toBe(true);
    expect(sql).toContain("ROLLBACK");
    expect(sql.some((statement) => statement.startsWith("INSERT INTO public."))).toBe(false);
  });

  it("rolls back a later failure without marking the plan applied", async () => {
    failColumns = true;
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow("simulated SQL failure");
    expect(statements()).toContain("ROLLBACK");
    expect(statements().filter((sql) => sql === "COMMIT")).toHaveLength(1);
    expect(statements().some((sql) => sql.startsWith("UPDATE staging_admin.database_sync_runs SET status='applied'"))).toBe(false);
  });
});
