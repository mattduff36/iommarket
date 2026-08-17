import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { mockDb, mockTx } = vi.hoisted(() => {
  const tx = {
    vehicleMake: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    vehicleModel: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    vehicleModelAlias: {
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    adminAuditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    mockTx: tx,
    mockDb: {
      vehicleMake: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      vehicleModel: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  applyVehicleCatalogueImport,
  buildVehicleCatalogueDiff,
  previewVehicleCatalogueImport,
  VEHICLE_CATALOGUE_TRANSACTION_OPTIONS,
} from "@/lib/vehicle-catalogue/import";
import { normalizeVehicleIdentity } from "@/lib/vehicle-catalogue/identity";
import { canonicalizeKnownMake } from "@/lib/vehicle-catalogue/make-canonicalization";
import { validateVehicleCatalogueSubmission } from "@/lib/vehicle-catalogue/listing-validation";
import { vehicleCatalogueImportSchema } from "@/lib/validations/vehicle-catalogue";

const payload = vehicleCatalogueImportSchema.parse({
  source: "@meterapp/vehicle-db",
  sourceVersion: "2.3.0+test",
  importedAt: "2026-08-17T00:00:00.000Z",
  deactivateMissing: true,
  makes: [
    {
      name: "Volkswagen",
      active: true,
      sortOrder: 10,
      models: [
        {
          name: "T-Roc",
          active: true,
          sortOrder: 10,
          aliases: [
            { name: "Type One", active: true, sortOrder: 10 },
          ],
        },
      ],
    },
  ],
});

const existingCatalogue = [
  {
    id: "make-1",
    name: "Volkswagen",
    normalizedName: "volkswagen",
    active: true,
    sortOrder: 10,
    source: payload.source,
    sourceVersion: payload.sourceVersion,
    models: [
      {
        id: "model-1",
        makeId: "make-1",
        name: "T-Roc",
        normalizedName: "troc",
        active: true,
        sortOrder: 10,
        source: payload.source,
        sourceVersion: payload.sourceVersion,
        aliases: [
          {
            id: "alias-1",
            name: "Type One",
            normalizedName: "typeone",
            active: true,
            sortOrder: 10,
            source: payload.source,
            sourceVersion: payload.sourceVersion,
          },
        ],
      },
    ],
  },
];

describe("vehicle catalogue query bounds MD-CAT-001", () => {
  it("does not scan listing attributes and bounds make/model/alias payloads", () => {
    const sellData = readFileSync(
      resolve(process.cwd(), "app", "(public)", "sell", "sell-form-data.ts"),
      "utf8",
    );
    const queries = readFileSync(
      resolve(process.cwd(), "lib", "vehicle-catalogue", "queries.ts"),
      "utf8",
    );

    expect(sellData).not.toContain("listingAttributeValue");
    expect(sellData).toContain("getActiveVehicleMakes");
    expect(queries).toContain("take: VEHICLE_MAKE_LIMIT");
    expect(queries).toContain("take: VEHICLE_MODEL_LIMIT");
    expect(queries).toContain("take: 20");
  });
});

describe("vehicle catalogue normalization MD-CAT-002", () => {
  it("uses one shared make canonicalization source", () => {
    expect(canonicalizeKnownMake("MERCEDES BENZ")).toBe("Mercedes-Benz");
    expect(canonicalizeKnownMake("SSANGYONG")).toBe("SsangYong");
    expect(canonicalizeKnownMake("Unknown Works")).toBe("Unknown Works");
  });

  it("normalizes the T-Roc alias and preserves unknown manual values", async () => {
    const lookup = {
      findMake: vi.fn(async (key: string) =>
        key === "volkswagen"
          ? { name: "Volkswagen", normalizedName: "volkswagen" }
          : null,
      ),
      findModel: vi.fn(async (_make: string, model: string) =>
        ["troc"].includes(model) ? { name: "T-Roc" } : null,
      ),
    };

    await expect(
      normalizeVehicleIdentity("VW", "T Roc", lookup),
    ).resolves.toEqual({
      make: "Volkswagen",
      model: "T-Roc",
      makeMatched: true,
      modelMatched: true,
    });
    await expect(
      normalizeVehicleIdentity("Volkswagen", "TROC", lookup),
    ).resolves.toEqual({
      make: "Volkswagen",
      model: "T-Roc",
      makeMatched: true,
      modelMatched: true,
    });
    await expect(
      normalizeVehicleIdentity("Unknown Works", "One-Off", lookup),
    ).resolves.toEqual({
      make: "Unknown Works",
      model: "One-Off",
      makeMatched: false,
      modelMatched: false,
    });
  });

  it("validates canonical pairs server-side while accepting manual fallback", async () => {
    const definitions = [
      {
        id: "make-id",
        slug: "make",
        name: "Make",
        dataType: "text",
        required: true,
        options: null,
      },
      {
        id: "model-id",
        slug: "model",
        name: "Model",
        dataType: "text",
        required: true,
        options: null,
      },
    ];
    const attributes = [
      { attributeDefinitionId: "make-id", value: "Volkswagen" },
      { attributeDefinitionId: "model-id", value: "T-Roc R-Line" },
    ];
    mockDb.vehicleModel.findFirst.mockResolvedValue({ id: "model-1" });

    await expect(
      validateVehicleCatalogueSubmission({
        definitions,
        attributes,
        selection: {
          makeMode: "catalogue",
          modelMode: "catalogue",
          canonicalMake: "Volkswagen",
          canonicalModel: "T-Roc",
          variant: "R-Line",
        },
      }),
    ).resolves.toEqual({});
    await expect(
      validateVehicleCatalogueSubmission({
        definitions,
        attributes: [
          { attributeDefinitionId: "make-id", value: "Unknown Works" },
          { attributeDefinitionId: "model-id", value: "One-Off" },
        ],
        selection: { makeMode: "manual", modelMode: "manual" },
      }),
    ).resolves.toEqual({});
    expect(mockDb.vehicleModel.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("vehicle catalogue import MD-CAT-003", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.vehicleMake.findMany.mockResolvedValue([]);
    mockTx.vehicleMake.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "make-1", normalizedName: "volkswagen" },
      ]);
    mockTx.vehicleModel.findMany.mockResolvedValue([
      { id: "model-1", makeId: "make-1", normalizedName: "troc" },
    ]);
    mockDb.$transaction.mockImplementation(
      async (
        callback: (transaction: typeof mockTx) => unknown,
        options: unknown,
      ) => {
        expect(options).toEqual(VEHICLE_CATALOGUE_TRANSACTION_OPTIONS);
        return callback(mockTx);
      },
    );
  });

  it("validates bounded JSON and reports dry-run changes", () => {
    const diff = buildVehicleCatalogueDiff([], payload);
    expect(diff.creates).toEqual({ makes: 1, models: 1, aliases: 1 });
    expect(
      vehicleCatalogueImportSchema.safeParse({
        ...payload,
        makes: Array.from({ length: 101 }, (_, index) => ({
          name: `Make ${index}`,
          models: [],
        })),
      }).success,
    ).toBe(false);
    expect(
      vehicleCatalogueImportSchema.safeParse({
        ...payload,
        makes: [
          {
            ...payload.makes[0],
            models: [
              {
                ...payload.makes[0].models[0],
                aliases: [
                  { name: "T Roc", active: true, sortOrder: 10 },
                  { name: "TROC", active: true, sortOrder: 20 },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      vehicleCatalogueImportSchema.safeParse({
        ...payload,
        makes: [
          {
            name: "Volkswagen",
            models: [
              {
                name: "Golf",
                aliases: [{ name: "Rabbit" }],
              },
              {
                name: "Rabbit",
                aliases: [],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      vehicleCatalogueImportSchema.safeParse({
        ...payload,
        sourceMode: "preserve-existing",
        deactivateMissing: true,
      }).success,
    ).toBe(false);
  });

  it("applies in one transaction, audits, and deactivates instead of deleting", async () => {
    await applyVehicleCatalogueImport(payload, "admin-1");

    expect(mockDb.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      VEHICLE_CATALOGUE_TRANSACTION_OPTIONS,
    );
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockTx.vehicleMake.createMany).toHaveBeenCalledTimes(1);
    expect(mockTx.vehicleModel.createMany).toHaveBeenCalledTimes(1);
    expect(mockTx.vehicleModelAlias.createMany).toHaveBeenCalledTimes(1);
    expect(mockTx.vehicleMake.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: expect.objectContaining({
          models: expect.objectContaining({
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: expect.objectContaining({
              aliases: expect.objectContaining({
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
              }),
            }),
          }),
        }),
      }),
    );
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "IMPORT_VEHICLE_CATALOGUE",
        entityType: "VehicleCatalogue",
      }),
    });
    expect(mockTx.vehicleMake.updateMany).toHaveBeenCalled();
    expect(mockTx.vehicleModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: payload.source }),
        data: { active: false },
      }),
    );
    expect(mockTx.vehicleModelAlias.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: payload.source }),
        data: { active: false },
      }),
    );
  });

  it("skips unchanged entity updates on a no-op reimport", async () => {
    mockTx.vehicleMake.findMany
      .mockReset()
      .mockResolvedValueOnce(existingCatalogue)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "make-1", normalizedName: "volkswagen" },
      ]);
    const noOpPayload = { ...payload, deactivateMissing: false };

    const diff = await applyVehicleCatalogueImport(noOpPayload, "admin-1");

    expect(diff.unchanged).toEqual({ makes: 1, models: 1, aliases: 1 });
    expect(mockTx.vehicleMake.update).not.toHaveBeenCalled();
    expect(mockTx.vehicleModel.update).not.toHaveBeenCalled();
    expect(mockTx.vehicleModelAlias.update).not.toHaveBeenCalled();
    expect(mockTx.vehicleMake.createMany).not.toHaveBeenCalled();
    expect(mockTx.vehicleModel.createMany).not.toHaveBeenCalled();
    expect(mockTx.vehicleModelAlias.createMany).not.toHaveBeenCalled();
    expect(mockDb.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      VEHICLE_CATALOGUE_TRANSACTION_OPTIONS,
    );
  });

  it("updates only entities whose imported values changed", async () => {
    mockTx.vehicleMake.findMany
      .mockReset()
      .mockResolvedValueOnce(existingCatalogue)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "make-1", normalizedName: "volkswagen" },
      ]);
    const changedPayload = vehicleCatalogueImportSchema.parse({
      ...payload,
      deactivateMissing: false,
      makes: [
        {
          ...payload.makes[0],
          models: [
            {
              ...payload.makes[0].models[0],
              aliases: [
                {
                  ...payload.makes[0].models[0].aliases[0],
                  sortOrder: 20,
                },
              ],
            },
          ],
        },
      ],
    });

    const diff = await applyVehicleCatalogueImport(changedPayload, "admin-1");

    expect(diff.updates).toEqual({ makes: 0, models: 0, aliases: 1 });
    expect(mockTx.vehicleMake.update).not.toHaveBeenCalled();
    expect(mockTx.vehicleModel.update).not.toHaveBeenCalled();
    expect(mockTx.vehicleModelAlias.update).toHaveBeenCalledTimes(1);
  });

  it("preserves existing ownership in safe export-source mode", async () => {
    const ownedCatalogue = [
      {
        ...existingCatalogue[0],
        source: "admin",
        sourceVersion: "manual-v1",
        models: [
          {
            ...existingCatalogue[0].models[0],
            source: "seed",
            sourceVersion: "seed-v1",
            aliases: [
              {
                ...existingCatalogue[0].models[0].aliases[0],
                source: "admin",
                sourceVersion: "manual-v2",
              },
            ],
          },
        ],
      },
    ];
    mockTx.vehicleMake.findMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(ownedCatalogue)
      .mockResolvedValueOnce([
        { id: "make-1", normalizedName: "volkswagen" },
      ]);
    const exportPayload = vehicleCatalogueImportSchema.parse({
      ...payload,
      source: "iommarket-export",
      sourceVersion: "export-v1",
      sourceMode: "preserve-existing",
      deactivateMissing: false,
      makes: [
        {
          ...payload.makes[0],
          sortOrder: 20,
        },
      ],
    });

    await applyVehicleCatalogueImport(exportPayload, "admin-1");

    expect(mockTx.vehicleMake.update).toHaveBeenCalledWith({
      where: { id: "make-1" },
      data: { name: "Volkswagen", active: true, sortOrder: 20 },
    });
    expect(mockTx.vehicleModel.update).not.toHaveBeenCalled();
    expect(mockTx.vehicleModelAlias.update).not.toHaveBeenCalled();
    expect(mockTx.vehicleMake.updateMany).not.toHaveBeenCalled();
    expect(mockTx.vehicleModel.updateMany).not.toHaveBeenCalled();
    expect(mockTx.vehicleModelAlias.updateMany).not.toHaveBeenCalled();
  });

  it("predicts exact boundary deactivations and fails closed on overflow", async () => {
    const boundaryPayload = vehicleCatalogueImportSchema.parse({
      source: "boundary-source",
      sourceVersion: "v1",
      importedAt: "2026-08-17T00:00:00.000Z",
      deactivateMissing: true,
      makes: [{ name: "Make 0", models: [] }],
    });
    const sourceRows = Array.from({ length: 100 }, (_, index) => ({
      id: `make-${index}`,
      name: `Make ${index}`,
      normalizedName: `make${index}`,
      active: true,
      sortOrder: index,
      source: "boundary-source",
      sourceVersion: "v1",
      models: [],
    }));
    mockDb.vehicleMake.findMany
      .mockReset()
      .mockResolvedValueOnce(sourceRows)
      .mockResolvedValueOnce([]);

    await expect(
      previewVehicleCatalogueImport(boundaryPayload),
    ).resolves.toMatchObject({
      deactivates: { makes: 99, models: 0, aliases: 0 },
    });

    mockDb.vehicleMake.findMany
      .mockReset()
      .mockResolvedValueOnce([
        ...sourceRows,
        {
          ...sourceRows[0],
          id: "make-overflow",
          name: "Make overflow",
          normalizedName: "makeoverflow",
        },
      ]);
    await expect(previewVehicleCatalogueImport(boundaryPayload)).rejects.toThrow(
      /exceeds the 100-make safety limit/,
    );
  });

  it("accepts a deterministic seed-scale payload within practical limits", () => {
    const seedScale = {
      source: "iommarket-seed-test",
      sourceVersion: "v1",
      importedAt: "2026-08-17T00:00:00.000Z",
      deactivateMissing: false,
      makes: Array.from({ length: 50 }, (_, makeIndex) => ({
        name: `Seed Make ${makeIndex}`,
        sortOrder: makeIndex * 10,
        models: Array.from({ length: 100 }, (_, modelIndex) => ({
          name: `Model ${makeIndex}-${modelIndex}`,
          sortOrder: modelIndex * 10,
          aliases: [],
        })),
      })),
    };

    const first = vehicleCatalogueImportSchema.parse(seedScale);
    const second = vehicleCatalogueImportSchema.parse(seedScale);
    expect(first).toEqual(second);
    expect(first.makes).toHaveLength(50);
  });

  it("rejects silent source ownership transfer", async () => {
    mockDb.vehicleMake.findMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
        id: "make-1",
        name: "Volkswagen",
        normalizedName: "volkswagen",
        active: true,
        sortOrder: 0,
        source: "admin",
        sourceVersion: "manual-v1",
        models: [],
        },
      ]);

    await expect(previewVehicleCatalogueImport(payload)).rejects.toThrow(
      /owned by source "admin"/,
    );
  });
});
