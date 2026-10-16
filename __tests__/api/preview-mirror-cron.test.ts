import { beforeEach, describe, expect, it, vi } from "vitest";

const { stagingMock, authorizeMock, refreshMock } = vi.hoisted(() => ({
  stagingMock: vi.fn(), authorizeMock: vi.fn(), refreshMock: vi.fn(),
}));

vi.mock("@/lib/deployment/environment", () => ({ isStagingDeployment: stagingMock }));
vi.mock("@/lib/preview-mirror/guards", () => ({ authorizeScheduledRequest: authorizeMock }));
vi.mock("@/lib/preview-mirror/engine", () => ({ refreshPreviewMirror: refreshMock }));

const { POST } = await import("@/app/api/cron/preview-mirror/route");

describe("preview mirror cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stagingMock.mockReturnValue(true);
    authorizeMock.mockReturnValue(true);
    refreshMock.mockResolvedValue({ status: "applied", copiedRows: 3 });
  });

  it("rejects non-staging deployments without invoking the engine", async () => {
    stagingMock.mockReturnValue(false);
    const response = await POST();
    expect(response.status).toBe(404);
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("returns 410 on staging and never dispatches an automatic or forged manual refresh", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "Automatic preview refresh is retired." });
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
