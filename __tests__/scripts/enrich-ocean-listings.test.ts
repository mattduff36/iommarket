import { describe, expect, it, vi } from "vitest";
import { FUEL_TYPE_OPTIONS } from "../../lib/constants/fuel-types";
import { VehicleLookupError } from "../../lib/services/vehicle-check-error";
import type { VehicleCheckResult } from "../../lib/services/vehicle-check-types";
import {
  applyEnrichmentSnapshot,
  EnrichApplyConflictError,
  rollbackEnrichmentSnapshot,
} from "../../scripts/import-ocean-inventory/enrich-apply";
import { evaluateLookupIdentity } from "../../scripts/import-ocean-inventory/enrich-identity";
import { lookupWithPacing } from "../../scripts/import-ocean-inventory/enrich-lookup";
import {
  buildMatchCandidates,
  matchListingsToVehicles,
  primaryMatchKey,
  requiredSourcesUnhealthy,
  secondaryMatchKey,
} from "../../scripts/import-ocean-inventory/enrich-match";
import { mergeEmptyAttributes, lookupValuesBySlug } from "../../scripts/import-ocean-inventory/enrich-merge";
import {
  AcceptModelMismatchError,
  parseAcceptModelMismatchFile,
  requireAcceptModelMismatchPath,
  validateAcceptModelMismatchIds,
} from "../../scripts/import-ocean-inventory/enrich-accept";
import { parsePlateOverrideFile, PlateOverrideError, validatePlateOverrides } from "../../scripts/import-ocean-inventory/enrich-plates";
import { runEnrichPipeline } from "../../scripts/import-ocean-inventory/enrich-pipeline";
import { buildSnapshot, verifySnapshot } from "../../scripts/import-ocean-inventory/enrich-snapshot";
import type { EnrichListing, EnrichSnapshot } from "../../scripts/import-ocean-inventory/enrich-types";
import { isPlaceholderRegistration, maskRegistration, usableRegistration } from "../../scripts/import-ocean-inventory/enrich-vrm";
import {
  assertPreviewImportTarget,
  IMPORT_DEALER_NAME,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "../../scripts/import-ocean-inventory/target";
import type { NormalizedVehicle, SourceListResult } from "../../scripts/import-ocean-inventory/types";
import type { OceanSourceKey } from "../../scripts/import-ocean-inventory/sources";

const CAR_DEFINITIONS = [
  { id: "def-make", slug: "make", name: "Make", dataType: "text", required: true, options: null },
  { id: "def-model", slug: "model", name: "Model", dataType: "text", required: true, options: null },
  { id: "def-year", slug: "year", name: "Year", dataType: "number", required: true, options: null },
  {
    id: "def-fuel",
    slug: "fuel-type",
    name: "Fuel Type",
    dataType: "select",
    required: false,
    options: JSON.stringify(FUEL_TYPE_OPTIONS),
  },
  {
    id: "def-colour",
    slug: "colour",
    name: "Colour",
    dataType: "select",
    required: false,
    options: JSON.stringify(["Black", "White", "Silver", "Grey", "Blue", "Red"]),
  },
  { id: "def-engine", slug: "engine-size", name: "Engine Size", dataType: "number", required: false, options: null },
  { id: "def-co2", slug: "co2-emissions", name: "CO2 Emissions", dataType: "number", required: false, options: null },
  { id: "def-tax", slug: "tax-per-year", name: "Tax Per Year", dataType: "number", required: false, options: null },
  {
    id: "def-transmission",
    slug: "transmission",
    name: "Transmission",
    dataType: "select",
    required: false,
    options: JSON.stringify(["Manual", "Automatic"]),
  },
];

function listing(overrides: Partial<EnrichListing> = {}): EnrichListing {
  const photoUrl = "https://cdn.example.com/listing-1.jpg";
  const { attributes: attributeOverrides, ...rest } = overrides;
  const attributes = {
    make: "Ford",
    model: "Focus",
    year: "2022",
    mileage: "12000",
    "write-off-category": "None",
    ...attributeOverrides,
  };
  return {
    id: "listing-1",
    title: "2022 Ford Focus",
    dealerId: "dealer-1",
    status: "LIVE",
    categoryId: "cat-car",
    categorySlug: "car",
    pricePence: 1_850_000,
    photos: [
      {
        url: photoUrl,
        publicId: "iommarket/listings/import/a/0",
        provider: "CLOUDINARY",
        version: "1",
        format: "jpg",
        order: 0,
      },
    ],
    photoUrls: [photoUrl],
    definitions: CAR_DEFINITIONS,
    attributeRows: Object.entries(attributes).map(([slug, value], index) => ({
      id: `row-${index}`,
      attributeDefinitionId: CAR_DEFINITIONS.find((item) => item.slug === slug)?.id ?? `def-${slug}`,
      slug,
      value,
    })),
    ...rest,
    year: rest.year ?? attributes.year ?? "2022",
    make: rest.make ?? attributes.make ?? "Ford",
    model: rest.model ?? attributes.model ?? "Focus",
    mileage: rest.mileage ?? attributes.mileage ?? "12000",
    attributes,
  };
}

function vehicle(overrides: Partial<NormalizedVehicle> = {}): NormalizedVehicle {
  return {
    sourceKey: "ocean-ford",
    stockId: "stock-1",
    registration: "AB12CDE",
    stockReference: "stock-1",
    detailUrl: "https://www.oceanford.com/used-cars/focus/",
    make: "Ford",
    model: "Focus",
    derivative: "ST-Line",
    year: 2022,
    mileage: 12000,
    pricePence: 1_850_000,
    isPoa: false,
    locationName: "Ocean Ford",
    vehicleType: "Car",
    description: "A well specified Ford Focus with service history and two keys.",
    imageUrls: ["https://cdn.example.com/a.jpg"],
    fuel: "Petrol",
    transmission: "Manual",
    bodyType: "Hatchback",
    colour: "Blue",
    doors: 5,
    seats: 5,
    engineSize: 1,
    enginePower: 123,
    ...overrides,
  };
}

function sourceResult(
  overrides: Partial<SourceListResult> & Pick<SourceListResult, "sourceKey" | "vehicles">,
): SourceListResult {
  return {
    status: "ok",
    error: null,
    startUrl: "https://example.com",
    pagesFetched: 1,
    rawCount: overrides.vehicles.length,
    ...overrides,
  };
}

function healthySources(vehicles: NormalizedVehicle[], failed?: OceanSourceKey): SourceListResult[] {
  const keys: OceanSourceKey[] = ["omv", "ocean-ford", "transit-centre", "ocean-kia"];
  return keys.map((key) =>
    key === failed
      ? sourceResult({ sourceKey: key, status: "failed", error: "timeout", vehicles: [] })
      : sourceResult({
          sourceKey: key,
          vehicles: key === "ocean-ford" ? vehicles : [],
        }),
  );
}

function checkResult(overrides: Partial<VehicleCheckResult> = {}): VehicleCheckResult {
  return {
    normalizedRegistration: "AB12CDE",
    displayRegistration: "AB12 CDE",
    isManx: false,
    lookupTargetRegistration: "AB12CDE",
    vehicle: {
      registrationNumber: "AB12CDE",
      displayRegistrationNumber: "AB12 CDE",
      lookupPath: "uk",
      make: "FORD",
      model: "FOCUS",
      colour: "BLUE",
      fuelType: "PETROL",
      taxStatus: null,
      taxDueDate: null,
      motStatus: null,
      motExpiryDate: null,
      yearOfManufacture: 2022,
      engineSizeCc: 999,
      co2Emissions: 114,
      monthOfFirstRegistration: null,
      wheelPlan: null,
      euroStatus: null,
      category: null,
      previousUkRegistration: null,
      dateOfFirstRegistrationIom: null,
      roadTax12Month: "£180.00",
      roadTax6Month: null,
      firstUsedDate: null,
    },
    motHistory: null,
    mileage: null,
    auctionHistory: null,
    warnings: [],
    sourceNotes: [],
    checkedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

type AttrRow = { id: string; listingId: string; attributeDefinitionId: string; value: string };

function createFakePrisma(state: {
  dealer: { id: string; name: string };
  listings: Array<{
    id: string;
    dealerId: string;
    status: string;
    categoryId: string;
    attributeValues: AttrRow[];
  }>;
  definitions: Array<{ id: string; slug: string; categoryId: string }>;
}) {
  const tx = {
    dealerProfile: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.dealer.id === where.id ? { ...state.dealer } : null,
    },
    listing: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = state.listings.find((item) => item.id === where.id);
        if (!found) return null;
        return {
          ...found,
          attributeValues: found.attributeValues.map((row) => ({ ...row })),
        };
      },
    },
    attributeDefinition: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.definitions.find((item) => item.id === where.id) ?? null,
    },
    listingAttributeValue: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { listingId: string; attributeDefinitionId: string; value: string };
        data: { value: string };
      }) => {
        const found = state.listings.find((item) => item.id === where.listingId);
        const row = found?.attributeValues.find(
          (item) => item.attributeDefinitionId === where.attributeDefinitionId && item.value === where.value,
        );
        if (!row) return { count: 0 };
        row.value = data.value;
        return { count: 1 };
      },
      create: async ({
        data,
      }: {
        data: { listingId: string; attributeDefinitionId: string; value: string };
      }) => {
        const found = state.listings.find((item) => item.id === data.listingId);
        if (!found) throw new Error("missing listing");
        if (found.attributeValues.some((row) => row.attributeDefinitionId === data.attributeDefinitionId)) {
          throw new Error("unique");
        }
        found.attributeValues.push({
          id: `created-${found.attributeValues.length}`,
          listingId: data.listingId,
          attributeDefinitionId: data.attributeDefinitionId,
          value: data.value,
        });
      },
      deleteMany: async ({
        where,
      }: {
        where: { listingId: string; attributeDefinitionId: string; value: string };
      }) => {
        const found = state.listings.find((item) => item.id === where.listingId);
        if (!found) return { count: 0 };
        const before = found.attributeValues.length;
        found.attributeValues = found.attributeValues.filter(
          (row) =>
            !(
              row.attributeDefinitionId === where.attributeDefinitionId &&
              row.value === where.value
            ),
        );
        return { count: before - found.attributeValues.length };
      },
    },
  };

  return {
    state,
    $transaction: async (
      fn: (client: typeof tx) => Promise<unknown>,
      _options?: { isolationLevel?: string },
    ) => {
      const backup = structuredClone(state);
      try {
        return await fn(tx);
      } catch (error) {
        state.dealer = backup.dealer;
        state.listings.splice(0, state.listings.length, ...backup.listings);
        state.definitions.splice(0, state.definitions.length, ...backup.definitions);
        throw error;
      }
    },
  };
}

