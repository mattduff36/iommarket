import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  materializePreviewPackMock,
  setPreviewPackEnabledMock,
  previewPackExistsMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  materializePreviewPackMock: vi.fn(),
  setPreviewPackEnabledMock: vi.fn(),
  previewPackExistsMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/preview-packs/materialize", () => ({
  materializePreviewPack: materializePreviewPackMock,
  setPreviewPackEnabled: setPreviewPackEnabledMock,
  previewPackExists: previewPackExistsMock,
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
    previewPackExistsMock.mockResolvedValue(false);
    materializePreviewPackMock.mockResolvedValue({ created: 3, skipped: 0, packId: "pack-1" });
    setPreviewPackEnabledMock.mockResolvedValue({ enabled: false });
  });

  it("refuses Ocean keys before materialize", async () => {
    await expect(enablePreviewPack({ dealerKey: "ocean-motor-village" })).resolves.toEqual({
      error: "Ocean Motor Village is excluded from preview packs.",
    });
    expect(materializePreviewPackMock).not.toHaveBeenCalled();
  });

  it("re-enables a loaded pack without reading the archive", async () => {
    previewPackExistsMock.mockResolvedValue(true);
    setPreviewPackEnabledMock.mockResolvedValue({ enabled: true });
    await expect(enablePreviewPack({ dealerKey: "vehicles-im" })).resolves.toEqual({
      data: { enabled: true },
    });
    expect(setPreviewPackEnabledMock).toHaveBeenCalledWith("vehicles-im", true);
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

  it("hides a missing pack without error so Vercel toggles stay usable", async () => {
    setPreviewPackEnabledMock.mockResolvedValue({ enabled: false, missing: true });
    await expect(disablePreviewPack({ dealerKey: "vehicles-im" })).resolves.toEqual({
      data: { enabled: false },
    });
  });
});
