import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, loadChecklistMock, stagingFeatureEnabledMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  loadChecklistMock: vi.fn(),
  stagingFeatureEnabledMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("@/actions/admin/checklist", () => ({
  loadChecklist: loadChecklistMock,
}));

vi.mock("@/lib/deployment/environment", () => ({
  isStagingOnlyFeatureEnabled: stagingFeatureEnabledMock,
}));

import AdminChecklistPage from "@/app/(admin)/admin/checklist/page";

describe("admin checklist page feature gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stagingFeatureEnabledMock.mockReturnValue(false);
  });

  it("redirects before loading the checklist when disabled", async () => {
    await expect(AdminChecklistPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(loadChecklistMock).not.toHaveBeenCalled();
  });

  it("loads normally when staging features are enabled", async () => {
    stagingFeatureEnabledMock.mockReturnValue(true);
    loadChecklistMock.mockResolvedValue({ error: "Unavailable" });

    const page = await AdminChecklistPage();

    expect(loadChecklistMock).toHaveBeenCalledOnce();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(page).toBeDefined();
  });
});