function snapshotFor(
  listings: EnrichSnapshot["listings"],
  dealerId = "dealer-1",
): EnrichSnapshot {
  return buildSnapshot({
    runId: "run-1",
    dealerId,
    createdAt: "2026-08-31T20:00:00.000Z",
    listings,
  });
}

describe("OMV-ENRICH-001 unique matching", () => {
  it("matches a unique primary identity and a unique secondary after price drift", () => {
    const primary = listing();
    const drifted = listing({
      id: "listing-2",
      title: "2021 Kia Sportage",
      pricePence: 2_000_000,
      year: "2021",
      make: "Kia",
      model: "Sportage",
      mileage: "8000",
      attributes: { make: "Kia", model: "Sportage", year: "2021", mileage: "8000" },
    });
    const matches = matchListingsToVehicles({
      listings: [primary, drifted],
      vehicles: [
        {
          id: "v1",
          year: 2022,
          make: "Ford",
          model: "Focus",
          mileage: 12000,
          pricePence: 1_850_000,
          registration: "AB12CDE",
          registrations: ["AB12CDE"],
          identityConflict: false,
        },
        {
          id: "v2",
          year: 2021,
          make: "Kia",
          model: "Sportage",
          mileage: 8000,
          pricePence: 2_100_000,
          registration: "KN21ABC",
          registrations: ["KN21ABC"],
          identityConflict: false,
        },
      ],
    });
    expect(primaryMatchKey({ year: 2022, make: "Ford", model: "Focus", mileage: 12000, pricePence: 1_850_000 })).toBe(
      primaryMatchKey({ year: "2022", make: "Ford", model: "Focus", mileage: "12000", pricePence: 1_850_000 }),
    );
    expect(secondaryMatchKey({ year: 2021, make: "Kia", model: "Sportage", mileage: 8000 })).toBe(
      secondaryMatchKey({ year: "2021", make: "Kia", model: "Sportage", mileage: "8000" }),
    );
    expect(matches[0]).toMatchObject({ listingId: "listing-1", reason: "matched-primary", vrm: "AB12CDE" });
    expect(matches[1]).toMatchObject({ listingId: "listing-2", reason: "matched-secondary", vrm: "KN21ABC" });
  });

  it("turns ambiguous groups and reused vehicles or VRMs into leftovers", () => {
    const first = listing({ id: "listing-a" });
    const second = listing({ id: "listing-b" });
    const ambiguous = matchListingsToVehicles({
      listings: [first, second],
      vehicles: [
        {
          id: "shared",
          year: 2022,
          make: "Ford",
          model: "Focus",
          mileage: 12000,
          pricePence: 1_850_000,
          registration: "AB12CDE",
          registrations: ["AB12CDE"],
          identityConflict: false,
        },
      ],
    });
    expect(ambiguous.every((item) => item.reason === "leftover-ambiguous")).toBe(true);

    const reusedVrm = matchListingsToVehicles({
      listings: [
        listing({ id: "listing-ford" }),
        listing({
          id: "listing-kia",
          year: "2021",
          make: "Kia",
          model: "Sportage",
          mileage: "8000",
          pricePence: 2_000_000,
          attributes: { make: "Kia", model: "Sportage", year: "2021", mileage: "8000" },
        }),
      ],
      vehicles: [
        {
          id: "v-ford",
          year: 2022,
          make: "Ford",
          model: "Focus",
          mileage: 12000,
          pricePence: 1_850_000,
          registration: "AB12CDE",
          registrations: ["AB12CDE"],
          identityConflict: false,
        },
        {
          id: "v-kia",
          year: 2021,
          make: "Kia",
          model: "Sportage",
          mileage: 8000,
          pricePence: 2_000_000,
          registration: "AB12CDE",
          registrations: ["AB12CDE"],
          identityConflict: false,
        },
      ],
    });
    expect(reusedVrm.every((item) => item.reason === "leftover-vrm-reuse")).toBe(true);
  });
});

