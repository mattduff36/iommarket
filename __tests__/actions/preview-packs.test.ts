import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  materializePreviewPackMock,
  setPreviewPackEnabledMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  materializePreviewPackMock: vi.fn(),
  setPreviewPackEnabledMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/preview-packs/materialize", () => ({
  materializePreviewPack: materializePreviewPackMock,
  setPreviewPackEnabled: setPreviewPackEnabledMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { disablePreviewPack, enablePreviewPack } = await import(
  "@/actions/admin/preview-packs"
);

describe("preview pack admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    materializePreviewPackMock.mockResolvedValue({ created: 3, skipped: 0, packId: "pack-1" });
    setPreviewPackEnabledMock.mockResolvedValue({ enabled: false });
  });

  it("refuses Ocean keys before materialize", async () => {
    await expect(enablePreviewPack({ dealerKey: "ocean-motor-village" })).resolves.toEqual({
      error: "Ocean Motor Village is excluded from preview packs.",
    });
    expect(materializePreviewPackMock).not.toHaveBeenCalled();
  });

  it("enables an eligible pack and can hide it again", async () => {
    await expect(enablePreviewPack({ dealerKey: "athol-garage" })).resolves.toEqual({
      data: { created: 3, skipped: 0, packId: "pack-1" },
    });
    expect(materializePreviewPackMock).toHaveBeenCalledWith("athol-garage");

    await expect(disablePreviewPack({ dealerKey: "athol-garage" })).resolves.toEqual({
      data: { enabled: false },
    });
    expect(setPreviewPackEnabledMock).toHaveBeenCalledWith("athol-garage", false);
  });
});
