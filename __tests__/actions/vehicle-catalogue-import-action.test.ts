import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  previewVehicleCatalogueImport,
  applyVehicleCatalogueImport,
  reportHandledException,
  mockDb,
} =
  vi.hoisted(() => ({
    previewVehicleCatalogueImport: vi.fn(),
    applyVehicleCatalogueImport: vi.fn(),
    reportHandledException: vi.fn(),
    mockDb: {
      vehicleMake: { findMany: vi.fn() },
    },
  }));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(async () => ({ id: "admin-1" })),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/monitoring", () => ({ reportHandledException }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/vehicle-catalogue/import", () => ({
  VehicleCatalogueImportConflictError: class extends Error {},
  lockVehicleCatalogueTransaction: vi.fn(),
  previewVehicleCatalogueImport,
  applyVehicleCatalogueImport,
}));

import {
  exportVehicleCatalogue,
  importVehicleCatalogue,
} from "@/actions/vehicle-catalogue";

const json = JSON.stringify({
  source: "admin-test",
  sourceVersion: "v1",
  importedAt: "2026-08-17T00:00:00.000Z",
  deactivateMissing: true,
  makes: [{ name: "Volkswagen", models: [] }],
});

describe("vehicle catalogue import action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewVehicleCatalogueImport.mockResolvedValue({
      creates: { makes: 0, models: 0, aliases: 0 },
      updates: { makes: 0, models: 0, aliases: 0 },
      deactivates: { makes: 1, models: 0, aliases: 0 },
      unchanged: { makes: 0, models: 0, aliases: 0 },
    });
    applyVehicleCatalogueImport.mockResolvedValue(
      previewVehicleCatalogueImport.mock.results[0]?.value,
    );
    reportHandledException.mockResolvedValue(undefined);
    mockDb.vehicleMake.findMany.mockResolvedValue([]);
  });

  it("requires explicit confirmation after a deactivating dry-run", async () => {
    const blocked = await importVehicleCatalogue({ json, dryRun: false });
    expect(blocked.error).toMatch(/Confirm deactivation/);
    expect(applyVehicleCatalogueImport).not.toHaveBeenCalled();

    await importVehicleCatalogue({ json, dryRun: true });
    expect(previewVehicleCatalogueImport).toHaveBeenCalledTimes(1);

    await importVehicleCatalogue({
      json,
      dryRun: false,
      confirmDeactivateMissing: true,
    });
    expect(applyVehicleCatalogueImport).toHaveBeenCalledWith(
      expect.objectContaining({ deactivateMissing: true }),
      "admin-1",
    );
  });

  it("exports explicit preserve-existing source mode", async () => {
    const result = await exportVehicleCatalogue();
    expect(result).toEqual({
      data: expect.objectContaining({
        source: "iommarket-export",
        sourceMode: "preserve-existing",
        deactivateMissing: false,
      }),
    });
  });

  it("reports unexpected persistence failures with safe UI text", async () => {
    applyVehicleCatalogueImport.mockRejectedValue(
      new Error("postgresql://secret-host/internal"),
    );

    const result = await importVehicleCatalogue({
      json,
      dryRun: false,
      confirmDeactivateMissing: true,
    });

    expect(reportHandledException).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "applyVehicleCatalogueImport",
        userId: "admin-1",
      }),
    );
    expect(result).toEqual({
      error: "Vehicle catalogue update failed. No changes were applied.",
    });
  });
});