describe("OMV-ENRICH-002 VRM rejection", () => {
  it("rejects empty, NEW-prefixed, placeholder and unsupported registrations", () => {
    expect(usableRegistration(null)).toBeNull();
    expect(usableRegistration("")).toBeNull();
    expect(isPlaceholderRegistration("NEW123")).toBe(true);
    expect(usableRegistration("NEWSTOCK")).toBeNull();
    expect(usableRegistration("TBC")).toBeNull();
    expect(usableRegistration("!!!!")).toBeNull();
    expect(usableRegistration("AB12CDE")).toBe("AB12CDE");
  });
});

describe("OMV-ENRICH-003 empty-only merge", () => {
  it("fills only blank approved slugs and preserves populated and excluded fields", () => {
    const current = {
      make: "Ford",
      model: "Focus",
      year: "2022",
      mileage: "12000",
      colour: "Blue",
      transmission: "Manual",
    };
    const lookupBySlug = lookupValuesBySlug({
      definitions: CAR_DEFINITIONS,
      result: checkResult(),
    });
    const merged = mergeEmptyAttributes({ current, lookupBySlug });
    expect(merged.fills.make).toBeUndefined();
    expect(merged.fills.colour).toBeUndefined();
    expect(merged.fills["co2-emissions"]).toBe("114");
    expect(merged.fills["tax-per-year"]).toBe("180");
    expect(merged.fills["fuel-type"]).toBe("Petrol");
    expect(merged.fills["engine-size"]).toBe("1.0");
    expect(merged.preserved).toContain("colour");
    expect(merged.fills).not.toHaveProperty("transmission");
    expect(current.transmission).toBe("Manual");
  });
});

