import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAGING_ORIGIN } from "@/lib/deployment/staging-origin";

const { requireRoleMock, stagingMock, headersMock, refreshMock, readStatusMock, publicErrorMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(), stagingMock: vi.fn(), headersMock: vi.fn(),
  refreshMock: vi.fn(), readStatusMock: vi.fn(), publicErrorMock: vi.fn(() => "safe error"),
}));

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/deployment/environment", () => ({ isStagingOnlyFeatureEnabled: stagingMock, isStagingDeployment: stagingMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/preview-mirror/engine", () => ({ refreshPreviewMirror: refreshMock, readMirrorStatus: readStatusMock }));
vi.mock("@/lib/preview-mirror/error", () => ({ publicMirrorError: publicErrorMock }));

const { loadPreviewMirrorStatus, refreshPreviewMirrorAction } = await import("@/actions/admin/preview-mirror");

describe("preview mirror actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "preview");
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    stagingMock.mockReturnValue(true);
    headersMock.mockResolvedValue(new Headers({ origin: STAGING_ORIGIN }));
    readStatusMock.mockResolvedValue({ lastSuccessAt: null, nextAutomaticAt: null, lastError: null });
    refreshMock.mockResolvedValue({ status: "applied", copiedTables: 8, copiedRows: 30 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires an admin before reading status", async () => {
    requireRoleMock.mockRejectedValueOnce(new Error("Denied"));
    await expect(loadPreviewMirrorStatus()).rejects.toThrow("Denied");
    expect(readStatusMock).not.toHaveBeenCalled();
  });

  it("blocks status and refresh outside verified staging", async () => {
    stagingMock.mockReturnValue(false);
    expect(await loadPreviewMirrorStatus()).toHaveProperty("error");
    expect(await refreshPreviewMirrorAction()).toHaveProperty("error");
    expect(readStatusMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it.each([null, "https://itrader.im", "https://itrader.dev.evil.example", "https://itrader.dev/"])("rejects manual origin %s", async (origin) => {
    headersMock.mockResolvedValue(new Headers(origin ? { origin } : {}));
    expect(await refreshPreviewMirrorAction()).toHaveProperty("error");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("uses the verified admin identity and manual trigger", async () => {
    await expect(refreshPreviewMirrorAction()).resolves.toHaveProperty("data.status", "applied");
    expect(refreshMock).toHaveBeenCalledWith({ trigger: "manual", actorId: "admin-1" });
  });

  it("returns only safe errors", async () => {
    refreshMock.mockRejectedValue(new Error("private source detail"));
    const result = await refreshPreviewMirrorAction();
    expect(result).toEqual({ error: "safe error" });
    expect(publicErrorMock).toHaveBeenCalledOnce();
  });
});
