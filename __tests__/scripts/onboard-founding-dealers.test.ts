import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFoundingDealerKeyAllowed,
  assertFoundingEmailAllowed,
  FOUNDING_DEALERS,
  foundingEmails,
  isFoundingEmail,
  isProtectedGmailOwner,
} from "../../scripts/onboard-founding-dealers/allowlist";
import { planFoundingProfile } from "../../scripts/onboard-founding-dealers/accounts";
import { planFoundingListings, assertFoundingListingProvenance } from "../../scripts/onboard-founding-dealers/apply";
import { resolveFoundingGrant } from "../../scripts/onboard-founding-dealers/grant";
import { foundingListingSlug } from "../../scripts/onboard-founding-dealers/identity";
import {
  assertPathInsideArchive,
  assertSafeRemoteUrl,
  deleteFoundingCloudinaryAssets,
  detectRasterType,
  isPrivateIpAddress,
} from "../../scripts/onboard-founding-dealers/media";
import {
  loadFoundingProductionEnv,
  resolveProductionDirectDatabaseUrl,
} from "../../scripts/onboard-founding-dealers/env";
import {
  createEmptyManifest,
  writeAtomicJson,
  writeCredentials,
} from "../../scripts/onboard-founding-dealers/manifest";
import { rollbackPreCommit } from "../../scripts/onboard-founding-dealers/run";
import {
  APPLY_CONFIRM_TOKEN,
  assertFoundingSafety,
  EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME,
  parseFoundingArgs,
  PREVIEW_PROJECT_REF,
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_ENV_FILE,
  PRODUCTION_PROJECT_REF,
} from "../../scripts/onboard-founding-dealers/safety";
import { planMikeMotorsPreviewRename } from "../../scripts/onboard-founding-dealers/preview-rename";
import { isPreviewSystemEmail } from "../../lib/preview-packs/safety";
import { vehicle } from "./dealer-stock-sync/fixtures";
import type { ArchivedVehicle } from "../../scripts/dealer-stock-sync/types";
import { readFileSync } from "node:fs";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const applyFlags = [
  "--allow=1",
  `--dest-ref=${PRODUCTION_PROJECT_REF}`,
  `--confirm-db=${PRODUCTION_CONFIRM_DB}`,
  "--apply",
  `--confirm=${APPLY_CONFIRM_TOKEN}`,
];

function archived(overrides: Partial<ArchivedVehicle> = {}): ArchivedVehicle {
  const item = vehicle({ dealerKey: "athol-garage", sourceKey: "used-cars" });
  return {
    identityKey: "sourceVehicleId:stock-1",
    identityKind: "sourceVehicleId",
    sources: ["used-cars"],
    preferredSource: "used-cars",
    vehicle: item,
    priceMismatch: false,
    identityConflict: false,
    conflictReason: null,
    contentHash: "abc",
    importable: true,
    importSkipReason: null,
    images: [],
    ...overrides,
  };
}

