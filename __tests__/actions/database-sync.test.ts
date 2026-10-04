import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STAGING_ORIGIN } from "@/lib/deployment/staging-origin";
import { SYNC_TABLES } from "@/lib/database-sync/types";

const { requireRoleMock, stagingEnabledMock, inspectMock, prepareMock, applyMock, restoreMock, listMock, headersMock, SyncError } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  stagingEnabledMock: vi.fn(),
  inspectMock: vi.fn(),
  prepareMock: vi.fn(), applyMock: vi.fn(), restoreMock: vi.fn(), listMock: vi.fn(), headersMock: vi.fn(),
  SyncError: class extends Error {},
}));

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/deployment/environment", () => ({ isStagingOnlyFeatureEnabled: stagingEnabledMock }));
vi.mock("@/lib/database-sync/preflight", () => ({ inspectDatabaseSync: inspectMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("@/lib/database-sync/worker", () => ({ prepareDatabaseSync: prepareMock, applyDatabaseSync: applyMock, restoreDatabaseSync: restoreMock, listDatabaseSyncRuns: listMock, DatabaseSyncError: SyncError }));

const { loadDatabaseSyncPreflight, loadDatabaseSyncRuns, prepareDatabaseSyncAction, applyDatabaseSyncAction, restoreDatabaseSyncAction } = await import("@/actions/admin/database-sync");

const run = {
  id: "c3c64ad4-1d3e-4aeb-a02a-39a2c6c45a67", mode: "merge", status: "prepared",
  createdAt: "2026-10-03T12:00:00Z", expiresAt: "2026-10-03T12:15:00Z",
  counts: Object.fromEntries(SYNC_TABLES.map((table) => [table, { insert: 1, update: 0, delete: 0, preserve: 2, skip: 0 }])),
  blockers: [], postHash: "private-hash", backup: { email: "private@example.invalid" },
  archivedListings: 0, archivedDealers: 0,
  kind: "sync", restoreAvailable: true, backupExpiresAt: null, backupState: "newest", restoredFromId: null,
};

describe("database inspection action", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    stagingEnabledMock.mockReturnValue(true);
    inspectMock.mockResolvedValue({ ready: false, blockers: ["source missing"] });
    headersMock.mockResolvedValue(new Headers({ origin: STAGING_ORIGIN }));
    process.env.VERCEL_ENV = "preview";
    prepareMock.mockResolvedValue(run);
    listMock.mockResolvedValue([run]);
    applyMock.mockResolvedValue({ ...run, status: "applied" });
  });

  it("authenticates before opening either connection", async () => {
    requireRoleMock.mockRejectedValueOnce(new Error("Insufficient permissions"));
    await expect(loadDatabaseSyncPreflight()).rejects.toThrow("Insufficient permissions");
    expect(inspectMock).not.toHaveBeenCalled();
  });

  it("denies production and other non-staging deployments", async () => {
    stagingEnabledMock.mockReturnValue(false);
    await expect(loadDatabaseSyncPreflight()).resolves.toEqual({ error: "Database inspection is available only on the staging deployment." });
    expect(inspectMock).not.toHaveBeenCalled();
  });

  it("returns only inspection data to staging admins", async () => {
    await expect(loadDatabaseSyncPreflight()).resolves.toEqual({ data: { ready: false, blockers: ["source missing"] } });
    expect(inspectMock).toHaveBeenCalledOnce();
  });

  it("authenticates every mutation before calling the worker", async () => {
    requireRoleMock.mockRejectedValue(new Error("Insufficient permissions"));
    await expect(prepareDatabaseSyncAction("merge")).rejects.toThrow();
    await expect(applyDatabaseSyncAction({ runId: run.id, confirmation: "MERGE INTO DEVELOPMENT" })).rejects.toThrow();
    expect(prepareMock).not.toHaveBeenCalled(); expect(applyMock).not.toHaveBeenCalled();
  });

  it("blocks preparation, application and history outside staging", async () => {
    stagingEnabledMock.mockReturnValue(false);
    expect(await prepareDatabaseSyncAction("merge")).toHaveProperty("error");
    expect(await applyDatabaseSyncAction({ runId: run.id, confirmation: "MERGE INTO DEVELOPMENT" })).toHaveProperty("error");
    expect(await loadDatabaseSyncRuns()).toHaveProperty("error");
    expect(prepareMock).not.toHaveBeenCalled(); expect(applyMock).not.toHaveBeenCalled(); expect(listMock).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://itrader.im", "https://staging.itrader.im", "https://itrader.dev.evil.example", "https://itrader.dev/"])("rejects mutation Origin %s", async (origin) => {
    headersMock.mockResolvedValue(new Headers(origin ? { origin } : {}));
    expect(await prepareDatabaseSyncAction("merge")).toHaveProperty("error");
    expect(await applyDatabaseSyncAction({ runId: run.id, confirmation: "MERGE INTO DEVELOPMENT" })).toHaveProperty("error");
    expect(prepareMock).not.toHaveBeenCalled(); expect(applyMock).not.toHaveBeenCalled();
  });

  it("rejects invalid mode, UUID and mismatched confirmation", async () => {
    expect(await prepareDatabaseSyncAction("drop production")).toHaveProperty("error");
    expect(await applyDatabaseSyncAction({ runId: "bad", confirmation: "MERGE INTO DEVELOPMENT" })).toHaveProperty("error");
    expect(await applyDatabaseSyncAction({ runId: run.id, confirmation: "REPLACE DEVELOPMENT" })).toHaveProperty("error");
    expect(prepareMock).not.toHaveBeenCalled(); expect(applyMock).not.toHaveBeenCalled();
  });

  it("allows only the configured local development origin with explicit opt-in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ITRADER_LOCAL_STAGING_FEATURES", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    headersMock.mockResolvedValue(new Headers({ origin: "http://localhost:3001" }));
    expect(await prepareDatabaseSyncAction("merge")).toHaveProperty("error");
    expect(prepareMock).not.toHaveBeenCalled();
    headersMock.mockResolvedValue(new Headers({ origin: "http://localhost:3000" }));
    expect(await prepareDatabaseSyncAction("merge")).toHaveProperty("data");
    vi.stubEnv("ITRADER_LOCAL_STAGING_FEATURES", "0");
    expect(await prepareDatabaseSyncAction("merge")).toHaveProperty("error");
    expect(prepareMock).toHaveBeenCalledOnce();
  });

  it("passes the authenticated administrator and strips internal worker data", async () => {
    const prepared = await prepareDatabaseSyncAction("merge");
    expect(prepareMock).toHaveBeenCalledWith("merge", "admin-1");
    expect(JSON.stringify(prepared)).not.toContain("private");
    const applied = await applyDatabaseSyncAction({ runId: run.id, confirmation: "MERGE INTO DEVELOPMENT" });
    expect(applyMock).toHaveBeenCalledWith(run.id, "admin-1");
    expect(applied).toHaveProperty("data.status", "applied");
    expect(JSON.stringify(await loadDatabaseSyncRuns())).not.toContain("private");
  });

  it("uses the stored Reset mode for destructive confirmation", async () => {
    listMock.mockResolvedValue([{ ...run, mode: "reset" }]);
    expect(await applyDatabaseSyncAction({ runId: run.id, confirmation: "REPLACE DEVELOPMENT" })).toHaveProperty("error");
    expect(applyMock).not.toHaveBeenCalled();
    await applyDatabaseSyncAction({ runId: run.id, confirmation: "RESET DEVELOPMENT" });
    expect(applyMock).toHaveBeenCalledOnce();
  });

  it("does not return SQL details from worker failures", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    prepareMock.mockRejectedValue(new Error("postgres://credential SELECT secret FROM User"));
    const result = await prepareDatabaseSyncAction("replace");
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).not.toMatch(/credential|SELECT|postgres/);
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/credential|SELECT|postgres/);
    expect(errorLog).toHaveBeenCalledWith("Database sync operation failed.", {
      operation: "prepare",
    });
    errorLog.mockRestore();
  });

  it("does not inspect untrusted error metadata", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hostile = {};
    Object.defineProperties(hostile, {
      name: { get: () => { throw new Error("secret name"); } },
      code: { get: () => { throw new Error("secret code"); } },
    });
    prepareMock.mockRejectedValue(hostile);

    await expect(prepareDatabaseSyncAction("merge")).resolves.toHaveProperty("error");
    expect(errorLog).toHaveBeenCalledWith("Database sync operation failed.", { operation: "prepare" });
    errorLog.mockRestore();
  });

  it("shows deliberately safe worker errors", async () => {
    prepareMock.mockRejectedValue(new SyncError("Prepare a new preview."));
    expect(await prepareDatabaseSyncAction("replace")).toEqual({ error: "Prepare a new preview." });
  });

  it("lets any active administrator restore a retained backup after exact confirmation", async () => {
    restoreMock.mockResolvedValue({ ...run, kind: "restore", status: "applied" });
    expect(await restoreDatabaseSyncAction({ runId: run.id, confirmation: "restore development" })).toHaveProperty("error");
    expect(restoreMock).not.toHaveBeenCalled();
    const restored = await restoreDatabaseSyncAction({ runId: run.id, confirmation: "RESTORE DEVELOPMENT" });
    expect(restoreMock).toHaveBeenCalledWith(run.id, "admin-1");
    expect(restored).toHaveProperty("data.kind", "restore");
    expect(JSON.stringify(restored)).not.toContain("private");
  });
});
