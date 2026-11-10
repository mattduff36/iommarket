import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, cacheCalls } = vi.hoisted(() => ({
  cacheCalls: [] as Array<{ key: string[]; args: unknown[] }>,
  mockDb: {
    vehicleMake: { findMany: vi.fn() },
    vehicleModel: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => unknown>(fn: T, key: string[]) =>
    (...args: Parameters<T>) => {
      cacheCalls.push({ key, args });
      return fn(...args);
    },
}));

import {
  getActiveModelsByMake,
  getActiveVehicleMakes,
  VEHICLE_MAKE_LIMIT,
  VEHICLE_MODEL_LIMIT,
} from "@/lib/vehicle-catalogue/queries";

describe("vehicle catalogue query behavior MD-CAT-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheCalls.length = 0;
    mockDb.vehicleMake.findMany.mockResolvedValue([
      {
        id: "vw",
        name: "Volkswagen",
        normalizedName: "volkswagen",
      },
    ]);
    mockDb.vehicleModel.findMany.mockResolvedValue([]);
  });

  it("bounds make and per-make model/alias reads", async () => {
    await getActiveVehicleMakes();
    await getActiveModelsByMake("Volkswagen");

    expect(mockDb.vehicleMake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true },
        take: VEHICLE_MAKE_LIMIT,
      }),
    );
    expect(mockDb.vehicleModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          make: { active: true, normalizedName: { in: ["volkswagen", "vw"] } },
        },
        take: VEHICLE_MODEL_LIMIT,
        select: expect.objectContaining({
          aliases: expect.objectContaining({ take: 20 }),
        }),
      }),
    );
  });

  it("resolves the VW alias to the Volkswagen catalogue make", async () => {
    await getActiveModelsByMake("VW");

    expect(mockDb.vehicleModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          make: { active: true, normalizedName: { in: ["volkswagen", "vw"] } },
        },
      }),
    );
    expect(
      cacheCalls
        .filter((call) => call.key[0] === "vehicle-catalogue-active-models-v2")
        .map((call) => call.args),
    ).toEqual([["volkswagen"]]);
  });

  it("normalizes before the model cache boundary and skips unknown makes", async () => {
    await getActiveModelsByMake(" VW ");
    await getActiveModelsByMake("Volkswagen");

    const modelCacheCalls = cacheCalls.filter(
      (call) => call.key[0] === "vehicle-catalogue-active-models-v2",
    );
    expect(modelCacheCalls.map((call) => call.args)).toEqual([
      ["volkswagen"],
      ["volkswagen"],
    ]);

    vi.clearAllMocks();
    mockDb.vehicleMake.findMany.mockResolvedValue([
      { id: "vw", name: "Volkswagen", normalizedName: "volkswagen" },
    ]);
    await expect(getActiveModelsByMake("Unknown Raw Variant")).resolves.toEqual(
      [],
    );
    expect(mockDb.vehicleModel.findMany).not.toHaveBeenCalled();
  });

  it("deduplicates make labels and resolves models held under legacy catalogue aliases", async () => {
    mockDb.vehicleMake.findMany.mockResolvedValue([
      { id: "vw", name: "VW", normalizedName: "vw" },
      { id: "volkswagen", name: "VOLKSWAGEN", normalizedName: "volkswagen" },
      { id: "rr", name: "Range Rover", normalizedName: "rangerover" },
    ]);
    expect(await getActiveVehicleMakes()).toEqual([
      { id: "vw", name: "Volkswagen", normalizedName: "volkswagen" },
      { id: "rr", name: "Land Rover", normalizedName: "landrover" },
    ]);
    mockDb.vehicleModel.findMany.mockResolvedValue([
      { id: "raw", name: "EVOQUE", make: { name: "Range Rover" }, aliases: [] },
      { id: "canonical", name: "Range Rover Evoque", make: { name: "Land Rover" }, aliases: [] },
      { id: "discovery", name: "DISCOVERY SPORT", make: { name: "Range Rover" }, aliases: [] },
    ]);
    expect(await getActiveModelsByMake("Land Rover")).toMatchObject([
      { id: "raw", name: "Range Rover Evoque" },
      { id: "discovery", name: "Discovery Sport" },
    ]);
    expect(mockDb.vehicleModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, make: { active: true, normalizedName: { in: ["landrover", "rangerover"] } } },
    }));
  });

  it("deduplicates scoped spellings without hiding trims or attaching ambiguous aliases", async () => {
    mockDb.vehicleMake.findMany.mockResolvedValue([
      { id: "honda", name: "HONDA", normalizedName: "honda" },
    ]);
    mockDb.vehicleModel.findMany.mockResolvedValue([
      { id: "a", name: "CRV EX", make: { name: "Honda" }, aliases: [{ name: "S" }] },
      { id: "b", name: "CR - V EX", make: { name: "Honda" }, aliases: [] },
      { id: "c", name: "CR-V SE", make: { name: "Honda" }, aliases: [] },
    ]);
    const models = await getActiveModelsByMake("Honda");
    expect(models.map((model) => model.name)).toEqual(["CR-V EX", "CR-V SE"]);
    expect(models[0].aliases).toEqual(["CRV EX", "CR - V EX"]);
  });
});
