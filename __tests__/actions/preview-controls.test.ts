import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, findManyMock, upsertMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerPreviewPack: { findMany: findManyMock },
    siteSetting: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: upsertMock,
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { getPreviewControls, setSampleListingVisibility } = await import(
  "@/actions/admin/preview-controls"
);

describe("preview controls admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    findManyMock.mockResolvedValue([
      {
        dealerKey: "athol-garage",
        displayName: "Athol Garage",
        enabled: false,
        _count: { listings: 64 },
      },
    ]);
    upsertMock.mockResolvedValue({ key: "sample_private_listings_visible", value: false });
  });

  it("requires ADMIN before listing controls", async () => {
    requireRoleMock.mockRejectedValueOnce(new Error("Insufficient permissions"));
    await expect(getPreviewControls()).rejects.toThrow(/Insufficient permissions/);
  });

  it("lists only loaded packs and default-visible sample switches", async () => {
    await expect(getPreviewControls()).resolves.toEqual({
      data: {
        packs: [
          {
            dealerKey: "athol-garage",
            displayName: "Athol Garage",
            enabled: false,
            listingCount: 64,
          },
        ],
        samplePrivateVisible: true,
        sampleDealerVisible: true,
      },
    });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { listings: { some: {} } },
      }),
    );
  });

  it("requires ADMIN and rejects invalid sample visibility input", async () => {
    requireRoleMock.mockRejectedValueOnce(new Error("Insufficient permissions"));
    await expect(
      setSampleListingVisibility({ kind: "private", visible: false }),
    ).rejects.toThrow(/Insufficient permissions/);
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    await expect(
      setSampleListingVisibility({ kind: "ocean" as "private", visible: false }),
    ).resolves.toEqual({ error: "Invalid sample visibility." });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("upserts the private sample visibility setting", async () => {
    await expect(
      setSampleListingVisibility({ kind: "private", visible: false }),
    ).resolves.toEqual({
      data: { kind: "private", visible: false },
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "sample_private_listings_visible" },
        update: { value: false },
      }),
    );
  });
});