describe("FDP-SAFE-001 production targeting", () => {
  it("refuses preview dest, missing confirm, and wrong flags", () => {
    expect(() =>
      assertFoundingSafety({
        argv: ["--allow=1", `--dest-ref=${PREVIEW_PROJECT_REF}`, `--confirm-db=${PRODUCTION_CONFIRM_DB}`],
        destConfirmDb: PRODUCTION_CONFIRM_DB,
      }),
    ).toThrow(/dest-ref/);
    expect(() =>
      assertFoundingSafety({
        argv: applyFlags.filter((flag) => !flag.startsWith("--allow=")),
        destConfirmDb: PRODUCTION_CONFIRM_DB,
      }),
    ).toThrow(/allow/);
    expect(() =>
      assertFoundingSafety({
        argv: applyFlags.filter((flag) => !flag.startsWith("--confirm=")),
        destConfirmDb: PRODUCTION_CONFIRM_DB,
      }),
    ).toThrow(/confirm/);
    expect(() =>
      assertFoundingSafety({
        argv: [...applyFlags, "--preview-rename"],
        destConfirmDb: PRODUCTION_CONFIRM_DB,
      }),
    ).toThrow(/preview rename/);
    expect(parseFoundingArgs(["node", "script", ...applyFlags]).confirm).toBe(APPLY_CONFIRM_TOKEN);
  });

  it("refuses a preview database inside a production env file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "founding-env-"));
    temps.push(cwd);
    await writeFile(
      join(cwd, PRODUCTION_ENV_FILE),
      [
        "NEXT_PUBLIC_SUPABASE_URL=https://syneonzucehwlghqmfbg.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY=test-key",
        "DATABASE_URL=postgresql://postgres:x@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
        "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=prodcloud",
        "CLOUDINARY_API_KEY=key",
        "CLOUDINARY_API_SECRET=secret",
      ].join("\n"),
    );
    expect(() => loadFoundingProductionEnv(PRODUCTION_ENV_FILE, cwd)).toThrow(/preview/);
  });

  it("rewrites a production pooler URL onto the direct production host", () => {
    const rewritten = resolveProductionDirectDatabaseUrl(
      `postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@aws-1-eu-west-2.pooler.supabase.com:6543/postgres`,
    );
    const parsed = new URL(rewritten);
    expect(parsed.hostname).toBe(`db.${PRODUCTION_PROJECT_REF}.supabase.co`);
    expect(parsed.port).toBe("5432");
    expect(decodeURIComponent(parsed.username)).toBe("postgres");
    expect(() =>
      resolveProductionDirectDatabaseUrl(
        `postgresql://postgres.${PREVIEW_PROJECT_REF}:secret@aws-1-eu-west-2.pooler.supabase.com:6543/postgres`,
      ),
    ).toThrow(/preview|direct|pooler/i);
  });

  it("fills missing production Cloudinary from .env.local only when the shared cloud name matches", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "founding-cloud-"));
    temps.push(cwd);
    await writeFile(
      join(cwd, PRODUCTION_ENV_FILE),
      [
        `NEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_PROJECT_REF}.supabase.co`,
        "SUPABASE_SERVICE_ROLE_KEY=test-key",
        `DATABASE_URL=postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@aws-1-eu-west-2.pooler.supabase.com:6543/postgres`,
        "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=",
        "CLOUDINARY_API_KEY=",
        "CLOUDINARY_API_SECRET=",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, ".env.local"),
      [
        "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=wrong-cloud",
        "CLOUDINARY_API_KEY=key",
        "CLOUDINARY_API_SECRET=secret",
      ].join("\n"),
    );
    expect(() => loadFoundingProductionEnv(PRODUCTION_ENV_FILE, cwd)).toThrow(/Cloudinary cloud name/);
    await writeFile(
      join(cwd, ".env.local"),
      [
        `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=${EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME}`,
        "CLOUDINARY_API_KEY=key",
        "CLOUDINARY_API_SECRET=secret",
      ].join("\n"),
    );
    const env = loadFoundingProductionEnv(PRODUCTION_ENV_FILE, cwd);
    expect(env.cloudinaryCloudName).toBe(EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME);
    expect(new URL(env.databaseUrl).hostname).toBe(`db.${PRODUCTION_PROJECT_REF}.supabase.co`);
  });
});

describe("FDP-EMAIL-001 fake founding emails", () => {
  it("allows only the four compacted @itrader.im.preview addresses", () => {
    expect(foundingEmails()).toEqual([
      "atholgarage@itrader.im.preview",
      "mikesmotors@itrader.im.preview",
      "rexmotorcompany@itrader.im.preview",
      "tdcarcentre@itrader.im.preview",
    ]);
    for (const email of foundingEmails()) {
      expect(() => assertFoundingEmailAllowed(email)).not.toThrow();
      expect(isFoundingEmail(email)).toBe(true);
      expect(isPreviewSystemEmail(email)).toBe(false);
      expect(isProtectedGmailOwner(email)).toBe(false);
    }
    expect(() => assertFoundingEmailAllowed("mattduff36@gmail.com")).toThrow(/Gmail/);
    expect(() => assertFoundingEmailAllowed("mattduff36+athol-garage@gmail.com")).toThrow(/Gmail/);
    expect(() => assertFoundingEmailAllowed("preview+athol-garage@preview.internal")).toThrow(
      /preview-system/,
    );
    expect(() => assertFoundingDealerKeyAllowed("ocean-motor-village")).toThrow(/Ocean/);
  });

  it("never writes passwords into the redacted onboard output", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "founding-creds-"));
    temps.push(cwd);
    writeCredentials(
      "run-1",
      [{ dealerKey: "athol-garage", email: "atholgarage@itrader.im.preview", password: "secret-pass" }],
      cwd,
    );
    const raw = await readFile(join(cwd, "private", "founding-dealers", "run-1", "credentials.json"), "utf8");
    expect(raw).toContain("secret-pass");
    const printed = JSON.stringify(
      { credentialPath: "private/x", password: "secret-pass", credentials: [{ password: "secret-pass" }] },
      (key, value) => (key === "password" || key === "credentials" ? "[redacted]" : value),
    );
    expect(printed).not.toContain("secret-pass");
  });
});