describe("OMV-ENRICH-004 identity corroboration", () => {
  it("skips absent or mismatching make, model and year evidence", async () => {
    await expect(
      evaluateLookupIdentity({
        listingMake: "Ford",
        listingModel: "Focus",
        listingYear: "2022",
        lookupMake: "Toyota",
        lookupModel: "Focus",
        lookupYear: 2022,
      }),
    ).resolves.toEqual({ ok: false, reason: "skip-make-mismatch" });
    await expect(
      evaluateLookupIdentity({
        listingMake: "Ford",
        listingModel: "Focus",
        listingYear: "2022",
        lookupMake: "Ford",
        lookupModel: "Fiesta",
        lookupYear: 2022,
      }),
    ).resolves.toEqual({ ok: false, reason: "skip-model-mismatch" });
    await expect(
      evaluateLookupIdentity({
        listingMake: "Ford",
        listingModel: "Focus",
        listingYear: "2022",
        lookupMake: "Ford",
        lookupModel: "Focus",
        lookupYear: null,
      }),
    ).resolves.toEqual({ ok: false, reason: "skip-year-mismatch" });
    await expect(
      evaluateLookupIdentity({
        listingMake: "Ford",
        listingModel: "Focus",
        listingYear: "",
        lookupMake: "Ford",
        lookupModel: "Focus",
        lookupYear: 2022,
      }),
    ).resolves.toEqual({ ok: false, reason: "skip-year-mismatch" });
    await expect(
      evaluateLookupIdentity({
        listingMake: "",
        listingModel: "Focus",
        listingYear: "2022",
        lookupMake: "Ford",
        lookupModel: "Focus",
        lookupYear: 2022,
      }),
    ).resolves.toEqual({ ok: false, reason: "skip-make-mismatch" });
    await expect(
      evaluateLookupIdentity({
        listingMake: "Ford",
        listingModel: "Focus",
        listingYear: "2022",
        lookupMake: "Ford",
        lookupModel: "Focus",
        lookupYear: 2022,
      }),
    ).resolves.toEqual({ ok: true, modelCorroborationWaived: false });
  });
});

