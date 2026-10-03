import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, stagingEnabledMock, inspectMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  stagingEnabledMock: vi.fn(),
  inspectMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/deployment/environment", () => ({ isStagingOnlyFeatureEnabled: stagingEnabledMock }));
vi.mock("@/lib/database-sync/preflight", () => ({ inspectDatabaseSync: inspectMock }));

const { loadDatabaseSyncPreflight } = await import("@/actions/admin/database-sync");

describe("database inspection action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    stagingEnabledMock.mockReturnValue(true);
    inspectMock.mockResolvedValue({ ready: false, blockers: ["source missing"] });
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
});
