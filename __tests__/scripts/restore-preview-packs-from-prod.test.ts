import { describe, expect, it } from "vitest";
import {
  APPLY_CONFIRM_TOKEN,
  PREVIEW_CONFIRM_DB,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertRestoreSafety,
  parseRestoreArgs,
} from "../../scripts/restore-preview-packs-from-prod/safety";
import {
  planRestore,
  remapCatalogIds,
} from "../../scripts/restore-preview-packs-from-prod/plan";

const applyFlags = [
  "--allow=1",
  `--source-ref=${PRODUCTION_PROJECT_REF}`,
  `--dest-ref=${PREVIEW_PROJECT_REF}`,
  `--confirm-db=${PREVIEW_CONFIRM_DB}`,
  "--apply",
  `--confirm=${APPLY_CONFIRM_TOKEN}`,
];

describe("PPR-SAFE-001 refuse production destination and require preview confirm", () => {
  it("refuses a production destination before any copy plan is built", () => {
    expect(() =>
      assertRestoreSafety({
        argv: [
          "--allow=1",
          `--source-ref=${PRODUCTION_PROJECT_REF}`,
          `--dest-ref=${PRODUCTION_PROJECT_REF}`,
          `--confirm-db=db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
        ],
        destConfirmDb: `db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
      }),
    ).toThrow(/preview/);
    expect(() =>
      assertRestoreSafety({
        argv: [
          "--allow=1",
          `--source-ref=${PRODUCTION_PROJECT_REF}`,
          `--dest-ref=${PREVIEW_PROJECT_REF}`,
        ],
        destConfirmDb: PREVIEW_CONFIRM_DB,
      }),
    ).toThrow(/confirm-db/);
    expect(() =>
      assertRestoreSafety({
        argv: applyFlags.filter((flag) => !flag.startsWith("--allow=")),
        destConfirmDb: PREVIEW_CONFIRM_DB,
      }),
    ).toThrow(/allow/);
    expect(() =>
      assertRestoreSafety({
        argv: applyFlags.filter((flag) => flag !== "--apply" && !flag.startsWith("--confirm=")),
        destConfirmDb: PREVIEW_CONFIRM_DB,
      }),
    ).not.toThrow();
    expect(parseRestoreArgs(["node", "script", ...applyFlags])).toEqual({
      allow: true,
      sourceRef: PRODUCTION_PROJECT_REF,
      destRef: PREVIEW_PROJECT_REF,
      confirmDb: PREVIEW_CONFIRM_DB,
      apply: true,
      confirm: APPLY_CONFIRM_TOKEN,
      dryRun: false,
    });
  });
});

function sourceFixture() {
  return {
    packs: [
      {
        dealerKey: "athol-garage",
        displayName: "Athol Garage",
        sourceRunId: "run-1",
        enabled: true,
        website: "https://www.athol.im/",
        ownerEmail: "preview+athol-garage@preview.internal",
        ownerAuthUserId: "preview-system:athol-garage",
        listings: [
          {
            id: "src-listing-1",
            status: "ADMIN_PREVIEW",
            title: "Ford Focus",
            description: "Nice car",
            price: 1_250_000,
            categorySlug: "car",
            regionSlug: "iom-south",
            slug: "ford-focus",
            trustDeclarationAccepted: true,
            trustDeclarationAcceptedAt: new Date("2026-08-22T00:00:00.000Z"),
            images: [
              {
                publicId: "iommarket/listings/preview-packs/athol-garage/car/0",
                url: "https://res.cloudinary.com/demo/image/upload/v1/car.jpg",
                order: 0,
                provider: "CLOUDINARY" as const,
                assetId: "asset-1",
                version: "1",
                width: 800,
                height: 600,
                format: "jpg",
                bytes: 12000,
                focalX: null,
                focalY: null,
              },
            ],
            attributes: [{ slug: "mileage", value: "12000" }],
          },
        ],
      },
      {
        dealerKey: "ocean-motor-village",
        displayName: "Ocean Motor Village",
        sourceRunId: "run-1",
        enabled: true,
        website: "https://ocean.example",
        ownerEmail: "mattduff36@gmail.com",
        ownerAuthUserId: "auth-ocean",
        listings: [
          {
            id: "src-ocean",
            status: "ADMIN_PREVIEW",
            title: "Ocean car",
            description: "No",
            price: 1,
            categorySlug: "car",
            regionSlug: "iom-south",
            slug: null,
            trustDeclarationAccepted: true,
            trustDeclarationAcceptedAt: null,
            images: [],
            attributes: [],
          },
        ],
      },
    ],
    extraListings: [
      {
        id: "live-1",
        status: "LIVE",
        previewPackId: null,
        title: "Public seed car",
      },
    ],
    extraUsers: [{ email: "admin@mpdee.co.uk", authUserId: "auth-admin" }],
  };
}

const destCatalog = {
  categories: [{ id: "dest-car", slug: "car" }],
  regions: [{ id: "dest-south", slug: "iom-south" }],
  attributes: [{ id: "dest-mileage", slug: "mileage", categoryId: "dest-car" }],
};

describe("PPR-SCOPE-001 ignore LIVE listings and real users", () => {
  it("plans only ADMIN_PREVIEW pack listings and preview-system accounts", () => {
    const planned = planRestore({
      source: sourceFixture(),
      destCatalog,
    });
    expect(planned.listings.map((listing) => listing.sourceId)).toEqual(["src-listing-1"]);
    expect(planned.listings.some((listing) => listing.sourceId === "live-1")).toBe(false);
    expect(planned.accounts.map((account) => account.email)).toEqual([
      "preview+athol-garage@preview.internal",
    ]);
    expect(planned.accounts.some((account) => account.email === "admin@mpdee.co.uk")).toBe(false);
    expect(planned.ops.every((op) => op.kind !== "delete")).toBe(true);
  });
});

describe("PPR-OCEAN-001 skip Ocean keys", () => {
  it("drops Ocean packs and their listings from the restore plan", () => {
    const planned = planRestore({
      source: sourceFixture(),
      destCatalog,
    });
    expect(planned.packs.map((pack) => pack.dealerKey)).toEqual(["athol-garage"]);
    expect(planned.skippedOcean).toEqual(["ocean-motor-village"]);
  });
});

describe("PPR-REMAP-001 new IDs and slug-mapped catalog", () => {
  it("maps category, region, and attributes by slug onto destination IDs", () => {
    const map = remapCatalogIds({
      source: {
        categories: [{ id: "src-car", slug: "car" }],
        regions: [{ id: "src-south", slug: "iom-south" }],
        attributes: [{ id: "src-mileage", slug: "mileage", categoryId: "src-car" }],
      },
      dest: destCatalog,
    });
    expect(map.categoryId.get("src-car")).toBe("dest-car");
    expect(map.regionId.get("src-south")).toBe("dest-south");
    expect(map.attributeId.get("src-mileage")).toBe("dest-mileage");
    const planned = planRestore({
      source: sourceFixture(),
      destCatalog,
    });
    expect(planned.listings[0]?.categoryId).toBe("dest-car");
    expect(planned.listings[0]?.regionId).toBe("dest-south");
    expect(planned.listings[0]?.attributes[0]?.attributeDefinitionId).toBe("dest-mileage");
    expect(planned.listings[0]?.sourceId).toBe("src-listing-1");
  });
});

describe("PPR-HIDE-001 copied packs are hidden", () => {
  it("forces enabled false even when production packs were visible", () => {
    const planned = planRestore({
      source: sourceFixture(),
      destCatalog,
    });
    expect(planned.packs).toEqual([
      expect.objectContaining({
        dealerKey: "athol-garage",
        enabled: false,
      }),
    ]);
  });
});

describe("PPR-ACCT-001 Prisma preview-system users only", () => {
  it("upserts dealerKey-derived preview system identities", () => {
    const planned = planRestore({
      source: sourceFixture(),
      destCatalog,
    });
    expect(planned.accounts).toEqual([
      {
        dealerKey: "athol-garage",
        email: "preview+athol-garage@preview.internal",
        authUserId: "preview-system:athol-garage",
        name: "Athol Garage",
        website: "https://www.athol.im/",
        slug: "preview-athol-garage",
      },
    ]);
    expect(planned.ops.some((op) => op.kind === "createAuthUser")).toBe(false);
  });
});

describe("PPR-SEED-001 does not delete non-preview listings", () => {
  it("emits only create and upsert operations", () => {
    const planned = planRestore({
      source: sourceFixture(),
      destCatalog,
    });
    expect(new Set(planned.ops.map((op) => op.kind))).toEqual(
      new Set(["upsertUser", "upsertDealer", "createPack", "createListing"]),
    );
  });
});
