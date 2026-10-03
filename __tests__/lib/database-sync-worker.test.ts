import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_TABLES, type SyncDataset, type DatabaseSyncPlan } from "@/lib/database-sync/types";
import { seal } from "@/lib/database-sync/store";
import { stableHash } from "@/lib/database-sync/snapshot";
import { applyDatabaseSync, prepareDatabaseSync } from "@/lib/database-sync/worker";

const mocks = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn(), release: vi.fn(), end: vi.fn(), readDataset: vi.fn(), readProtection: vi.fn(), blocked: vi.fn() }));
vi.mock("pg", () => ({ default: { Pool: class {
  constructor(options: unknown) { mocks.pool(options); }
  async connect() { return { query: mocks.query, release: mocks.release }; }
  end = mocks.end;
} } }));
vi.mock("@/lib/database-sync/preflight", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/database-sync/preflight")>(),
  inspectionPoolOptions: (url: string) => ({ connectionString: url }),
  inspectClient: vi.fn().mockResolvedValue({ tables: [], migrations: [] }),
}));
vi.mock("@/lib/database-sync/snapshot", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/database-sync/snapshot")>(),
  readDataset: mocks.readDataset, readProtection: mocks.readProtection, findBlockedDeletes: mocks.blocked,
}));
const runId = "00000000-0000-4000-8000-000000000001";
const destination = "postgres://postgres.syneonzucehwlghqmfbg@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production", VERCEL_ENV: "preview", ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://staging.itrader.im", NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: destination, DATABASE_SYNC_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
};
const emptyData = () => Object.fromEntries(SYNC_TABLES.map((table) => [table, []])) as unknown as SyncDataset;
const protection = { rows: { DealerPreviewPack: [{ id: "protected-pack" }], SiteSetting: [{ key: "checklist", value: "keep" }] }, protected: {} };
let plan: DatabaseSyncPlan;
let row: Record<string, unknown>;
let locked: boolean;
let activeActor: boolean;
let failInsert: boolean;
function reseal(backup = emptyData(), visibility?: { archivedListingIds: string[]; archivedDealerIds: string[]; visibleDealerIds: string[] }) {
  row.encrypted_snapshot = seal({ plan, backup, protection, destinationHash: stableHash({ backup, protection }), sourceCapturedAt: new Date().toISOString(), visibility }, runId, env);
}
function statements() { return mocks.query.mock.calls.map(([sql]) => String(sql)); }
function expectNoMutation() {
  expect(statements().some((sql) => /^(INSERT|UPDATE|DELETE) /i.test(sql))).toBe(false);
  expect(statements()).toContain("ROLLBACK");
}
beforeEach(() => {
  vi.clearAllMocks(); locked = true; activeActor = true; failInsert = false;
  plan = { mode: "replace", operations: [], counts: Object.fromEntries(SYNC_TABLES.map((table) => [table, { insert: 0, update: 0, delete: 0, preserve: 0, skip: 0 }])) as DatabaseSyncPlan["counts"], blockers: [], sourceHash: "source", destinationHash: "dest", archivedListingIds: [], archivedDealerProfileIds: [], mappedDealerIds: {}, mappedListingIds: {} };
  row = { id: runId, actor_id: "admin", mode: "replace", status: "prepared", created_at: new Date(), expires_at: new Date(Date.now()+60_000), summary: { counts: plan.counts, blockers: [] } };
  reseal();
  mocks.readDataset.mockReset().mockResolvedValue(emptyData());
  mocks.readProtection.mockReset().mockResolvedValue(protection);
  mocks.blocked.mockReset().mockResolvedValue([]);
  mocks.query.mockReset().mockImplementation(async (sql: string, parameters?: unknown[]) => {
    if (sql.startsWith("SELECT count(*) FROM staging_admin")) return { rows: [{ count: "0" }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO staging_admin")) {
      row.id = parameters?.[0]; row.mode = parameters?.[2]; row.encrypted_snapshot = parameters?.[3]; row.summary = JSON.parse(String(parameters?.[4]));
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("to_regclass")) return { rows: [{ present: true }], rowCount: 1 };
    if (sql.includes("pg_try_advisory")) return { rows: [{ locked }], rowCount: 1 };
    if (sql.startsWith("SELECT id FROM")) return { rows: activeActor ? [{ id: "admin" }] : [], rowCount: activeActor ? 1 : 0 };
    if (sql.startsWith("SELECT * FROM staging_admin")) return { rows: [row], rowCount: 1 };
    if (sql.startsWith("INSERT INTO public.") && failInsert) throw new Error("simulated SQL failure");
    if (sql.startsWith("UPDATE staging_admin")) { row.status = "applied"; return { rows: [row], rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  });
});
describe("database sync apply transaction boundaries", () => {
  it("prepares Reset without a production connection and archives referenced ordinary records", async () => {
    const backup = emptyData();
    backup.Listing = [{ id: "ordinary-listing", userId: "ordinary-user", dealerId: null, status: "LIVE", previewPackId: null }];
    mocks.readDataset.mockResolvedValue(backup);
    mocks.blocked.mockResolvedValueOnce([{ table: "Listing", id: "ordinary-listing", references: ["public.Payment"] }]).mockResolvedValue([]);
    const run = await prepareDatabaseSync("reset", "admin", env);
    expect(run.mode).toBe("reset"); expect(run.status).toBe("prepared");
    expect(run.archivedListings).toBe(1); expect(run.counts.Listing.update).toBe(1);
    expect(run.blockers).toEqual([]);
    expect(mocks.pool).toHaveBeenCalledTimes(1);
    expect(mocks.pool).toHaveBeenCalledWith({ connectionString: destination });
    expect(statements().some((sql) => /^(INSERT|UPDATE|DELETE) .*public\./i.test(sql))).toBe(false);
  });
  it("archives a parent discovered only after its child is retained for history", async () => {
    const backup = emptyData();
    backup.DealerProfile = [{ id: "ordinary-dealer", userId: "ordinary-user", isAdminPreview: false }];
    backup.Listing = [{ id: "ordinary-listing", userId: "ordinary-user", dealerId: "ordinary-dealer", status: "LIVE", previewPackId: null }];
    mocks.readDataset.mockResolvedValue(backup);
    mocks.blocked.mockResolvedValueOnce([{ table: "Listing", id: "ordinary-listing", references: ["public.ListingStatusEvent"] }])
      .mockResolvedValueOnce([{ table: "DealerProfile", id: "ordinary-dealer", references: ["public.Listing"] }]).mockResolvedValue([]);
    const run = await prepareDatabaseSync("reset", "admin", env);
    expect(run.blockers).toEqual([]);
    expect(run.archivedListings).toBe(1);
    expect(run.archivedDealers).toBe(1);
    expect(run.counts.DealerProfile.delete).toBe(0);
    expect(mocks.blocked).toHaveBeenCalledTimes(3);
  });
  it.each([
    { VERCEL_ENV: "production" },
    { DATABASE_URL: "postgres://postgres@db.snlqivvogfqesxpbjiei.supabase.co/postgres" },
    { POSTGRES_URL: "postgres://postgres@db.snlqivvogfqesxpbjiei.supabase.co/postgres" },
  ])("rejects production configuration before opening any connection: %j", async (override) => {
    await expect(applyDatabaseSync(runId, "admin", { ...env, ...override })).rejects.toThrow("verified staging");
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it.each(["actor", "disabled", "expired", "blocked", "locked"])("rejects %s preview without mutations", async (scenario) => {
    if (scenario === "actor") row.actor_id = "other-admin";
    if (scenario === "disabled") activeActor = false;
    if (scenario === "expired") row.expires_at = new Date(0);
    if (scenario === "blocked") { plan.blockers.push("dependency"); reseal(); }
    if (scenario === "locked") locked = false;
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow();
    expectNoMutation();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("detects data drift after preview and rolls back before a marketplace write", async () => {
    const drifted = emptyData(); drifted.Listing = [{ id: "new-listing" }];
    mocks.readDataset.mockResolvedValue(drifted);
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow("Development changed");
    expectNoMutation();
  });
  it("rejects newly referenced deletion targets before executing the frozen plan", async () => {
    mocks.blocked.mockResolvedValue([{ table: "Listing", id: "listing", references: ["public.Payment"] }]);
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow("now reference rows");
    expectNoMutation();
  });
  it("checks actual copied rows before recording success", async () => {
    plan.operations.push({ action: "insert", table: "ContentPage", key: "new-page", after: { id: "new-page", slug: "expected-slug" } }); reseal();
    const after = emptyData(); after.ContentPage = [{ id: "new-page", slug: "unexpected-slug" }];
    mocks.readDataset.mockResolvedValueOnce(emptyData()).mockResolvedValueOnce(after);
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow("Copied row verification failed");
    expect(statements()).toContain("ROLLBACK");
    expect(statements().some((sql) => sql.startsWith("UPDATE staging_admin"))).toBe(false);
  });
  it("rolls back an operation failure without marking the plan applied", async () => {
    plan.operations.push({ action: "insert", table: "ContentPage", key: "new-page", after: { id: "new-page", slug: "new-page" } }); reseal(); failInsert = true;
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow("simulated SQL failure");
    expect(statements()).toContain("ROLLBACK");
    expect(statements()).not.toContain("COMMIT");
    expect(statements().some((sql) => sql.startsWith("UPDATE staging_admin"))).toBe(false);
  });
  it("rolls back if the protected checklist or preview-pack snapshot changes", async () => {
    mocks.readProtection.mockResolvedValueOnce(protection).mockResolvedValueOnce({ ...protection, rows: { SiteSetting: [] } });
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow("Protected development records changed");
    expectNoMutation();
  });
  it("permits exactly the reviewed archive registry change without changing checklist data", async () => {
    const visibility = { archivedListingIds: ["archived-listing"], archivedDealerIds: ["archived-dealer"], visibleDealerIds: ["copied-dealer"] };
    reseal(emptyData(), visibility);
    const afterProtection = { ...protection, rows: { ...protection.rows, SiteSetting: [...protection.rows.SiteSetting,
      { key: "database_sync_marketplace_visibility", value: visibility }] } };
    mocks.readProtection.mockResolvedValueOnce(protection).mockResolvedValueOnce(afterProtection);
    expect((await applyDatabaseSync(runId, "admin", env)).status).toBe("applied");
    const insert = mocks.query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO public."SiteSetting"'));
    expect(insert?.[1]).toEqual(["database_sync_marketplace_visibility", JSON.stringify(visibility)]);
    expect(statements()).toContain("COMMIT");
  });
  it("rolls back if the stored archive registry differs from the reviewed visibility", async () => {
    reseal(emptyData(), { archivedListingIds: ["archived-listing"], archivedDealerIds: [], visibleDealerIds: [] });
    await expect(applyDatabaseSync(runId, "admin", env)).rejects.toThrow("Archive visibility verification failed");
    expect(statements()).toContain("ROLLBACK");
    expect(statements().some((sql) => sql.startsWith("UPDATE staging_admin"))).toBe(false);
  });
  it("commits an unchanged protected snapshot and makes replay a no-op", async () => {
    expect((await applyDatabaseSync(runId, "admin", env)).status).toBe("applied");
    expect(mocks.pool).toHaveBeenCalledWith({ connectionString: destination });
    const reads = mocks.readDataset.mock.calls.length;
    expect((await applyDatabaseSync(runId, "admin", env)).status).toBe("applied");
    expect(mocks.readDataset).toHaveBeenCalledTimes(reads);
    expect(statements().filter((sql) => sql.startsWith("UPDATE staging_admin"))).toHaveLength(1);
    expect(statements().filter((sql) => sql === "COMMIT")).toHaveLength(2);
  });
});
