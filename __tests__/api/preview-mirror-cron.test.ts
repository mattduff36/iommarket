import { beforeEach, describe, expect, it, vi } from "vitest";

const { stagingMock, authorizeMock, refreshMock, publicErrorMock } = vi.hoisted(() => ({
  stagingMock: vi.fn(), authorizeMock: vi.fn(), refreshMock: vi.fn(),
  publicErrorMock: vi.fn(() => "safe failure"),
}));

vi.mock("@/lib/deployment/environment", () => ({ isStagingDeployment: stagingMock }));
vi.mock("@/lib/preview-mirror/guards", () => ({ authorizeScheduledRequest: authorizeMock }));
vi.mock("@/lib/preview-mirror/engine", () => ({ refreshPreviewMirror: refreshMock }));
vi.mock("@/lib/preview-mirror/error", () => ({ publicMirrorError: publicErrorMock }));

const { POST } = await import("@/app/api/cron/preview-mirror/route");

describe("preview mirror cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stagingMock.mockReturnValue(true);
    authorizeMock.mockReturnValue(true);
    refreshMock.mockResolvedValue({ status: "applied", copiedRows: 3 });
  });

  it("rejects non-staging deployments before checking authorization", async () => {
    stagingMock.mockReturnValue(false);
    const response = await POST(new Request("https://itrader.dev/api/cron/preview-mirror", { method: "POST" }));
    expect(response.status).toBe(404);
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("requires the cron bearer secret before running", async () => {
    authorizeMock.mockReturnValue(false);
    const response = await POST(new Request("https://itrader.dev/api/cron/preview-mirror", { method: "POST", headers: { "x-preview-mirror-signature": "wrong", "x-preview-mirror-timestamp": "1760000000000" }, body: JSON.stringify({ trigger: "manual" }) }));
    expect(response.status).toBe(401);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("always uses the automatic trigger, ignoring request body", async () => {
    const response = await POST(new Request("https://itrader.dev/api/cron/preview-mirror", { method: "POST", headers: { "x-preview-mirror-signature": "sig", "x-preview-mirror-timestamp": "1760000000000" }, body: JSON.stringify({ trigger: "manual", actorId: "attacker" }) }));
    expect(response.status).toBe(200);
    expect(authorizeMock).toHaveBeenCalledWith("sig", "1760000000000", process.env.PREVIEW_MIRROR_CRON_SECRET);
    expect(refreshMock).toHaveBeenCalledWith({ trigger: "automatic" });
  });
});