describe("OMV-ENRICH-005 preview guard", () => {
  it("rejects production and mismatched Supabase or database targets", () => {
    expect(PREVIEW_PROJECT_REF).toBe("syneonzucehwlghqmfbg");
    expect(() =>
      assertPreviewImportTarget({
        databaseUrl: `postgresql://postgres:x@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
        supabaseUrl: "https://syneonzucehwlghqmfbg.supabase.co",
      }),
    ).toThrow("not the new-ford-dealership preview");
    expect(() =>
      assertPreviewImportTarget({
        databaseUrl: "postgresql://postgres:x@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
        supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });
});

describe("OMV-ENRICH-006 dry-run writes", () => {
  it("does not call apply on the default dry-run path", async () => {
    const applySnapshot = vi.fn();
    const persistSnapshot = vi.fn();
    const result = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [listing()],
      sourceResults: healthySources([vehicle()]),
      lookup: async () => checkResult(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "dry-1",
      createdAt: "2026-08-31T20:00:00.000Z",
      persistSnapshot,
      applySnapshot,
    });
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(persistSnapshot).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.snapshot?.listings).toHaveLength(1);
  });
});

describe("OMV-ENRICH-007 apply refusals", () => {
  it("refuses unhealthy required scrape sources and unknown listing overrides", async () => {
    expect(requiredSourcesUnhealthy(healthySources([vehicle()], "ocean-kia"))).toContain("ocean-kia");
    expect(
      requiredSourcesUnhealthy(
        healthySources([vehicle()]).filter((item) => item.sourceKey !== "ocean-kia"),
      ),
    ).toContain("missing");
    await expect(
      runEnrichPipeline({
        dealerId: "dealer-1",
        listings: [listing()],
        sourceResults: healthySources([vehicle()], "ocean-ford"),
        lookup: async () => checkResult(),
        sleep: async () => undefined,
        delayMs: 0,
        apply: true,
        runId: "apply-1",
        createdAt: "2026-08-31T20:00:00.000Z",
        applySnapshot: async () => undefined,
      }),
    ).rejects.toThrow("Required source failed");
    expect(() =>
      validatePlateOverrides({
        overrides: [
          {
            listingId: "unknown",
            vrm: "AB12CDE",
            evidenceImageUrl: "https://cdn.example.com/listing-1.jpg",
          },
        ],
        listings: [listing()],
      }),
    ).toThrow(PlateOverrideError);
  });
});

describe("OMV-ENRICH-008 compare-and-set", () => {
  it("rejects stale populated values and leaves no partial writes", async () => {
    const prisma = createFakePrisma({
      dealer: { id: "dealer-1", name: IMPORT_DEALER_NAME },
      listings: [
        {
          id: "listing-1",
          dealerId: "dealer-1",
          status: "LIVE",
          categoryId: "cat-car",
          attributeValues: [],
        },
        {
          id: "listing-2",
          dealerId: "dealer-1",
          status: "LIVE",
          categoryId: "cat-car",
          attributeValues: [{ id: "row-1", listingId: "listing-2", attributeDefinitionId: "def-co2", value: "99" }],
        },
      ],
      definitions: [
        { id: "def-co2", slug: "co2-emissions", categoryId: "cat-car" },
      ],
    });
    const snapshot = snapshotFor([
      {
        listingId: "listing-1",
        categoryId: "cat-car",
        operations: [
          {
            attributeDefinitionId: "def-co2",
            slug: "co2-emissions",
            existed: false,
            beforeValue: null,
            afterValue: "114",
          },
        ],
      },
      {
        listingId: "listing-2",
        categoryId: "cat-car",
        operations: [
          {
            attributeDefinitionId: "def-co2",
            slug: "co2-emissions",
            existed: true,
            beforeValue: "",
            afterValue: "114",
          },
        ],
      },
    ]);
    await expect(applyEnrichmentSnapshot(prisma as never, snapshot, "dealer-1")).rejects.toThrow(
      EnrichApplyConflictError,
    );
    expect(prisma.state.listings[0].attributeValues).toEqual([]);
    expect(prisma.state.listings[1].attributeValues[0].value).toBe("99");
  });
});

describe("OMV-ENRICH-009 snapshot rollback", () => {
  it("restores blank rows, deletes created rows, and rejects conflicts", async () => {
    const prisma = createFakePrisma({
      dealer: { id: "dealer-1", name: IMPORT_DEALER_NAME },
      listings: [
        {
          id: "listing-1",
          dealerId: "dealer-1",
          status: "LIVE",
          categoryId: "cat-car",
          attributeValues: [
            { id: "blank", listingId: "listing-1", attributeDefinitionId: "def-tax", value: "" },
          ],
        },
      ],
      definitions: [
        { id: "def-tax", slug: "tax-per-year", categoryId: "cat-car" },
        { id: "def-co2", slug: "co2-emissions", categoryId: "cat-car" },
      ],
    });
    const snapshot = snapshotFor([
      {
        listingId: "listing-1",
        categoryId: "cat-car",
        operations: [
          {
            attributeDefinitionId: "def-tax",
            slug: "tax-per-year",
            existed: true,
            beforeValue: "",
            afterValue: "180",
          },
          {
            attributeDefinitionId: "def-co2",
            slug: "co2-emissions",
            existed: false,
            beforeValue: null,
            afterValue: "114",
          },
        ],
      },
    ]);
    verifySnapshot(snapshot, "dealer-1");
    await applyEnrichmentSnapshot(prisma as never, snapshot, "dealer-1");
    expect(prisma.state.listings[0].attributeValues.map((row) => row.value).sort()).toEqual(["114", "180"]);
    await rollbackEnrichmentSnapshot(prisma as never, snapshot, "dealer-1");
    expect(prisma.state.listings[0].attributeValues).toEqual([
      { id: "blank", listingId: "listing-1", attributeDefinitionId: "def-tax", value: "" },
    ]);

    await applyEnrichmentSnapshot(prisma as never, snapshot, "dealer-1");
    prisma.state.listings[0].attributeValues.find((row) => row.attributeDefinitionId === "def-tax")!.value = "changed";
    await expect(rollbackEnrichmentSnapshot(prisma as never, snapshot, "dealer-1")).rejects.toThrow(
      EnrichApplyConflictError,
    );
  });
});

describe("OMV-ENRICH-010 transactional revalidation", () => {
  it("revalidates dealer, status, category and attribute ownership", async () => {
    const snapshot = snapshotFor([
      {
        listingId: "listing-1",
        categoryId: "cat-car",
        operations: [
          {
            attributeDefinitionId: "def-co2",
            slug: "co2-emissions",
            existed: false,
            beforeValue: null,
            afterValue: "114",
          },
        ],
      },
    ]);
    const prisma = createFakePrisma({
      dealer: { id: "dealer-1", name: "Wrong Dealer" },
      listings: [
        {
          id: "listing-1",
          dealerId: "dealer-1",
          status: "LIVE",
          categoryId: "cat-car",
          attributeValues: [],
        },
      ],
      definitions: [{ id: "def-co2", slug: "co2-emissions", categoryId: "cat-car" }],
    });
    await expect(applyEnrichmentSnapshot(prisma as never, snapshot, "dealer-1")).rejects.toThrow("dealer mismatch");

    prisma.state.dealer.name = IMPORT_DEALER_NAME;
    prisma.state.listings[0].status = "DRAFT";
    await expect(applyEnrichmentSnapshot(prisma as never, snapshot, "dealer-1")).rejects.toThrow("status mismatch");

    prisma.state.listings[0].status = "LIVE";
    prisma.state.listings[0].categoryId = "cat-van";
    await expect(applyEnrichmentSnapshot(prisma as never, snapshot, "dealer-1")).rejects.toThrow("category mismatch");

    prisma.state.listings[0].categoryId = "cat-car";
    prisma.state.definitions[0].categoryId = "cat-van";
    await expect(applyEnrichmentSnapshot(prisma as never, snapshot, "dealer-1")).rejects.toThrow(
      "Attribute ownership mismatch",
    );
  });
});

describe("OMV-ENRICH-011 plate override schema", () => {
  it("validates evidence, duplicate VRMs, unknown IDs and malformed input", () => {
    expect(() => parsePlateOverrideFile({ listings: [{ listingId: "x" }] })).toThrow(PlateOverrideError);
    const target = listing({ make: "", attributes: { make: "", model: "Focus", year: "2022", mileage: "12000" } });
    expect(() =>
      validatePlateOverrides({
        overrides: [
          {
            listingId: target.id,
            vrm: "AB12CDE",
            evidenceImageUrl: "https://cdn.example.com/not-this.jpg",
          },
        ],
        listings: [target],
      }),
    ).toThrow(/evidence image/);
    expect(() =>
      validatePlateOverrides({
        overrides: [
          {
            listingId: target.id,
            vrm: "AB12CDE",
            evidenceImageUrl: "https://cdn.example.com/listing-1.jpg",
          },
        ],
        listings: [target],
      }),
    ).toThrow(/expectedMake/);
    expect(() =>
      validatePlateOverrides({
        overrides: [
          {
            listingId: "listing-1",
            vrm: "AB12CDE",
            evidenceImageUrl: "https://cdn.example.com/listing-1.jpg",
            expectedMake: "Ford",
            expectedModel: "Focus",
          },
          {
            listingId: "listing-2",
            vrm: "AB12CDE",
            evidenceImageUrl: "https://cdn.example.com/listing-1.jpg",
            expectedMake: "Ford",
            expectedModel: "Focus",
          },
        ],
        listings: [listing(), listing({ id: "listing-2" })],
      }),
    ).toThrow(/Duplicate override VRM/);
  });
});

describe("OMV-ENRICH-012 lookup pacing and reporting", () => {
  it("looks up sequentially, isolates failures, stays idempotent, and masks VRMs", async () => {
    const events: string[] = [];
    const lookups = await lookupWithPacing({
      items: ["AB12CDE", "KN21ABC", "YX22ZZZ"],
      delayMs: 25,
      sleep: async (ms) => {
        events.push(`sleep:${ms}`);
      },
      lookup: async (item) => {
        events.push(`lookup:${item}`);
        if (item === "KN21ABC") throw new VehicleLookupError("not found", { status: 404 });
        return checkResult({ normalizedRegistration: item });
      },
    });
    expect(events).toEqual(["lookup:AB12CDE", "sleep:25", "lookup:KN21ABC", "sleep:25", "lookup:YX22ZZZ"]);
    expect(lookups[1]).toMatchObject({ ok: false });
    expect(lookups.filter((item) => item.ok)).toHaveLength(2);

    const applySnapshot = vi.fn();
    const first = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [listing()],
      sourceResults: healthySources([vehicle()]),
      lookup: async () => checkResult(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "pace-1",
      createdAt: "2026-08-31T20:00:00.000Z",
      applySnapshot,
    });
    expect(JSON.stringify(first.report)).not.toContain("AB12CDE");
    expect(first.report.rows[0].vrmMasked).toBe(maskRegistration("AB12CDE"));

    const filled = listing({
      attributes: {
        make: "Ford",
        model: "Focus",
        year: "2022",
        mileage: "12000",
        "fuel-type": "Petrol",
        colour: "Blue",
        "engine-size": "1.0",
        "co2-emissions": "114",
        "tax-per-year": "180",
      },
    });
    const second = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [filled],
      sourceResults: healthySources([vehicle()]),
      lookup: async () => checkResult(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "pace-2",
      createdAt: "2026-08-31T20:00:00.000Z",
      applySnapshot,
    });
    expect(second.report.rows[0].reason).toBe("skip-no-empty-fields");
    expect(second.snapshot).toBeNull();
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(second.report.skipped.map((item) => item.reason)).toContain("skip-no-empty-fields");

    const eventsApply: string[] = [];
    await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [listing()],
      sourceResults: healthySources([vehicle()]),
      lookup: async () => checkResult(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: true,
      runId: "pace-3",
      createdAt: "2026-08-31T20:00:00.000Z",
      persistSnapshot: async () => {
        eventsApply.push("persist");
      },
      applySnapshot: async () => {
        eventsApply.push("apply");
      },
    });
    expect(eventsApply).toEqual(["persist", "apply"]);
  });
});

describe("OMV-ENRICH-013A accept-model-mismatch schema", () => {
  it("parses a strict listingIds file and rejects empty, malformed, duplicate, and missing paths", () => {
    expect(parseAcceptModelMismatchFile({ listingIds: ["listing-1"] })).toEqual(["listing-1"]);
    expect(() => parseAcceptModelMismatchFile({ listingIds: [] })).toThrow(AcceptModelMismatchError);
    expect(() => parseAcceptModelMismatchFile({})).toThrow(AcceptModelMismatchError);
    expect(() => parseAcceptModelMismatchFile({ listingIds: ["listing-1", " listing-1"] })).toThrow(
      /Duplicate accept-model-mismatch/,
    );
    expect(() => parseAcceptModelMismatchFile({ listingIds: ["  "] })).toThrow(/non-empty/);
    expect(() =>
      parseAcceptModelMismatchFile({ listingIds: ["listing-1"], extra: true }),
    ).toThrow(AcceptModelMismatchError);
    expect(() => requireAcceptModelMismatchPath(["--accept-model-mismatch"])).toThrow(
      /requires a JSON file path/,
    );
    expect(() => requireAcceptModelMismatchPath(["--accept-model-mismatch", "--apply"])).toThrow(
      /requires a JSON file path/,
    );
    expect(requireAcceptModelMismatchPath(["--accept-model-mismatch", "allow.json"])).toBe("allow.json");
    expect(requireAcceptModelMismatchPath(["--apply"])).toBeNull();
  });
});

describe("OMV-ENRICH-013B unknown accept IDs", () => {
  it("throws before lookup or apply when an ID is unknown or ineligible", async () => {
    const lookup = vi.fn(async () => checkResult());
    const applySnapshot = vi.fn();
    const persistSnapshot = vi.fn();
    await expect(
      runEnrichPipeline({
        dealerId: "dealer-1",
        listings: [listing()],
        sourceResults: healthySources([vehicle()]),
        acceptModelMismatchIds: ["not-a-listing"],
        lookup,
        sleep: async () => undefined,
        delayMs: 0,
        apply: true,
        runId: "accept-unknown",
        createdAt: "2026-08-31T20:00:00.000Z",
        persistSnapshot,
        applySnapshot,
      }),
    ).rejects.toThrow(/Unknown or ineligible listing ID/);
    expect(lookup).not.toHaveBeenCalled();
    expect(persistSnapshot).not.toHaveBeenCalled();
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(() =>
      validateAcceptModelMismatchIds({
        listingIds: ["listing-1"],
        listings: [listing({ status: "LIVE" })],
      }),
    ).not.toThrow();
    expect(() =>
      validateAcceptModelMismatchIds({
        listingIds: ["listing-1"],
        listings: [{ ...listing(), status: "DRAFT" } as unknown as EnrichListing],
      }),
    ).toThrow(/Unknown or ineligible listing ID/);
  });
});

describe("OMV-ENRICH-013C through 013H model-mismatch allowlist", () => {
  const mismatchListing = () =>
    listing({
      model: "Transit Custom",
      attributes: {
        make: "Ford",
        model: "Transit Custom",
        year: "2022",
        mileage: "12000",
        colour: "Blue",
        "fuel-type": "Diesel",
      },
    });
  const mismatchVehicle = () => vehicle({ model: "Transit Custom" });
  const transitLookup = () => {
    const result = checkResult();
    return {
      ...result,
      vehicle: result.vehicle ? { ...result.vehicle, model: "TRANSIT" } : null,
    };
  };

  it("OMV-ENRICH-013C allowlisted model mismatch fills only empty fields and records the waiver", async () => {
    const result = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [mismatchListing()],
      sourceResults: healthySources([mismatchVehicle()]),
      acceptModelMismatchIds: ["listing-1"],
      lookup: async () => transitLookup(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "accept-c",
      createdAt: "2026-08-31T20:00:00.000Z",
    });
    expect(result.report.rows[0].reason).toBe("applied");
    expect(result.report.rows[0].modelCorroborationWaived).toBe(true);
    expect(result.report.rows[0].filledSlugs.sort()).toEqual(
      ["co2-emissions", "engine-size", "tax-per-year"].sort(),
    );
    expect(result.snapshot?.listings[0].operations.map((item) => item.slug).sort()).toEqual(
      ["co2-emissions", "engine-size", "tax-per-year"].sort(),
    );
    expect(result.snapshot?.listings[0].operations.some((item) => item.slug === "model")).toBe(false);
  });

  it("records the waiver when an allowlisted mismatch has no empty fields to fill", async () => {
    const filled = listing({
      model: "Transit Custom",
      attributes: {
        make: "Ford",
        model: "Transit Custom",
        year: "2022",
        mileage: "12000",
        colour: "Blue",
        "fuel-type": "Diesel",
        "engine-size": "2.0",
        "co2-emissions": "168",
        "tax-per-year": "180",
      },
    });
    const result = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [filled],
      sourceResults: healthySources([mismatchVehicle()]),
      acceptModelMismatchIds: ["listing-1"],
      lookup: async () => transitLookup(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "accept-c-empty",
      createdAt: "2026-08-31T20:00:00.000Z",
    });
    expect(result.report.rows[0].reason).toBe("skip-no-empty-fields");
    expect(result.report.rows[0].modelCorroborationWaived).toBe(true);
    expect(result.snapshot).toBeNull();
  });

  it("OMV-ENRICH-013D allowlisted wrong make still skips with no snapshot", async () => {
    const applySnapshot = vi.fn();
    const persistSnapshot = vi.fn();
    const toyota = transitLookup();
    const result = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [mismatchListing()],
      sourceResults: healthySources([mismatchVehicle()]),
      acceptModelMismatchIds: ["listing-1"],
      lookup: async () => ({
        ...toyota,
        vehicle: toyota.vehicle ? { ...toyota.vehicle, make: "TOYOTA" } : null,
      }),
      sleep: async () => undefined,
      delayMs: 0,
      apply: true,
      runId: "accept-d",
      createdAt: "2026-08-31T20:00:00.000Z",
      persistSnapshot,
      applySnapshot,
    });
    expect(result.report.rows[0].reason).toBe("skip-make-mismatch");
    expect(result.snapshot).toBeNull();
    expect(result.applied).toBe(false);
    expect(persistSnapshot).not.toHaveBeenCalled();
    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it("OMV-ENRICH-013E allowlisted blank or mismatching year still skips", async () => {
    await expect(
      evaluateLookupIdentity({
        listingMake: "Ford",
        listingModel: "Transit Custom",
        listingYear: "",
        lookupMake: "Ford",
        lookupModel: "TRANSIT",
        lookupYear: 2022,
        acceptModelMismatch: true,
      }),
    ).resolves.toEqual({ ok: false, reason: "skip-year-mismatch" });

    const lookup = transitLookup();
    const result = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [mismatchListing()],
      sourceResults: healthySources([mismatchVehicle()]),
      acceptModelMismatchIds: ["listing-1"],
      lookup: async () => ({
        ...lookup,
        vehicle: lookup.vehicle ? { ...lookup.vehicle, yearOfManufacture: 2023 } : null,
      }),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "accept-e",
      createdAt: "2026-08-31T20:00:00.000Z",
    });
    expect(result.report.rows[0].reason).toBe("skip-year-mismatch");
    expect(result.snapshot).toBeNull();
  });

  it("OMV-ENRICH-013F without the allowlist exact model disagreement still skips", async () => {
    const result = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [mismatchListing()],
      sourceResults: healthySources([mismatchVehicle()]),
      lookup: async () => transitLookup(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "accept-f",
      createdAt: "2026-08-31T20:00:00.000Z",
    });
    expect(result.report.rows[0].reason).toBe("skip-model-mismatch");
    expect(result.report.rows[0].modelCorroborationWaived).toBe(false);
    expect(result.snapshot).toBeNull();
  });

  it("OMV-ENRICH-013G dry-run does not persist and apply snapshots before mutation", async () => {
    const persistSnapshot = vi.fn();
    const applySnapshot = vi.fn();
    const dry = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [mismatchListing()],
      sourceResults: healthySources([mismatchVehicle()]),
      acceptModelMismatchIds: ["listing-1"],
      lookup: async () => transitLookup(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "accept-g-dry",
      createdAt: "2026-08-31T20:00:00.000Z",
      persistSnapshot,
      applySnapshot,
    });
    expect(dry.applied).toBe(false);
    expect(persistSnapshot).not.toHaveBeenCalled();
    expect(applySnapshot).not.toHaveBeenCalled();

    const events: string[] = [];
    await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [mismatchListing()],
      sourceResults: healthySources([mismatchVehicle()]),
      acceptModelMismatchIds: ["listing-1"],
      lookup: async () => transitLookup(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: true,
      runId: "accept-g-apply",
      createdAt: "2026-08-31T20:00:00.000Z",
      persistSnapshot: async () => {
        events.push("persist");
      },
      applySnapshot: async () => {
        events.push("apply");
      },
    });
    expect(events).toEqual(["persist", "apply"]);
  });

  it("OMV-ENRICH-013H report records waiver without raw VRMs and keeps applied counts", async () => {
    const result = await runEnrichPipeline({
      dealerId: "dealer-1",
      listings: [mismatchListing()],
      sourceResults: healthySources([mismatchVehicle()]),
      acceptModelMismatchIds: ["listing-1"],
      lookup: async () => transitLookup(),
      sleep: async () => undefined,
      delayMs: 0,
      apply: false,
      runId: "accept-h",
      createdAt: "2026-08-31T20:00:00.000Z",
    });
    expect(result.report.counts.applied).toBe(1);
    expect(result.report.rows[0].modelCorroborationWaived).toBe(true);
    expect(result.report.rows[0].vrmMasked).toBe("AB****DE");
    const serialized = JSON.stringify(result.report);
    expect(serialized).not.toContain("AB12CDE");
    expect(serialized).not.toContain("AB12 CDE");
  });
});

describe("conflicting scrape registrations", () => {
  it("does not assign a VRM when reconciled records disagree", () => {
    const candidates = buildMatchCandidates(
      healthySources([
        vehicle({ registration: "AB12CDE" }),
        vehicle({ stockId: "stock-1", registration: "KN21ABC" }),
      ]),
    );
    const matches = matchListingsToVehicles({ listings: [listing()], vehicles: candidates });
    expect(matches[0].reason).toBe("leftover-identity-conflict");
    expect(matches[0].vrm).toBeNull();
  });
});
