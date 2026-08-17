import { describe, expect, it, vi } from "vitest";

const { requireRole } = vi.hoisted(() => ({
  requireRole: vi.fn(async () => {
    throw new Error("ADMIN_REQUIRED");
  }),
}));

vi.mock("@/lib/auth", () => ({ requireRole }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import {
  exportVehicleCatalogue,
  importVehicleCatalogue,
  saveVehicleMake,
  saveVehicleModel,
  saveVehicleModelAlias,
} from "@/actions/vehicle-catalogue";

describe("vehicle catalogue admin authorization", () => {
  it.each([
    ["save make", () =>
      saveVehicleMake({
        name: "Test",
        active: true,
        sortOrder: 0,
        source: "admin",
        sourceVersion: "v1",
      })],
    ["save model", () =>
      saveVehicleModel({
        makeId: "cm1234567890123456789012",
        name: "Test",
        active: true,
        sortOrder: 0,
        source: "admin",
        sourceVersion: "v1",
      })],
    ["save alias", () =>
      saveVehicleModelAlias({
        modelId: "cm1234567890123456789012",
        name: "Test",
        active: true,
        sortOrder: 0,
        source: "admin",
        sourceVersion: "v1",
      })],
    ["import", () =>
      importVehicleCatalogue({ json: "{}", dryRun: true })],
    ["export", () => exportVehicleCatalogue()],
  ])("rejects non-admin access before %s", async (_name, action) => {
    await expect(action()).rejects.toThrow("ADMIN_REQUIRED");
  });
});