describe("FDP-ACCT-001 account and grant", () => {
  it("creates Pro profiles with empty logo/phone/bio and preserves grant dates on rerun", () => {
    const dealer = FOUNDING_DEALERS[0];
    const now = new Date("2026-09-09T12:00:00.000Z");
    const created = planFoundingProfile({
      prismaUserId: "user-1",
      dealer,
      existing: null,
      paidSubscription: false,
      existingGrant: null,
      now,
    });
    expect(created.tier).toBe("PRO");
    expect(created.verified).toBe(true);
    expect(created.website).toBe(dealer.website);
    expect(created.logoUrl).toBeNull();
    expect(created.phone).toBeNull();
    expect(created.bio).toBeNull();
    expect(created.slug).toBe("dealer-user-1");
    expect(created.grant.kind).toBe("create");
    expect(created.grant.endsAt.getTime() - created.grant.startsAt.getTime()).toBe(90 * 86_400_000);

    const preserved = resolveFoundingGrant({
      subscriptions: [
        {
          source: "ADMIN_GRANT",
          status: "ACTIVE",
          grantStartsAt: created.grant.startsAt,
          grantEndsAt: created.grant.endsAt,
        },
      ],
      now: new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(preserved.kind).toBe("preserve");
    expect(preserved.startsAt).toEqual(created.grant.startsAt);
    expect(preserved.endsAt).toEqual(created.grant.endsAt);
    expect(() =>
      resolveFoundingGrant({
        subscriptions: [{ source: "PAYMENT", status: "ACTIVE", grantStartsAt: null, grantEndsAt: null }],
        now,
      }),
    ).toThrow(/paid subscription/);
    expect(() =>
      resolveFoundingGrant({
        subscriptions: [
          {
            source: "ADMIN_GRANT",
            status: "ACTIVE",
            grantStartsAt: created.grant.startsAt,
            grantEndsAt: created.grant.endsAt,
          },
          {
            source: "ADMIN_GRANT",
            status: "CANCELLED",
            grantStartsAt: created.grant.startsAt,
            grantEndsAt: created.grant.endsAt,
          },
        ],
        now,
      }),
    ).toThrow(/unexpected existing grant/);
    expect(() =>
      resolveFoundingGrant({
        subscriptions: [
          {
            source: "ADMIN_GRANT",
            status: "ACTIVE",
            grantStartsAt: created.grant.startsAt,
            grantEndsAt: now,
          },
        ],
        now,
      }),
    ).toThrow(/unexpected existing grant/);

    const preservedProfile = planFoundingProfile({
      prismaUserId: "user-1",
      dealer,
      existing: {
        id: "dealer-1",
        name: dealer.displayName,
        slug: "dealer-user-1",
        website: dealer.website,
        bio: "Dealer supplied",
        phone: "01624 000000",
        logoUrl: "https://res.cloudinary.com/example/logo.png",
        verified: true,
        tier: "PRO",
        isAdminPreview: false,
        userId: "user-1",
      },
      paidSubscription: false,
      existingGrant: {
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        grantStartsAt: created.grant.startsAt,
        grantEndsAt: created.grant.endsAt,
      },
      now,
    });
    expect(preservedProfile.bio).toBe("Dealer supplied");
    expect(preservedProfile.phone).toBe("01624 000000");
    expect(preservedProfile.logoUrl).toBe("https://res.cloudinary.com/example/logo.png");
  });
});

describe("FDP-LIVE-001 and FDP-CAP-001 listing plan", () => {
  it("inserts LIVE listings and never writes ADMIN_PREVIEW or policy rows", () => {
    const apply = readFileSync("scripts/onboard-founding-dealers/apply.ts", "utf8");
    expect(apply).toMatch(/status:\s*"LIVE"/);
    expect(apply).not.toMatch(/ADMIN_PREVIEW/);
    expect(apply).toMatch(/previewPackId:\s*null/);
    expect(apply).not.toMatch(/grantAdminDealerAccess/);
    expect(readFileSync("scripts/onboard-founding-dealers/run.ts", "utf8")).not.toMatch(
      /grantAdminDealerAccess/,
    );
  });

  it("plans LIVE founding slugs, skips duplicates, and reports overflow over 100", () => {
    const vehicles = Array.from({ length: 102 }, (_, index) =>
      archived({
        identityKey: `sourceVehicleId:stock-${String(index).padStart(3, "0")}`,
        vehicle: vehicle({
          dealerKey: "athol-garage",
          sourceVehicleId: `stock-${index}`,
          make: "Ford",
          model: "Focus",
          year: 2020,
          mileage: 10000 + index,
          pricePence: 1_000_000 + index,
        }),
      }),
    );
    const existingSlug = foundingListingSlug("athol-garage", "sourceVehicleId:stock-000");
    const planned = planFoundingListings({
      dealerKey: "athol-garage",
      regionSlug: "iom-south",
      vehicles,
      remainingSlots: 100,
      existingSlugs: new Set([existingSlug]),
    });
    expect(planned.planned[0]?.existing).toBe(true);
    expect(planned.planned.every((item) => item.slug.startsWith("fd-athol-garage-"))).toBe(true);
    expect(planned.planned.every((item) => !item.slug.includes("vin:"))).toBe(true);
    expect(planned.overflow).toBe(1);
    expect(planned.planned.filter((item) => !item.existing)).toHaveLength(100);
    expect(() =>
      assertFoundingListingProvenance({
        existing: {
          dealerId: "dealer-1",
          status: "LIVE",
          previewPackId: null,
          title: "Old title",
          price: 100,
        },
        expectedDealerId: "dealer-1",
        expectedTitle: "New title",
        expectedPricePence: 100,
      }),
    ).toThrow(/content does not match/);
  });
});

describe("FDP-MAP-001 naming alias", () => {
  it("keeps Mike's Motors as the canonical preview rename target", () => {
    expect(planMikeMotorsPreviewRename()).toEqual({
      dealerKey: "mikes-motors",
      displayName: "Mike's Motors",
    });
    expect(FOUNDING_DEALERS.find((item) => item.key === "mikes-motors")?.displayName).toBe("Mike's Motors");
  });
});

describe("FDP-MEDIA-001 archive path and raster checks", () => {
  it("rejects path escape, loopback URLs, and non-raster bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "founding-media-"));
    temps.push(dir);
    expect(() => assertPathInsideArchive(dir, join(dir, "..", "secret.jpg"))).toThrow(/escapes/);
    expect(() => assertSafeRemoteUrl("http://example.com/a.jpg")).toThrow(/HTTPS/);
    expect(() => assertSafeRemoteUrl("https://127.0.0.1/a.jpg")).toThrow(/not allowed/);
    expect(() => detectRasterType(Buffer.from("not-an-image"))).toThrow(/raster/);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(detectRasterType(jpeg)).toBe("image/jpeg");
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.0.0.8")).toBe(true);
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
    const deleted: string[] = [];
    await expect(
      deleteFoundingCloudinaryAssets({
        config: { cloudName: "du3othqre", apiKey: "k", apiSecret: "s" },
        publicIds: ["one", "two"],
        fetchImpl: async (_url, init) => {
          const body = String(init?.body ?? "");
          const publicId = new URLSearchParams(body).get("public_id") ?? "";
          deleted.push(publicId);
          return new Response("fail", { status: publicId === "one" ? 500 : 200 });
        },
      }),
    ).rejects.toThrow(/one/);
    expect(deleted).toEqual(["one", "two"]);
  });
});

describe("FDP-POLICY-001", () => {
  it("does not create policy acceptance records in the apply or run modules", () => {
    const apply = readFileSync("scripts/onboard-founding-dealers/apply.ts", "utf8");
    const run = readFileSync("scripts/onboard-founding-dealers/run.ts", "utf8");
    expect(apply).not.toMatch(/policyAcceptance\.create/);
    expect(run).not.toMatch(/policyAcceptance\.create/);
    expect(apply).toContain("administrative, not dealer acceptance");
  });
});

describe("FDP-RESUME-001 grant and empty manifest phases", () => {
  it("starts uncommitted so pre-commit rollback remains legal", () => {
    const manifest = createEmptyManifest("run-1");
    expect(manifest.dbCommitted).toBe(false);
    expect(manifest.createdAuthUserIds).toEqual([]);
    expect(manifest.phase).toBe("credentials");
  });

  it("continues Auth cleanup after Cloudinary rollback fails", async () => {
    const deleted: string[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "founding-atomic-"));
    temps.push(cwd);
    writeAtomicJson(join(cwd, "manifest.json"), { ok: true });
    const raw = await readFile(join(cwd, "manifest.json"), "utf8");
    expect(raw).toContain("\"ok\": true");
    await expect(
      rollbackPreCommit({
        admin: {
          auth: {
            admin: {
              listUsers: async () => ({ data: { users: [] }, error: null }),
              createUser: async () => ({ data: { user: null }, error: null }),
              updateUserById: async () => ({ data: { user: null }, error: null }),
              deleteUser: async (id: string) => {
                deleted.push(id);
                return { error: null };
              },
            },
          },
        },
        cloudinary: { cloudName: "du3othqre", apiKey: "k", apiSecret: "s" },
        manifest: {
          ...createEmptyManifest("run-1"),
          createdAuthUserIds: ["auth-1"],
          cloudinaryPublicIds: ["iommarket/listings/founding/athol-garage/x/0"],
        },
        fetchImpl: async () => new Response("fail", { status: 500 }),
      }),
    ).rejects.toThrow(/rollback incomplete/);
    expect(deleted).toEqual(["auth-1"]);
  });
});
