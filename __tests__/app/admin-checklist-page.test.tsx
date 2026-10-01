import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, loadChecklistMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  loadChecklistMock: vi.fn(),
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

import AdminChecklistPage from "@/app/(admin)/admin/checklist/page";

describe("admin checklist page feature gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_CHECKLIST_ENABLED = "0";
  });

  it("redirects before loading the checklist when disabled", async () => {
    await expect(AdminChecklistPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(loadChecklistMock).not.toHaveBeenCalled();
  });

  it("loads normally when explicitly enabled", async () => {
    process.env.ADMIN_CHECKLIST_ENABLED = "1";
    loadChecklistMock.mockResolvedValue({ error: "Unavailable" });

    const page = await AdminChecklistPage();

    expect(loadChecklistMock).toHaveBeenCalledOnce();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(page).toBeDefined();
  });
});
