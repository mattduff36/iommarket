import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LISTING_DURATION_DAYS } from "../../lib/listing-status";
import { resolveCatalog } from "../../prisma/seed/catalog-resolve";
import {
  EXPIRED_COUNT,
  LIVE_COUNT,
  SOLD_COUNT,
} from "../../prisma/seed/constants";
import { buildMarketplacePlan } from "../../prisma/seed/dataset";
import {
  assertStatusEventChain,
  assertStatusEventTimes,
  listingStatusEventTimes,
} from "../../prisma/seed/lifecycle";
import { wipeMarketplace, wipeRemainingDealerProfiles } from "../../prisma/seed/wipe";
import { accountDaysAgo, LIVE_MAX_AGE_DAYS } from "../../prisma/seed/timeline";
import { parseRebuildArgs } from "../../scripts/preview-rebuild/args";
import {
  assertApprovedAuthDeletion,
  assertRetainedAuthRoster,
  plannedAuthDeletions,
  resolveAuthUsersToDelete,
} from "../../scripts/preview-rebuild/auth";
import { verifyPairedBackups } from "../../scripts/preview-rebuild/backups";
import {
  assertFingerprintsMatch,
  fingerprintPreserveRows,
} from "../../scripts/preview-rebuild/fingerprint";
import { findForbiddenRebuildOps } from "../../scripts/preview-rebuild/forbidden";
import { applyPreviewRebuildInTransaction } from "../../scripts/preview-rebuild/phase";
import { runPreviewRebuild } from "../../scripts/preview-rebuild/run";
import {
  assertConfirmationToken,
  buildRebuildSnapshot,
  confirmationToken,
} from "../../scripts/preview-rebuild/snapshot";
import { sha256Buffer, type BackupManifest } from "../../scripts/prod-mirror/manifest";
import {
  KEEP_ACCOUNT_EMAILS,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "../../scripts/wipe-preview-marketplace/target";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const PRESERVE = fingerprintPreserveRows({
  waitlist: [
    {
      id: "w1",
      email: "wait@example.im",
      interests: ["cars"],
      source: "coming_soon_page",
    },
  ],
  content: [{ id: "c1", slug: "about", title: "About", markdown: "Hi", status: "PUBLISHED" }],
  settings: [{ key: "site", value: { a: 1 }, updatedAt: "2026-01-01T00:00:00.000Z" }],
  regions: [{ id: "r1", slug: "iom-east", name: "East", active: true, sortOrder: 1 }],
  categories: [{ id: "cat1", slug: "car", name: "Cars", active: true, sortOrder: 1 }],
  attributes: [
    {
      id: "a1",
      slug: "make",
      categoryId: "cat1",
      name: "Make",
      dataType: "text",
      required: true,
    },
  ],
  vehicleMakes: [{ id: "m1", normalizedName: "ford", name: "Ford", active: true }],
  vehicleModels: [{ id: "mo1", normalizedName: "focus", name: "Focus", makeId: "m1" }],
  vehicleAliases: [{ id: "al1", normalizedName: "focus", name: "Focus", makeId: "m1", modelId: "mo1" }],
});

function backup(kind: "preview" | "production", ref: string, id: string) {
  return {
    kind,
    dir: `/tmp/${id}`,
    manifest: {
      id,
      workstream: "prod-mirror-20260831",
      targetRef: ref,
      confirmDb: `db.${ref}.supabase.co/postgres`,
      createdAt: "2026-09-04T18:12:14.861Z",
      files: [
        {
          name: "public-auth.data.sql",
          sha256: `hash-${id}`,
          bytes: 10,
        },
      ],
    } as BackupManifest,
  };
}

function liveState() {
  return {
    prismaEmails: ["admin@mpdee.co.uk", "d.p.marshall@hotmail.co.uk", "preview+1@preview.internal"],
    authEmails: [
      "admin@mpdee.co.uk",
      "d.p.marshall@hotmail.co.uk",
      "davooomarsh@hotmail.com",
      "mattduff36@gmail.com",
    ],
    listingCount: 408,
    listingByStatus: { LIVE: 41, ADMIN_PREVIEW: 367 },
    dealerNames: ["Morris motors"],
    preserve: PRESERVE,
  };
}

function writePairedBackups(root: string) {
  const previewDump = Buffer.from("preview-dump");
  const productionDump = Buffer.from("production-dump");
  const previewDir = join(
    root,
    "2026-09-04",
    `preview-${PREVIEW_PROJECT_REF}-pmr-2026-09-04T18-12-14-861Z-dc5bcc`,
  );
  const productionDir = join(
    root,
    "2026-09-04",
    `production-${PRODUCTION_PROJECT_REF}-pmr-2026-09-04T18-12-44-278Z-90d6ee`,
  );
  mkdirSync(previewDir, { recursive: true });
  mkdirSync(productionDir, { recursive: true });
  writeFileSync(join(previewDir, "public-auth.data.sql"), previewDump);
  writeFileSync(join(productionDir, "public-auth.data.sql"), productionDump);
  const writeManifest = (dir: string, id: string, ref: string, dump: Buffer) => {
    const manifest: BackupManifest = {
      id,
      workstream: "prod-mirror" as BackupManifest["workstream"],
      targetRef: ref,
      confirmDb: `db.${ref}.supabase.co/postgres`,
      createdAt: "2026-09-04T18:12:14.861Z",
      files: [
        {
          name: "public-auth.data.sql",
          sha256: sha256Buffer(dump),
          bytes: dump.length,
        },
      ],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  };
  writeManifest(previewDir, "preview-dc5bcc", PREVIEW_PROJECT_REF, previewDump);
  writeManifest(productionDir, "production-90d6ee", PRODUCTION_PROJECT_REF, productionDump);
}

describe("PREVIEW-BACKUP-001", () => {
  it("requires paired manifests and recomputes every file hash", () => {
    const cwd = mkdtempSync(join(tmpdir(), "preview-backup-"));
    try {
      expect(() => verifyPairedBackups(cwd)).toThrow("does not exist");
      writePairedBackups(join(cwd, "private", "db-backups"));
      const verified = verifyPairedBackups(cwd);
      expect(verified.preview.manifest.targetRef).toBe(PREVIEW_PROJECT_REF);
      expect(verified.production.manifest.targetRef).toBe(PRODUCTION_PROJECT_REF);
      writeFileSync(
        join(verified.preview.dir, "public-auth.data.sql"),
        Buffer.from("preview-XXXX"),
      );
      expect(() => verifyPairedBackups(cwd)).toThrow("hash mismatch");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("PREVIEW-CONFIRM-001", () => {
  it("rejects missing, altered, or stale tokens and does not mutate before confirmation", async () => {
    const calls: string[] = [];
    const snapshot = buildRebuildSnapshot({
      ...liveState(),
      deleteAuthEmails: ["davooomarsh@hotmail.com", "mattduff36@gmail.com"],
      backups: {
        preview: backup("preview", PREVIEW_PROJECT_REF, "p1"),
        production: backup("production", PRODUCTION_PROJECT_REF, "prod1"),
      },
      planned: {
        live: LIVE_COUNT,
        sold: SOLD_COUNT,
        expired: EXPIRED_COUNT,
        dealers: 12,
        privateSellers: 22,
      },
    });
    expect(() => assertConfirmationToken(snapshot)).toThrow("confirmation token required");
    expect(() => assertConfirmationToken(snapshot, "yes wipe preview syneonzucehwlghqmfbg")).toThrow(
      "does not match snapshot",
    );
    const stale = buildRebuildSnapshot({
      ...liveState(),
      listingCount: 1,
      deleteAuthEmails: ["davooomarsh@hotmail.com", "mattduff36@gmail.com"],
      backups: {
        preview: backup("preview", PREVIEW_PROJECT_REF, "p1"),
        production: backup("production", PRODUCTION_PROJECT_REF, "prod1"),
      },
      planned: snapshot.planned,
    });
    expect(() => assertConfirmationToken(stale, confirmationToken(snapshot))).toThrow(
      "does not match snapshot",
    );

    const result = await runPreviewRebuild({
      confirm: undefined,
      hooks: {
        verifyBackups: () => ({
          preview: backup("preview", PREVIEW_PROJECT_REF, "p1"),
          production: backup("production", PRODUCTION_PROJECT_REF, "prod1"),
        }),
        loadState: async () => liveState(),
        mutate: {
          deleteAuth: async () => {
            calls.push("deleteAuth");
          },
          verifyAuth: async () => [...KEEP_ACCOUNT_EMAILS],
          rebuildDatabase: async () => {
            calls.push("rebuild");
            return PRESERVE;
          },
        },
      },
    });
    expect(result.mutated).toBe(false);
    expect(calls).toEqual([]);
    expect(parseRebuildArgs(["--confirm=abc"]).confirm).toBe("abc");
  });
});

describe("PREVIEW-AUTH-001", () => {
  it("deletes only the snapshot-approved Auth roster and keeps the two retained emails", () => {
    expect(
      plannedAuthDeletions([
        ...KEEP_ACCOUNT_EMAILS,
        "davooomarsh@hotmail.com",
        "mattduff36@gmail.com",
      ]),
    ).toEqual(["davooomarsh@hotmail.com", "mattduff36@gmail.com"]);
    expect(() =>
      assertApprovedAuthDeletion({
        snapshotDeleteEmails: ["davooomarsh@hotmail.com"],
        requestedEmails: ["admin@mpdee.co.uk"],
      }),
    ).toThrow("not the confirmed snapshot list");
    expect(() =>
      assertApprovedAuthDeletion({
        snapshotDeleteEmails: ["admin@mpdee.co.uk"],
        requestedEmails: ["admin@mpdee.co.uk"],
      }),
    ).toThrow("keep-list email");
    expect(
      resolveAuthUsersToDelete(
        [
          { id: "1", email: "davooomarsh@hotmail.com" },
          { id: "2", email: "mattduff36@gmail.com" },
        ],
        ["davooomarsh@hotmail.com", "mattduff36@gmail.com"],
      ),
    ).toEqual([
      { id: "1", email: "davooomarsh@hotmail.com" },
      { id: "2", email: "mattduff36@gmail.com" },
    ]);
    expect(
      plannedAuthDeletions([...KEEP_ACCOUNT_EMAILS]),
    ).toEqual([]);
    expect(() => assertRetainedAuthRoster(["admin@mpdee.co.uk"])).toThrow("exactly");
    expect(() => assertRetainedAuthRoster([...KEEP_ACCOUNT_EMAILS])).not.toThrow();
  });
});

function recordingTx() {
  const calls: Array<{ table: string; where: unknown }> = [];
  const tx = new Proxy(
    {},
    {
      get(_target, table: string) {
        return {
          deleteMany: async (args?: { where?: unknown }) => {
            calls.push({ table, where: args?.where ?? null });
          },
        };
      },
    },
  );
  return { calls, tx };
}

describe("PREVIEW-WIPE-001", () => {
  it("deletes listing rows, packs, all dealers, and non-retained users", async () => {
    const { calls, tx } = recordingTx();
    await wipeMarketplace(tx as never, ["keep-1", "keep-2"]);
    await wipeRemainingDealerProfiles(tx as never);
    expect(calls).toContainEqual({ table: "listing", where: null });
    expect(calls).toContainEqual({ table: "dealerPreviewPack", where: null });
    expect(calls).toContainEqual({
      table: "user",
      where: { id: { notIn: ["keep-1", "keep-2"] } },
    });
    expect(calls.filter((call) => call.table === "dealerProfile")).toEqual([
      { table: "dealerProfile", where: { userId: { notIn: ["keep-1", "keep-2"] } } },
      { table: "dealerProfile", where: null },
    ]);
    expect(calls.some((call) => call.table === "waitlistUser")).toBe(false);
    expect(calls.some((call) => call.table === "vehicleModelAlias")).toBe(false);
  });
});

describe("PREVIEW-PRESERVE-001", () => {
  it("hashes complete preserved rows including aliases and rolls back on mismatch", async () => {
    const narrower = fingerprintPreserveRows({
      waitlist: [{ id: "w1", email: "wait@example.im" }],
      content: [{ id: "c1", slug: "about" }],
      settings: [{ key: "site", value: { a: 1 } }],
      regions: [{ id: "r1", slug: "iom-east" }],
      categories: [{ id: "cat1", slug: "car" }],
      attributes: [{ id: "a1", slug: "make", categoryId: "cat1" }],
      vehicleMakes: [{ id: "m1", normalizedName: "ford" }],
      vehicleModels: [{ id: "mo1", normalizedName: "focus" }],
      vehicleAliases: [],
    });
    expect(narrower.waitlist).not.toBe(PRESERVE.waitlist);
    expect(narrower.content).not.toBe(PRESERVE.content);
    expect(narrower.vehicleAliases).not.toBe(PRESERVE.vehicleAliases);

    const empty = {
      content: [],
      settings: [],
      regions: [],
      categories: [],
      attributes: [],
      vehicleMakes: [],
      vehicleModels: [],
      vehicleAliases: [],
    };
    const nullDeleted = fingerprintPreserveRows({
      ...empty,
      waitlist: [{ id: "w1", email: "wait@example.im", deletedAt: null, deletionReason: null }],
    });
    const blankDeleted = fingerprintPreserveRows({
      ...empty,
      waitlist: [{ id: "w1", email: "wait@example.im", deletedAt: "", deletionReason: "" }],
    });
    const missingDeleted = fingerprintPreserveRows({
      ...empty,
      waitlist: [{ id: "w1", email: "wait@example.im" }],
    });
    expect(nullDeleted.waitlist).not.toBe(blankDeleted.waitlist);
    expect(nullDeleted.waitlist).not.toBe(missingDeleted.waitlist);
    expect(blankDeleted.waitlist).not.toBe(missingDeleted.waitlist);
    const nullMeta = fingerprintPreserveRows({
      ...empty,
      waitlist: [],
      content: [{ id: "c1", slug: "about", metaTitle: null, metaDescription: null }],
    });
    const blankMeta = fingerprintPreserveRows({
      ...empty,
      waitlist: [],
      content: [{ id: "c1", slug: "about", metaTitle: "", metaDescription: "" }],
    });
    expect(nullMeta.content).not.toBe(blankMeta.content);

    const mutated = {
      ...PRESERVE,
      waitlist: fingerprintPreserveRows({
        waitlist: [{ id: "w1", email: "changed@example.im", interests: ["cars"] }],
        content: [],
        settings: [],
        regions: [],
        categories: [],
        attributes: [],
        vehicleMakes: [],
        vehicleModels: [],
        vehicleAliases: [],
      }).waitlist,
    };
    expect(() => assertFingerprintsMatch(PRESERVE, mutated)).toThrow(
      "waitlist fingerprint changed",
    );

    let committed = false;
    const store = { seeded: false };
    await expect(
      applyPreviewRebuildInTransaction({
        transaction: async (work) => {
          store.seeded = false;
          try {
            const result = await work({} as never);
            committed = true;
            return result;
          } catch (error) {
            store.seeded = false;
            throw error;
          }
        },
        apply: async () => {
          store.seeded = true;
        },
        loadFingerprint: async () => mutated,
        before: PRESERVE,
      }),
    ).rejects.toThrow("waitlist fingerprint changed");
    expect(committed).toBe(false);
    expect(store.seeded).toBe(false);
  });
});

describe("PREVIEW-ATOMIC-001", () => {
  it("uses the rebuild transaction helper and rolls back when apply throws", async () => {
    const ops: string[] = [];
    await expect(
      applyPreviewRebuildInTransaction({
        transaction: async (work) => {
          try {
            return await work({} as never);
          } catch (error) {
            ops.push("rollback");
            throw error;
          }
        },
        apply: async () => {
          ops.push("apply");
        },
        loadFingerprint: async () => PRESERVE,
        before: PRESERVE,
        failAfterApply: true,
      }),
    ).rejects.toThrow("injected");
    expect(ops).toEqual(["apply", "rollback"]);

    const runner = readFileSync(join(process.cwd(), "scripts", "preview-rebuild.ts"), "utf8");
    expect(runner).toContain("applyPreviewRebuildInTransaction");
    expect(runner).toContain("loadFingerprint: loadPreserveFingerprint");
    expect(runner).toContain("before,");
  });
});

describe("PREVIEW-VOLUME-001 PREVIEW-DATES-001 PREVIEW-MEDIA-001 PREVIEW-COPY-001", () => {
  const plan = buildMarketplacePlan({
    preservedDealers: [],
    preservedUsers: [
      { id: "admin-1", email: "admin@mpdee.co.uk", name: "Admin", role: "ADMIN" },
      { id: "admin-2", email: "d.p.marshall@hotmail.co.uk", name: "Dave", role: "ADMIN" },
    ],
    now: NOW,
  });

  it("matches approved volume, dates, media, and copy rules", () => {
    const total = plan.listings.length;
    const share = (category: "car" | "van" | "motorbike" | "motorhome") =>
      plan.listings.filter((listing) => listing.category === category).length / total;
    expect(share("car")).toBeGreaterThanOrEqual(0.65);
    expect(share("car")).toBeLessThanOrEqual(0.75);
    expect(share("van")).toBeGreaterThanOrEqual(0.12);
    expect(share("van")).toBeLessThanOrEqual(0.18);
    expect(share("motorbike")).toBeGreaterThanOrEqual(0.08);
    expect(share("motorbike")).toBeLessThanOrEqual(0.12);
    expect(share("motorhome")).toBeGreaterThanOrEqual(0.03);
    expect(share("motorhome")).toBeLessThanOrEqual(0.07);

    const live = plan.listings.filter((listing) => listing.status === "LIVE");
    expect(live.every((listing) => listing.daysAgo <= LIVE_MAX_AGE_DAYS)).toBe(true);
    expect(
      live.every(
        (listing) =>
          listing.expiresOffsetDays === LISTING_DURATION_DAYS - listing.daysAgo,
      ),
    ).toBe(true);
    expect(accountDaysAgo(0)).toBeGreaterThanOrEqual(200);
    expect(accountDaysAgo(20)).toBeLessThanOrEqual(360);
    const sold = plan.listings.filter((listing) => listing.status === "SOLD");
    expect(
      sold.every(
        (listing) =>
          typeof listing.soldDaysAgo === "number" && listing.soldDaysAgo < listing.daysAgo,
      ),
    ).toBe(true);

    for (const listing of plan.listings.filter((row) =>
      ["LIVE", "PENDING", "SOLD"].includes(row.status),
    )) {
      expect(listing.imageUrls.length).toBeGreaterThanOrEqual(2);
      expect(listing.imageUrls.every((url) => url.startsWith("https://images.unsplash.com/"))).toBe(
        true,
      );
    }

    const descriptions = plan.listings.map((listing) => listing.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(
      descriptions.every(
        (text) =>
          !text.toLowerCase().includes("morris") && !text.toLowerCase().includes("ocean motor"),
      ),
    ).toBe(true);
    expect(
      descriptions.every((text) =>
        /Onchan|Douglas|Peel|Ramsey|Port Erin|Castletown|Laxey|Kirk Michael|Ballasalla|Port St Mary|Jurby|Andreas|island|Steam Packet/i.test(
          text,
        ),
      ),
    ).toBe(true);
  });
});

describe("PREVIEW-LIFECYCLE-001", () => {
  it("keeps every status-event chain and timestamp order on valid transitions", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const soldAt = new Date("2026-03-01T00:00:00.000Z");
    const expiresAt = new Date("2026-02-15T00:00:00.000Z");
    for (const status of [
      "DRAFT",
      "PENDING",
      "LIVE",
      "SOLD",
      "EXPIRED",
      "TAKEN_DOWN",
      "REJECTED",
    ] as const) {
      expect(assertStatusEventChain(status).at(-1)?.toStatus).toBe(status);
      const times = listingStatusEventTimes({
        status,
        createdAt,
        soldAt,
        expiresAt,
        now: NOW,
      });
      expect(() => assertStatusEventTimes(times, createdAt)).not.toThrow();
      if (status === "SOLD") expect(times.at(-1)?.getTime()).toBe(soldAt.getTime());
      if (status === "EXPIRED") expect(times.at(-1)?.getTime()).toBe(expiresAt.getTime());
    }
  });
});

describe("PREVIEW-NOMIG-001", () => {
  it("does not introduce migrate, db push, restore, or production-write paths", () => {
    const files = [
      "scripts/preview-rebuild.ts",
      "scripts/preview-rebuild/run.ts",
      "scripts/preview-rebuild/backups.ts",
      "scripts/preview-rebuild/phase.ts",
      "scripts/seed-preview-marketplace.ts",
      "prisma/seed/apply.ts",
      "prisma/seed/catalog-resolve.ts",
    ];
    for (const file of files) {
      expect(findForbiddenRebuildOps(readFileSync(join(process.cwd(), file), "utf8"))).toEqual([]);
    }
  });
});

describe("catalog resolve-only", () => {
  it("reads existing catalog IDs and refuses missing required rows", async () => {
    const tx = {
      region: {
        findMany: async () => [{ id: "r1", slug: "iom-central" }],
      },
      category: {
        findMany: async () => [{ id: "c1", slug: "car" }],
      },
      attributeDefinition: {
        findMany: async () => [],
      },
    };
    await expect(resolveCatalog(tx as never)).rejects.toThrow("Missing catalog region");
  });
});
