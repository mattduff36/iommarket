import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { encodeNetDirectorImageUrl } from "@/scripts/dealer-stock-sync/image-urls";
import { sealPlan } from "@/scripts/dealer-pack-audit-sync/plan-file";
import {
  DEALER_PACK_AUDIT_VERSION,
  REQUIRED_BACKUP_ID,
  type PlannedListing,
  type PreviewPackAuditPlan,
  type ReplacePackAction,
} from "@/scripts/dealer-pack-audit-sync/types";
import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";
import { PREVIEW_CONFIRM_DB } from "@/scripts/dealer-pack-audit-sync/safety";
import {
  assignLiveMatches,
  canonicalizeLiveUrl,
  compareLiveIdentities,
  extractStockId,
  extractStockIdFromUrl,
  identityMismatch,
  isCardBadgeTitle,
  parsePricePence,
  plannedLiveIdentity,
  stockIdsEquivalent,
  titlesMatch,
} from "@/scripts/dealer-pack-audit-sync/live-match";
import {
  assertSafeRemoteImageUrl,
  galleryChecksumDrift,
  inspectLiveImageBytes,
  inspectRemoteImage,
  isPlaceholderImageUrl,
  isSafeRemoteImageUrl,
  liveImagesEquivalent,
  plannedGalleryAlignsWithLive,
  plannedUrlsAreOrderedSubsequence,
} from "@/scripts/dealer-pack-audit-sync/live-quality";
import {
  collectVisibleGallery,
  collectVisibleStockCards,
  type LiveBrowserPage,
  type LiveBrowserSession,
  type VisibleElementSnapshot,
} from "@/scripts/dealer-pack-audit-sync/live-observe";
import {
  CENSUS_DRIFT_HIDE_REASON,
  T1_STOCK_LIST_INACCESSIBLE_REASON,
  applyCensusDriftToListings,
  buildLiveDealerCensus,
  dealerShouldHidePack,
  hidePackReason,
} from "@/scripts/dealer-pack-audit-sync/live-census";
import {
  liveListingFlags,
  resolveLiveListingStatus,
} from "@/scripts/dealer-pack-audit-sync/live-status";
import {
  buildLiveVisualReport,
  liveVisualEvidenceFileName,
  renderLiveVisualReport,
} from "@/scripts/dealer-pack-audit-sync/live-report";
import { runLiveVisualValidation } from "@/scripts/dealer-pack-audit-sync/live-validate";
import {
  parseLiveVisualArgs,
  runLiveVisualCli,
} from "@/scripts/dealer-pack-audit-sync/live-visual";
import {
  liveVisualReportSchema,
  parseLiveVisualReport,
} from "@/scripts/dealer-pack-audit-sync/live-types";
import type { LiveObservedIdentity, LivePlannedIdentity } from "@/scripts/dealer-pack-audit-sync/live-types";

const LIVE_SOURCE_FILES = [
  "scripts/dealer-pack-audit-sync/live-types.ts",
  "scripts/dealer-pack-audit-sync/live-match.ts",
  "scripts/dealer-pack-audit-sync/live-quality.ts",
  "scripts/dealer-pack-audit-sync/live-observe.ts",
  "scripts/dealer-pack-audit-sync/live-census.ts",
  "scripts/dealer-pack-audit-sync/live-status.ts",
  "scripts/dealer-pack-audit-sync/live-report.ts",
  "scripts/dealer-pack-audit-sync/live-validate.ts",
  "scripts/dealer-pack-audit-sync/live-browser.ts",
  "scripts/dealer-pack-audit-sync/live-visual.ts",
];

function pngBytes(width: number, height: number, total = 120_000) {
  const bytes = Buffer.alloc(total);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const GOOD_IMAGE = pngBytes(1200, 800, 120_000);
const VARIANT_IMAGE = pngBytes(1200, 800, 90_000);
const SMALL_IMAGE = pngBytes(64, 64, 24);
const GOOD_CHECKSUM = createHash("sha256").update(GOOD_IMAGE).digest("hex");
const VARIANT_CHECKSUM = createHash("sha256").update(VARIANT_IMAGE).digest("hex");

function plannedListing(overrides: Partial<PlannedListing> = {}): PlannedListing {
  return {
    identityKey: "stockId:abc123",
    sourceUrl: "https://dealer.example/used/abc123",
    listing: {
      title: "2024 Example Car",
      description: "A sufficiently detailed vehicle description.",
      pricePence: 1_299_500,
      categorySlug: "car",
      attributes: { make: "Example" },
      imageUrls: ["https://cdn.example/car.jpg"],
    },
    images: [{
      sourceUrl: "https://cdn.example/car.jpg",
      localPath: null,
      checksum: GOOD_CHECKSUM,
      width: 1200,
      height: 800,
      format: "png",
      bytes: GOOD_IMAGE.length,
      order: 0,
    }],
    findings: [],
    ...overrides,
  };
}

function replaceAction(listings: PlannedListing[] = [plannedListing()]): ReplacePackAction {
  return {
    kind: "replace",
    dealerKey: "dealer-a",
    displayName: "Dealer A",
    sourceRunId: "source-run",
    baseline: {
      packId: "pack-1",
      dealerProfileId: "dealer-1",
      sourceRunId: "old-run",
      enabled: true,
      updatedAt: "2026-09-28T20:00:00.000Z",
      listings: [],
    },
    listings,
    excludedListings: [],
  };
}

function frozenPlan(actions: PreviewPackAuditPlan["actions"] = [replaceAction()]): PreviewPackAuditPlan {
  return sealPlan({
    version: DEALER_PACK_AUDIT_VERSION,
    runId: "run-live-1",
    createdAt: "2026-09-29T21:00:00.000Z",
    target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
    backupId: REQUIRED_BACKUP_ID,
    sourceRunId: "source-run-reviewed",
    adminUserId: "admin-1",
    actionCount: actions.length,
    actions,
  });
}

function observed(overrides: Partial<LiveObservedIdentity> = {}): LiveObservedIdentity {
  return {
    href: "https://dealer.example/used/abc123?utm_source=x",
    canonicalUrl: canonicalizeLiveUrl("https://dealer.example/used/abc123?utm_source=x"),
    stockId: "abc123",
    title: "2024 Example Car £12,995",
    titleReliable: true,
    priceText: "£12,995",
    pricePence: 1_299_500,
    imageSrc: "https://cdn.example/car.jpg",
    ...overrides,
  };
}

function planned(overrides: Partial<LivePlannedIdentity> = {}): LivePlannedIdentity {
  return { ...plannedLiveIdentity(plannedListing()), ...overrides };
}

function snapshot(overrides: Partial<VisibleElementSnapshot> = {}): VisibleElementSnapshot {
  return {
    tag: "a",
    href: "https://dealer.example/used/abc123",
    src: "https://cdn.example/car.jpg",
    currentSrc: "https://cdn.example/car.jpg",
    alt: "2024 Example Car",
    text: "2024 Example Car £12,995",
    visible: true,
    top: 20,
    left: 10,
    width: 320,
    height: 220,
    region: "main",
    ...overrides,
  };
}

type MockPage = {
  status?: number;
  blocked?: boolean;
  title?: string;
  text?: string;
  anchors?: VisibleElementSnapshot[];
  images?: Array<VisibleElementSnapshot & { region?: string }>;
};

function mockBrowser(pages: Record<string, MockPage | MockPage[] | Record<string, unknown>>): LiveBrowserSession {
  let current = "";
  let currentPage: MockPage | undefined;
  const visits = new Map<string, number>();
  const pageAt = (url: string) => {
    const key = canonicalizeLiveUrl(url) ?? url;
    const entry = pages[key] ?? pages[url];
    if (!entry) return undefined;
    const n = visits.get(key) ?? 0;
    if (Array.isArray(entry)) {
      return entry[Math.min(n, entry.length - 1)] as MockPage;
    }
    return entry as MockPage;
  };
  const page: LiveBrowserPage = {
    async goto(url) {
      current = canonicalizeLiveUrl(url) ?? url;
      const found = pageAt(url);
      visits.set(current, (visits.get(current) ?? 0) + 1);
      currentPage = found;
      if (!found) {
        return { ok: false, status: 404, url, title: "", error: "not-found", blocked: false };
      }
      const status = found.status ?? 200;
      const blocked = found.blocked === true;
      return {
        ok: status < 400 && !blocked,
        status,
        url: current,
        title: found.title ?? "",
        error: blocked ? "blocked" : status >= 400 ? `HTTP ${status}` : null,
        blocked,
      };
    },
    async snapshotAnchors() {
      return currentPage?.anchors ?? [];
    },
    async snapshotImages() {
      return currentPage?.images ?? [];
    },
    async clickVisibleLoadMore() {
      return false;
    },
    async pageText() {
      return currentPage?.text ?? "";
    },
    async screenshot() {
      return Buffer.from("shot");
    },
    url: () => current,
    async close() {},
  };
  return {
    async openPage() {
      return page;
    },
    async close() {},
  };
}

function passingPages() {
  return {
    "https://dealer.example/used": {
      title: "Used cars",
      anchors: [snapshot()],
      text: "2024 Example Car £12,995",
    },
    "https://dealer.example/used/abc123": {
      title: "2024 Example Car",
      text: "2024 Example Car £12,995",
      images: [{
        tag: "img",
        href: "https://dealer.example/used/abc123",
        src: "https://cdn.example/car.jpg",
        currentSrc: "https://cdn.example/car.jpg",
        alt: "hero",
        text: "",
        visible: true,
        top: 0,
        left: 0,
        width: 900,
        height: 600,
        region: "gallery",
        ownerHref: "https://dealer.example/used/abc123",
      }],
    },
  };
}

const site = {
  dealerKey: "dealer-a",
  website: "https://dealer.example/",
  stockUrls: ["https://dealer.example/used/"],
};

describe("live visual independence", () => {
  it("does not import extractGalleryFromHtml or classifySnapshot", () => {
    for (const file of LIVE_SOURCE_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/extractGalleryFromHtml|classifySnapshot/);
    }
  });
});

describe("live identity matching", () => {
  it("matches canonical URLs after stripping tracking and slashes", () => {
    expect(canonicalizeLiveUrl("https://Dealer.example/used/abc123/?utm_source=ad#top"))
      .toBe("https://dealer.example/used/abc123");
    const evidence = compareLiveIdentities(planned(), observed());
    expect(evidence.url).toBe(true);
    expect(evidence.assignedBy).toBe("url");
  });

  it("matches stock-id and title-price when URL differs", () => {
    expect(extractStockId("sourceVehicleId:ABC 123", "https://other.example/cars?id=ABC123"))
      .toBe("abc123");
    expect(parsePricePence("£12,995")).toBe(1_299_500);
    expect(titlesMatch("2024 Example Car", "Example Car 2024 limited")).toBe(true);
    const evidence = compareLiveIdentities(
      planned(),
      observed({
        href: "https://dealer.example/stock/abc123",
        canonicalUrl: "https://dealer.example/stock/abc123",
        title: "2024 Example Car",
      }),
    );
    expect(evidence.assignedBy).toBe("stock-id");
    expect(evidence.price).toBe(true);
  });

  it("assigns one observed card per planned listing and keeps extras", () => {
    const second = planned({
      identityKey: "stockId:zzz",
      sourceUrl: "https://dealer.example/used/zzz",
      canonicalUrl: "https://dealer.example/used/zzz",
      stockId: "zzz",
      title: "2020 Other Van",
      pricePence: 500_000,
    });
    const extra = observed({
      href: "https://dealer.example/used/extra",
      canonicalUrl: "https://dealer.example/used/extra",
      stockId: "extra",
      title: "Spare",
      pricePence: 100,
    });
    const { assignments, extraObserved } = assignLiveMatches(
      [planned(), second],
      [observed(), extra],
    );
    expect(assignments[0]?.match.assignedBy).toBe("url");
    expect(assignments[1]?.observed).toBeNull();
    expect(extraObserved).toHaveLength(1);
  });

  it("flags title and price conflicts only when observed values disagree", () => {
    const conflict = compareLiveIdentities(
      planned(),
      observed({ title: "2018 Unrelated Bike", pricePence: 100 }),
    );
    expect(conflict.titleConflict).toBe(true);
    expect(conflict.priceConflict).toBe(true);
  });

  it("treats numeric, id-N, N-seo, and inventory/slug stock ids as equivalent", () => {
    expect(stockIdsEquivalent("79184928", "id-79184928")).toBe(true);
    expect(stockIdsEquivalent("21911132", "21911132-ford-kuga")).toBe(true);
    expect(stockIdsEquivalent(
      "inventory/2019-bmw-3-series-330i-m-sport",
      "2019-bmw-3-series-330i-m-sport",
    )).toBe(true);
    expect(extractStockIdFromUrl("https://swiftmotors.net/used-vehicle-details/used-mercedes-benz-glb/id-79184928/"))
      .toBe("79184928");
    expect(extractStockIdFromUrl("https://www.oceanford.com/used-cars/21911132-kuga-st-line/"))
      .toBe("21911132");
    expect(stockIdsEquivalent("abc123", "abc1234")).toBe(false);
    expect(stockIdsEquivalent("79184928", "79184929")).toBe(false);
    expect(isCardBadgeTitle("COMING SOON")).toBe(true);
    expect(isCardBadgeTitle("AVAILABLE")).toBe(true);
    expect(isCardBadgeTitle("SOLD £12,995")).toBe(true);
    expect(isCardBadgeTitle("2024 Example Car")).toBe(false);
  });

  it("does not invalidate an exact URL match for formatting-only stock or badge titles", () => {
    const swiftUrl = "https://swiftmotors.net/used-vehicle-details/used-mercedes-benz-glb/id-79184928/";
    const sameUrl = compareLiveIdentities(
      planned({
        identityKey: "sourceVehicleId:79184928",
        sourceUrl: swiftUrl,
        canonicalUrl: canonicalizeLiveUrl(swiftUrl),
        stockId: "79184928",
        title: "2021 Mercedes-Benz GLB",
      }),
      observed({
        href: swiftUrl,
        canonicalUrl: canonicalizeLiveUrl(swiftUrl),
        stockId: "id-79184928",
        title: "COMING SOON",
        titleReliable: true,
        pricePence: 2_445_000,
      }),
    );
    expect(sameUrl.url).toBe(true);
    expect(sameUrl.stockId).toBe(true);
    expect(sameUrl.stockIdConflict).toBe(false);
    expect(sameUrl.titleConflict).toBe(false);
    expect(sameUrl.assignedBy).toBe("url");

    const differentVehicle = compareLiveIdentities(
      planned({
        identityKey: "sourceVehicleId:79184928",
        sourceUrl: swiftUrl,
        canonicalUrl: canonicalizeLiveUrl(swiftUrl),
        stockId: "79184928",
        title: "2021 Mercedes-Benz GLB",
      }),
      observed({
        href: "https://swiftmotors.net/used-vehicle-details/used-audi-a3/id-99999999/",
        canonicalUrl: canonicalizeLiveUrl("https://swiftmotors.net/used-vehicle-details/used-audi-a3/id-99999999/"),
        stockId: "99999999",
        title: "2018 Audi A3",
        titleReliable: true,
        pricePence: 1_000_000,
      }),
    );
    expect(differentVehicle.url).toBe(false);
    expect(differentVehicle.stockIdConflict).toBe(true);
    expect(differentVehicle.titleConflict).toBe(true);

    const longTdUrl =
      "https://www.tdcar.im/inventory/2015-volkswagen-golf-2-0-tsi-bluemotion-tech-r-dsg-4motion-euro-6-s-s-5dr";
    const exactLongUrl = compareLiveIdentities(
      planned({
        canonicalUrl: canonicalizeLiveUrl(longTdUrl),
        stockId:
          "inventory/2015-volkswagen-golf-2-0-tsi-bluemotion-tech-r-dsg-4motion-euro-6-s-s-5dr",
      }),
      observed({
        href: longTdUrl,
        canonicalUrl: canonicalizeLiveUrl(longTdUrl),
        stockId: "inventory",
        title: "COMING SOON",
        titleReliable: false,
      }),
    );
    expect(exactLongUrl.stockIdConflict).toBe(true);
    expect(exactLongUrl.assignedBy).toBe("url");
    expect(identityMismatch(exactLongUrl)).toBe(false);
  });
});

describe("live observation and quality", () => {
  it("reads visible stock cards and preserves rendered gallery DOM order", () => {
    const cards = collectVisibleStockCards([
      snapshot(),
      snapshot({ href: "https://dealer.example/used/abc123?utm_medium=cpc", top: 80 }),
      snapshot({ visible: false, href: "https://dealer.example/hidden" }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.stockId).toBe("abc123");
    const gallery = collectVisibleGallery([
      { ...snapshot({ tag: "img", href: null, src: "https://cdn.example/b.jpg", currentSrc: "https://cdn.example/b.jpg", top: 40, region: "gallery" }), width: 800, height: 500 },
      { ...snapshot({ tag: "img", href: null, src: "https://cdn.example/a.jpg", currentSrc: "https://cdn.example/a.jpg", top: 0, region: "gallery" }), width: 800, height: 500 },
    ]);
    expect(gallery.heroSrc).toBe("https://cdn.example/b.jpg");
    expect(gallery.gallerySrcs).toEqual([
      "https://cdn.example/b.jpg",
      "https://cdn.example/a.jpg",
    ]);
  });

  it("checksums safe remote images and flags placeholders", () => {
    expect(isSafeRemoteImageUrl("file:///etc/passwd")).toBe(false);
    expect(() => assertSafeRemoteImageUrl("javascript:alert(1)")).toThrow("unsafe");
    expect(isPlaceholderImageUrl("https://cdn.example/placeholder-noimage.png")).toBe(true);
    expect(
      isPlaceholderImageUrl(
        encodeNetDirectorImageUrl({
          key: "ndstock/images/NDS21673655_TMN823D_2.jpg",
          edits: { resize: { width: 600, height: 450 } },
        }),
      ),
    ).toBe(false);
    expect(
      isPlaceholderImageUrl(
        encodeNetDirectorImageUrl({ key: "ndstock/images/waiting-for-image.jpg" }),
      ),
    ).toBe(true);
    const good = inspectLiveImageBytes("https://cdn.example/car.jpg", GOOD_IMAGE);
    expect(good.checksum).toBe(GOOD_CHECKSUM);
    expect(good.placeholder).toBe(false);
    const small = inspectLiveImageBytes("https://cdn.example/tiny.png", SMALL_IMAGE);
    expect(small.placeholder).toBe(true);
    expect(small.reasons.some((reason) => reason.startsWith("placeholder-"))).toBe(true);
    expect(galleryChecksumDrift([GOOD_CHECKSUM], [GOOD_CHECKSUM])).toBe(false);
    expect(galleryChecksumDrift([GOOD_CHECKSUM], ["other"])).toBe(true);
    expect(galleryChecksumDrift([GOOD_CHECKSUM], [GOOD_CHECKSUM, "extra"])).toBe(false);
    expect(galleryChecksumDrift([GOOD_CHECKSUM], [null])).toBe(false);
    expect(liveImagesEquivalent(
      "https://cdn.example/car.jpg",
      "https://cdn.example/car-1200x800.jpg",
      canonicalizeLiveUrl,
    )).toBe(true);
    expect(plannedGalleryAlignsWithLive({
      plannedUrls: ["https://cdn.example/car.jpg"],
      observedUrls: ["https://cdn.example/car.jpg", "https://cdn.example/extra.jpg"],
      plannedChecksums: [GOOD_CHECKSUM],
      observedChecksums: [GOOD_CHECKSUM, "extra"],
      canonicalize: canonicalizeLiveUrl,
    })).toBe(true);
    expect(plannedGalleryAlignsWithLive({
      plannedUrls: ["https://cdn.example/car.jpg"],
      observedUrls: ["https://cdn.example/car-1200x800.jpg"],
      observedAltUrls: ["https://cdn.example/car.jpg"],
      plannedChecksums: [GOOD_CHECKSUM],
      observedChecksums: [VARIANT_CHECKSUM],
      canonicalize: canonicalizeLiveUrl,
    })).toBe(true);
    expect(plannedGalleryAlignsWithLive({
      plannedUrls: [
        "https://cdn.example/1.jpg",
        "https://cdn.example/2.jpg",
        "https://cdn.example/3.jpg",
      ],
      observedUrls: [
        "https://cdn.example/1.jpg",
        "https://cdn.example/3.jpg",
      ],
      plannedChecksums: ["one", "two", "three"],
      observedChecksums: ["one", "three"],
      canonicalize: canonicalizeLiveUrl,
    })).toBe(true);
    expect(plannedGalleryAlignsWithLive({
      plannedUrls: [
        "https://cdn.example/1.jpg",
        "https://cdn.example/2.jpg",
        "https://cdn.example/3.jpg",
      ],
      observedUrls: [
        "https://cdn.example/1.jpg",
        "https://cdn.example/3.jpg",
        "https://cdn.example/2.jpg",
      ],
      plannedChecksums: ["one", "two", "three"],
      observedChecksums: ["one", "three", "two"],
      canonicalize: canonicalizeLiveUrl,
    })).toBe(false);
    expect(plannedUrlsAreOrderedSubsequence(
      ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      [
        "https://cdn.example/lead.jpg",
        "https://cdn.example/a.jpg",
        "https://cdn.example/mid.jpg",
        "https://cdn.example/b.jpg",
        "https://cdn.example/tail.jpg",
      ],
      canonicalizeLiveUrl,
    )).toBe(true);
    expect(plannedGalleryAlignsWithLive({
      plannedUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      observedUrls: [
        "https://cdn.example/lead.jpg",
        "https://cdn.example/a-1200x800.jpg",
        "https://cdn.example/mid.jpg",
        "https://cdn.example/b.jpg",
      ],
      observedAltUrls: [null, "https://cdn.example/a.jpg", null, null],
      plannedChecksums: [GOOD_CHECKSUM, VARIANT_CHECKSUM],
      observedChecksums: ["lead", VARIANT_CHECKSUM, "mid", GOOD_CHECKSUM],
      canonicalize: canonicalizeLiveUrl,
    })).toBe(false);
    expect(plannedGalleryAlignsWithLive({
      plannedUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      observedUrls: ["https://cdn.example/b.jpg", "https://cdn.example/a.jpg"],
      plannedChecksums: [GOOD_CHECKSUM, VARIANT_CHECKSUM],
      observedChecksums: [VARIANT_CHECKSUM, GOOD_CHECKSUM],
      canonicalize: canonicalizeLiveUrl,
    })).toBe(false);
    expect(galleryChecksumDrift(
      [GOOD_CHECKSUM, VARIANT_CHECKSUM],
      ["lead", GOOD_CHECKSUM, "mid", VARIANT_CHECKSUM],
    )).toBe(false);
  });

  it("uses the injectable fetcher and never requires a network", async () => {
    const signal = await inspectRemoteImage("https://cdn.example/car.jpg", async (url) => ({
      url,
      bytes: GOOD_IMAGE,
      contentType: "image/png",
      status: 200,
    }));
    expect(signal.checksum).toBe(GOOD_CHECKSUM);
    const denied = await inspectRemoteImage("data:image/png;base64,xx", async () => {
      throw new Error("should-not-fetch");
    });
    expect(denied.qualityError).toBe("unsafe-url");
  });
});

describe("live census, status, and reports", () => {
  it("computes T0/T1 census drift and hides inaccessible packs", () => {
    const extrasOnly = buildLiveDealerCensus({
      dealerKey: "dealer-a",
      plannedCount: 2,
      matchedCount: 2,
      extraObservedCount: 1,
      t0Accessible: true,
      t0PageUrl: "https://dealer.example/used",
      t0CardCount: 3,
      t1Attempted: 2,
      t1AccessibleCount: 2,
      t1InaccessibleCount: 0,
      t1ListAccessible: true,
      t1ListCardCount: 3,
    });
    expect(extrasOnly.drift).toBe(false);
    const disappeared = buildLiveDealerCensus({
      dealerKey: "dealer-a",
      plannedCount: 2,
      matchedCount: 2,
      extraObservedCount: 0,
      t0Accessible: true,
      t0PageUrl: "https://dealer.example/used",
      t0CardCount: 2,
      t1Attempted: 2,
      t1AccessibleCount: 2,
      t1InaccessibleCount: 0,
      t1ListAccessible: true,
      t1ListCardCount: 1,
      cardDeltas: { added: [], removed: ["https://dealer.example/used/gone"], unchanged: 1 },
    });
    expect(disappeared.drift).toBe(true);
    expect(buildLiveDealerCensus({
      dealerKey: "dealer-a",
      plannedCount: 1,
      matchedCount: 1,
      extraObservedCount: 0,
      t0Accessible: true,
      t0PageUrl: "https://dealer.example/used",
      t0CardCount: 1,
      t1Attempted: 1,
      t1AccessibleCount: 1,
      t1InaccessibleCount: 0,
      t1ListAccessible: true,
      t1ListCardCount: 0,
      cardDeltas: {
        added: [],
        removed: ["https://dealer.example/used/abc123"],
        unchanged: 0,
      },
    }).drift).toBe(false);
    expect(dealerShouldHidePack({
      t0Accessible: false,
      t1AccessibleCount: 0,
      plannedCount: 1,
      inaccessibleListings: 1,
    })).toBe(true);
    expect(dealerShouldHidePack({
      t0Accessible: false,
      t1AccessibleCount: 1,
      plannedCount: 1,
      inaccessibleListings: 0,
      t1ListAccessible: true,
    })).toBe(false);
    expect(dealerShouldHidePack({
      t0Accessible: true,
      t1AccessibleCount: 1,
      plannedCount: 1,
      inaccessibleListings: 0,
      censusDrift: true,
    })).toBe(false);
    expect(hidePackReason({
      hidePack: true,
      t0Accessible: true,
      inaccessibleListings: 0,
      censusDrift: true,
    })).toBe(CENSUS_DRIFT_HIDE_REASON);
    expect(dealerShouldHidePack({
      t0Accessible: true,
      t1AccessibleCount: 1,
      plannedCount: 1,
      inaccessibleListings: 0,
      t1ListAccessible: false,
    })).toBe(false);
    expect(dealerShouldHidePack({
      t0Accessible: true,
      t1AccessibleCount: 0,
      plannedCount: 1,
      inaccessibleListings: 1,
      t1ListAccessible: false,
    })).toBe(true);
    expect(hidePackReason({
      hidePack: true,
      t0Accessible: true,
      inaccessibleListings: 1,
      t1ListAccessible: false,
    })).toBe(T1_STOCK_LIST_INACCESSIBLE_REASON);
    expect(applyCensusDriftToListings([{
      identityKey: "stockId:abc123",
      status: "pass",
      hidePack: false,
      planned: planned(),
      observed: observed(),
      match: compareLiveIdentities(planned(), observed()),
      heroSrc: "https://cdn.example/car.jpg",
      gallerySrcs: ["https://cdn.example/car.jpg"],
      imageSignals: [],
      findings: [],
      evidencePaths: { stockCard: null, detail: null, images: [] },
    }], true)[0]).toMatchObject({
      status: "drift",
      hidePack: true,
      findings: [CENSUS_DRIFT_HIDE_REASON],
    });
    expect(applyCensusDriftToListings([{
      identityKey: "stockId:abc123",
      status: "pass",
      hidePack: false,
      planned: planned(),
      observed: observed(),
      match: compareLiveIdentities(planned(), observed()),
      heroSrc: "https://cdn.example/car.jpg",
      gallerySrcs: ["https://cdn.example/car.jpg"],
      imageSignals: [],
      findings: [],
      evidencePaths: { stockCard: null, detail: null, images: [] },
    }], true, ["https://dealer.example/used/other"])[0]?.status).toBe("pass");
    expect(resolveLiveListingStatus({
      inaccessible: false,
      empty: false,
      placeholder: false,
      mismatch: false,
      drift: false,
    })).toBe("pass");
  });

  it("prefers inaccessible, empty, placeholder, mismatch, then drift", () => {
    expect(resolveLiveListingStatus({
      inaccessible: true,
      empty: true,
      placeholder: true,
      mismatch: true,
      drift: true,
    })).toBe("inaccessible");
    expect(resolveLiveListingStatus({
      inaccessible: false,
      empty: true,
      placeholder: true,
      mismatch: true,
      drift: true,
    })).toBe("empty");
    expect(liveListingFlags({
      pageInaccessible: false,
      observed: true,
      galleryCount: 1,
      placeholder: true,
      match: compareLiveIdentities(planned(), observed()),
      imageDrift: true,
      censusDrift: false,
    }).placeholder).toBe(true);
  });

  it("renders JSON and markdown reports with evidence paths", () => {
    const report = buildLiveVisualReport({
      runId: "run-live-1",
      planFingerprint: "abc",
      createdAt: "2026-09-29T21:00:00.000Z",
      dealers: [{
        dealerKey: "dealer-a",
        displayName: "Dealer A",
        actionKind: "replace",
        hidePack: true,
        hideReason: "listing-inaccessible",
        evidenceDir: "live-visual/dealer-a",
        census: buildLiveDealerCensus({
          dealerKey: "dealer-a",
          plannedCount: 1,
          matchedCount: 0,
          extraObservedCount: 0,
          t0Accessible: false,
          t0PageUrl: null,
          t0CardCount: 0,
          t1Attempted: 1,
          t1AccessibleCount: 0,
          t1InaccessibleCount: 1,
          evidencePaths: { t0: "live-visual/dealer-a/t0-stock.png", t1: [], t1List: null },
        }),
        listings: [{
          identityKey: "stockId:abc123",
          status: "inaccessible",
          hidePack: true,
          planned: planned(),
          observed: null,
          match: {
            url: false,
            stockId: false,
            title: false,
            price: false,
            stockIdConflict: false,
            titleConflict: false,
            priceConflict: false,
            assignedBy: null,
          },
          heroSrc: null,
          gallerySrcs: [],
          imageSignals: [],
          findings: ["detail-inaccessible"],
          evidencePaths: {
            stockCard: "live-visual/dealer-a/t0-stock.png",
            detail: null,
            images: [],
          },
        }],
      }],
    });
    expect(report.ok).toBe(false);
    expect(report.hidePackCount).toBe(1);
    expect(liveVisualReportSchema.parse(report).hidePackCount).toBe(1);
    const tampered = structuredClone(report);
    tampered.hidePackCount = 0;
    expect(() => parseLiveVisualReport(tampered)).toThrow(
      "Live visual report fingerprint mismatch",
    );
    const markdown = renderLiveVisualReport(report);
    expect(markdown).toContain("Hide pack: yes");
    expect(markdown).toContain("live-visual/dealer-a/t0-stock.png");
    expect(markdown).toContain("T0 census:");
    expect(markdown).toContain("T1 census:");
  });
});

describe("live visual validation against a frozen plan", () => {
  it("passes a matching rendered listing and keeps the pack visible", async () => {
    const plan = frozenPlan();
    const written: string[] = [];
    const report = await runLiveVisualValidation({
      plan,
      deps: {
        browser: mockBrowser(passingPages()),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => site,
        evidence: {
          async write(relPath) {
            written.push(relPath);
            return relPath;
          },
        },
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(report.planFingerprint).toBe(plan.fingerprint);
    expect(report.dealers[0]?.hidePack).toBe(false);
    expect(report.dealers[0]?.listings[0]?.status).toBe("pass");
    expect(report.ok).toBe(true);
    expect(written.some((path) => path.includes("t0-stock"))).toBe(true);
    expect(written.some((path) => path.includes("t1-"))).toBe(true);
  });

  it("does not pass when rendered image bytes cannot be verified", async () => {
    const report = await runLiveVisualValidation({
      plan: frozenPlan(),
      deps: {
        browser: mockBrowser(passingPages()),
        fetchImage: async (url) => ({ url, error: "fetch-failed" }),
        resolveSite: () => site,
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(report.dealers[0]?.listings[0]?.status).toBe("unverified");
    expect(report.dealers[0]?.listings[0]?.findings).toContain(
      "unverified-image-evidence",
    );
    expect(report.ok).toBe(false);
  });

  it("classifies mismatch, placeholder, empty, drift, and inaccessible hide-pack", async () => {
    const mismatchListing = plannedListing({
      identityKey: "stockId:mis",
      sourceUrl: "https://dealer.example/used/mis",
    });
    const placeholderListing = plannedListing({
      identityKey: "stockId:ph",
      sourceUrl: "https://dealer.example/used/ph",
      images: [{
        ...plannedListing().images[0]!,
        sourceUrl: "https://cdn.example/placeholder-noimage.png",
        checksum: "x",
      }],
    });
    const emptyListing = plannedListing({
      identityKey: "stockId:empty",
      sourceUrl: "https://dealer.example/used/empty",
    });
    const driftListing = plannedListing({
      identityKey: "stockId:drift",
      sourceUrl: "https://dealer.example/used/drift",
    });
    const hiddenPlan = frozenPlan([
      replaceAction([mismatchListing]),
      {
        ...replaceAction([placeholderListing]),
        dealerKey: "dealer-ph",
        displayName: "Placeholder Dealer",
      },
      {
        ...replaceAction([emptyListing]),
        dealerKey: "dealer-empty",
        displayName: "Empty Dealer",
      },
      {
        ...replaceAction([driftListing]),
        dealerKey: "dealer-drift",
        displayName: "Drift Dealer",
      },
      {
        ...replaceAction([plannedListing()]),
        dealerKey: "dealer-down",
        displayName: "Down Dealer",
      },
    ]);

    const pages = {
      "https://dealer.example/used": {
        anchors: [
          snapshot({ href: "https://dealer.example/used/mis", text: "2010 Wrong Bike £1,000" }),
        ],
      },
      "https://dealer.example/used/mis": {
        text: "2010 Wrong Bike £1,000",
        images: [{
          tag: "img",
          href: null,
          src: "https://cdn.example/car.jpg",
          currentSrc: "https://cdn.example/car.jpg",
          alt: "",
          text: "",
          visible: true,
          top: 0,
          left: 0,
          width: 900,
          height: 600,
          region: "gallery",
        }],
      },
      "https://ph.example/used": {
        anchors: [snapshot({ href: "https://dealer.example/used/ph" })],
      },
      "https://dealer.example/used/ph": {
        images: [{
          tag: "img",
          href: "https://dealer.example/used/ph",
          src: "https://cdn.example/placeholder-noimage.png",
          currentSrc: "https://cdn.example/placeholder-noimage.png",
          alt: "",
          text: "",
          visible: true,
          top: 0,
          left: 0,
          width: 900,
          height: 600,
          region: "gallery",
          ownerHref: "https://dealer.example/used/ph",
        }],
      },
      "https://empty.example/used": {
        anchors: [snapshot({ href: "https://dealer.example/used/empty", src: null, currentSrc: null })],
      },
      "https://dealer.example/used/empty": {
        images: [],
        text: "2024 Example Car £12,995",
      },
      "https://drift.example/used": {
        anchors: [
          snapshot({ href: "https://dealer.example/used/drift" }),
          snapshot({ href: "https://dealer.example/used/extra", text: "Extra £9,000" }),
        ],
      },
      "https://dealer.example/used/drift": {
        images: [
          {
            tag: "img",
            href: null,
            src: "https://cdn.example/second.jpg",
            currentSrc: "https://cdn.example/second.jpg",
            alt: "",
            text: "",
            visible: true,
            top: 0,
            left: 0,
            width: 900,
            height: 600,
            region: "gallery",
          },
          {
            tag: "img",
            href: null,
            src: "https://cdn.example/car.jpg",
            currentSrc: "https://cdn.example/car.jpg",
            alt: "",
            text: "",
            visible: true,
            top: 10,
            left: 0,
            width: 900,
            height: 600,
            region: "gallery",
          },
        ],
      },
    };

    const fetchImage = async (url: string) => {
      if (url.includes("placeholder")) {
        return { url, bytes: SMALL_IMAGE, contentType: "image/png", status: 200 };
      }
      return { url, bytes: GOOD_IMAGE, contentType: "image/png", status: 200 };
    };

    const resolveSite = (dealerKey: string) => {
      if (dealerKey === "dealer-ph") {
        return { dealerKey, website: null, stockUrls: ["https://ph.example/used/"] };
      }
      if (dealerKey === "dealer-empty") {
        return { dealerKey, website: null, stockUrls: ["https://empty.example/used/"] };
      }
      if (dealerKey === "dealer-drift") {
        return { dealerKey, website: null, stockUrls: ["https://drift.example/used/"] };
      }
      if (dealerKey === "dealer-down") {
        return { dealerKey, website: null, stockUrls: ["https://down.example/used/"] };
      }
      return site;
    };

    const report = await runLiveVisualValidation({
      plan: hiddenPlan,
      deps: {
        browser: mockBrowser(pages),
        fetchImage,
        resolveSite,
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });

    const byKey = Object.fromEntries(report.dealers.map((dealer) => [dealer.dealerKey, dealer]));
    expect(byKey["dealer-a"]?.listings[0]?.status).toBe("mismatch");
    expect(byKey["dealer-ph"]?.listings[0]?.status).toBe("placeholder");
    expect(byKey["dealer-empty"]?.listings[0]?.status).toBe("empty");
    expect(byKey["dealer-drift"]?.listings[0]?.status).toBe("pass");
    expect(byKey["dealer-drift"]?.hidePack).toBe(false);
    expect(byKey["dealer-drift"]?.census.extraObservedCount).toBeGreaterThan(0);
    expect(byKey["dealer-drift"]?.census.drift).toBe(false);
    expect(byKey["dealer-down"]?.hidePack).toBe(true);
    expect(byKey["dealer-down"]?.listings[0]?.status).toBe("inaccessible");
    expect(byKey["dealer-down"]?.hideReason).toMatch(/inaccessible/);
  });
});

function extraSlideImage() {
  return {
    tag: "img",
    href: "https://dealer.example/used/abc123",
    src: "https://cdn.example/extra.jpg",
    currentSrc: "https://cdn.example/extra.jpg",
    alt: "extra",
    text: "",
    visible: true,
    top: 20,
    left: 0,
    width: 900,
    height: 600,
    region: "gallery" as const,
    ownerHref: "https://dealer.example/used/abc123",
  };
}

describe("live gallery extras, evidence, and schema", () => {
  it("passes extra live slides and CDN currentSrc variants without equal checksums", async () => {
    const written: string[] = [];
    const pages = passingPages() as Record<string, { images?: unknown[] }>;
    const detail = pages["https://dealer.example/used/abc123"] as { images: unknown[] };
    detail.images = [
      { ...extraSlideImage(), top: 0, width: 300, height: 200 },
      {
        tag: "img",
        href: "https://dealer.example/used/abc123",
        src: "https://cdn.example/car.jpg",
        currentSrc: "https://cdn.example/car-1200x800.jpg",
        alt: "hero",
        text: "",
        visible: true,
        top: 10,
        left: 0,
        width: 900,
        height: 600,
        region: "gallery",
        ownerHref: "https://dealer.example/used/abc123",
      },
      {
        ...extraSlideImage(),
        src: "https://cdn.example/after.jpg",
        currentSrc: "https://cdn.example/after.jpg",
        top: 30,
      },
    ];
    const report = await runLiveVisualValidation({
      plan: frozenPlan(),
      deps: {
        browser: mockBrowser(pages),
        fetchImage: async (url) => ({
          url,
          bytes: url.includes("1200x800") ? VARIANT_IMAGE : GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => site,
        evidence: {
          async write(relPath) {
            written.push(relPath);
            return relPath;
          },
        },
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(report.dealers[0]?.listings[0]?.status).toBe("pass");
    expect(report.dealers[0]?.hidePack).toBe(false);
    expect(report.dealers[0]?.listings[0]?.gallerySrcs.length).toBeGreaterThan(1);
    expect(written.some((path) => path.includes("t0-stock"))).toBe(true);
    expect(liveVisualEvidenceFileName({
      dealerKey: "dealer-a",
      kind: "t1-detail",
      identityKey: "stockId:foo/bar",
    })).not.toBe(liveVisualEvidenceFileName({
      dealerKey: "dealer-a",
      kind: "t1-detail",
      identityKey: "stockId:foo_bar",
    }));
    expect(() => liveVisualReportSchema.parse({
      version: 1,
      kind: "live-visual",
      runId: "run-live-1",
      planFingerprint: "abc",
      createdAt: "2026-09-29T21:00:00.000Z",
      ok: true,
      hidePackCount: 0,
      dealers: [{
        dealerKey: "dealer-a",
        displayName: "Dealer A",
        actionKind: "replace",
        hidePack: false,
        hideReason: null,
        evidenceDir: "live-visual/dealer-a",
        listings: [],
      }],
    })).toThrow();
    expect(liveVisualReportSchema.parse(report).ok).toBe(true);
  });

  it("fails closed when a wrong full-size image is the live primary", async () => {
    const pages = passingPages() as Record<string, { images?: unknown[] }>;
    const detail = pages["https://dealer.example/used/abc123"] as { images: unknown[] };
    detail.images = [
      { ...extraSlideImage(), top: 0, width: 900, height: 600 },
      {
        ...extraSlideImage(),
        src: "https://cdn.example/car.jpg",
        currentSrc: "https://cdn.example/car.jpg",
        alt: "planned car",
        top: 10,
        width: 900,
        height: 600,
      },
    ];
    const report = await runLiveVisualValidation({
      plan: frozenPlan(),
      deps: {
        browser: mockBrowser(pages),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => site,
        evidence: { async write(relPath) { return relPath; } },
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });

    expect(report.dealers[0]?.listings[0]).toMatchObject({
      status: "drift",
      findings: expect.arrayContaining(["live-drift"]),
    });
  });

  it("fails closed when a matching live image cannot be fetched or verified", async () => {
    const report = await runLiveVisualValidation({
      plan: frozenPlan(),
      deps: {
        browser: mockBrowser(passingPages()),
        fetchImage: async (url) => ({ url, error: "HTTP 403" }),
        resolveSite: () => site,
        evidence: { async write(relPath) { return relPath; } },
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });

    expect(report.dealers[0]?.listings[0]).toMatchObject({
      status: "unverified",
      findings: expect.arrayContaining([
        "unverified-image-evidence",
        "fetch:HTTP 403",
      ]),
    });
  });
});

describe("live visual CLI", () => {
  it("requires a frozen plan pointer and stays injectable", async () => {
    expect(() => parseLiveVisualArgs([])).toThrow("--run-id or --plan");
    const plan = frozenPlan();
    const written: string[] = [];
    const report = await runLiveVisualCli(
      ["--run-id=run-live-1", "--dealer=dealer-a"],
      {
        readPlan: async () => plan,
        validate: async () => buildLiveVisualReport({
          runId: plan.runId,
          planFingerprint: plan.fingerprint,
          createdAt: "2026-09-29T21:10:00.000Z",
          dealers: [],
        }),
        writeReports: async (value, paths) => {
          written.push(paths.jsonPath, paths.markdownPath);
          return paths;
        },
      },
    );
    expect(report.runId).toBe("run-live-1");
    expect(written).toHaveLength(2);
    expect(written[0]).toContain("live-visual-report.json");
  });
});

describe("live validator dealer regressions", () => {
  const fetchGood = async (url: string) => ({
    url,
    bytes: GOOD_IMAGE,
    contentType: "image/png",
    status: 200,
  });

  it("matches a sourceVehicleId with null sourceUrl and does not mark detail accessible without navigation", async () => {
    const listing = plannedListing({
      identityKey: "sourceVehicleId:79184928",
      sourceUrl: null,
      listing: {
        ...plannedListing().listing,
        title: "2021 Mercedes-Benz GLB",
        pricePence: 2_445_000,
      },
    });
    const cardHref = "https://swiftmotors.net/used-vehicle-details/used-mercedes-benz-glb/id-79184928/";
    const matched = await runLiveVisualValidation({
      plan: frozenPlan([replaceAction([listing])]),
      deps: {
        browser: mockBrowser({
          "https://swiftmotors.net/used-vehicles": {
            anchors: [snapshot({
              href: cardHref,
              text: "2021 Mercedes-Benz GLB £24,450",
              src: "https://bluesky.cdn.imgeng.in/cogstock-images/own-1.jpg",
              currentSrc: "https://bluesky.cdn.imgeng.in/cogstock-images/own-1.jpg",
            })],
          },
          [cardHref]: {
            title: "2021 Mercedes-Benz GLB",
            text: "2021 Mercedes-Benz GLB £24,450",
            images: [{
              tag: "img",
              href: cardHref,
              src: "https://cdn.example/car.jpg",
              currentSrc: "https://cdn.example/car.jpg",
              alt: "hero",
              text: "",
              visible: true,
              top: 0,
              left: 0,
              width: 900,
              height: 600,
              region: "gallery",
              ownerHref: cardHref,
            }],
          },
        }),
        fetchImage: fetchGood,
        resolveSite: () => ({
          dealerKey: "dealer-a",
          website: "https://swiftmotors.net/",
          stockUrls: ["https://swiftmotors.net/used-vehicles/"],
        }),
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(matched.dealers[0]?.listings[0]?.match.assignedBy).toBe("stock-id");
    expect(matched.dealers[0]?.listings[0]?.status).toBe("pass");
    expect(matched.dealers[0]?.census.t1AccessibleCount).toBe(1);

    const unmatched = await runLiveVisualValidation({
      plan: frozenPlan([replaceAction([listing])]),
      deps: {
        browser: mockBrowser({
          "https://swiftmotors.net/used-vehicles": { anchors: [] },
        }),
        fetchImage: fetchGood,
        resolveSite: () => ({
          dealerKey: "dealer-a",
          website: "https://swiftmotors.net/",
          stockUrls: ["https://swiftmotors.net/used-vehicles/"],
        }),
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(unmatched.dealers[0]?.census.t1AccessibleCount).toBe(0);
    expect(unmatched.dealers[0]?.listings[0]?.status).not.toBe("pass");
    expect(unmatched.dealers[0]?.listings[0]?.evidencePaths.detail).toBeNull();
  });

  it("does not visit the homepage after a successful stock URL", async () => {
    const visited: string[] = [];
    const browser = mockBrowser({
      ...passingPages(),
      "https://dealer.example/": {
        anchors: [snapshot({
          href: "https://dealer.example/used/homepage-only",
          text: "Homepage Extra £9,000",
        })],
      },
    });
    const inner = await browser.openPage();
    const tracked: LiveBrowserSession = {
      async openPage() {
        return {
          ...inner,
          async goto(url, options) {
            visited.push(canonicalizeLiveUrl(url) ?? url);
            return inner.goto(url, options);
          },
        };
      },
      close: () => browser.close(),
    };
    const report = await runLiveVisualValidation({
      plan: frozenPlan(),
      deps: {
        browser: tracked,
        fetchImage: fetchGood,
        resolveSite: () => site,
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(report.dealers[0]?.listings[0]?.status).toBe("pass");
    expect(visited.some((url) => url === "https://dealer.example")).toBe(false);
    expect(visited.some((url) => url.startsWith("https://dealer.example/used"))).toBe(true);
  });

  it("validates unmatched NetDirector stock through its derived detail URL", async () => {
    const stockId = "20481102";
    const imageUrl = encodeNetDirectorImageUrl({
      key: `ndstock/images/NDS${stockId}_PMN999K_1.png`,
    });
    const listing = plannedListing({
      identityKey: `sourceVehicleId:${stockId}`,
      sourceUrl: null,
      listing: {
        ...plannedListing().listing,
        title: "2020 Smart Fortwo",
        pricePence: 699_500,
        imageUrls: [imageUrl],
      },
      images: [{
        ...plannedListing().images[0]!,
        sourceUrl: imageUrl,
      }],
    });
    const action: ReplacePackAction = {
      ...replaceAction([listing]),
      dealerKey: "athol-garage",
      displayName: "Athol Garage",
    };
    const detailUrl =
      `https://www.athol.im/used-cars/${stockId}-2020%20Smart%20Fortwo`;
    const report = await runLiveVisualValidation({
      plan: frozenPlan([action]),
      deps: {
        browser: mockBrowser({
          "https://www.athol.im/used-cars": {
            title: "Used cars",
            anchors: [],
            text: "",
          },
          [detailUrl]: {
            title: "2020 Smart Fortwo £6,995",
            text: "2020 Smart Fortwo £6,995",
            images: [snapshot({
              tag: "img",
              href: null,
              src: imageUrl,
              currentSrc: imageUrl,
              alt: "2020 Smart Fortwo",
              text: "",
              width: 900,
              height: 600,
              region: "gallery",
            })],
          },
        }),
        fetchImage: fetchGood,
        resolveSite: () => ({
          dealerKey: "athol-garage",
          website: "https://www.athol.im/",
          stockUrls: ["https://www.athol.im/used-cars/"],
        }),
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });

    expect(report.dealers[0]?.census.t1AccessibleCount).toBe(1);
    expect(report.dealers[0]?.listings[0]?.status).toBe("pass");
    expect(report.dealers[0]?.listings[0]?.observed?.stockId).toBe(stockId);
  });

  it("matches Swift, TD, Ocean, and Athol stock identities without treating extras as drift", async () => {
    const swift = plannedListing({
      identityKey: "sourceVehicleId:79184928",
      sourceUrl: "https://swiftmotors.net/used-vehicle-details/used-mercedes-benz-glb/id-79184928/",
      listing: { ...plannedListing().listing, title: "2021 Mercedes-Benz GLB", pricePence: 2_445_000 },
    });
    const td = plannedListing({
      identityKey: "sourceVehicleId:inventory/2019-bmw-3-series-330i-m-sport",
      sourceUrl: "https://www.tdcar.im/inventory/2019-bmw-3-series-330i-m-sport",
      listing: { ...plannedListing().listing, title: "2019 BMW 3 Series", pricePence: 2_499_000 },
    });
    const ocean = plannedListing({
      identityKey: "sourceVehicleId:21911132",
      sourceUrl: "https://www.oceanford.com/used-cars/21911132/",
      listing: { ...plannedListing().listing, title: "2024 Ford Kuga", pricePence: 2_899_000 },
    });
    const athol = plannedListing({
      identityKey: "sourceVehicleId:19360241",
      sourceUrl: "https://www.athol.im/used-cars/19360241/",
      listing: { ...plannedListing().listing, title: "Kia Sportage", pricePence: 1_899_000 },
    });

    const dealers = [
      {
        key: "swift-motors",
        listing: swift,
        stock: "https://swiftmotors.net/used-vehicles/",
        website: "https://swiftmotors.net/",
        card: snapshot({
          href: swift.sourceUrl,
          text: "COMING SOON £24,450",
          src: "https://bluesky.cdn.imgeng.in/cogstock-images/own-1.jpg",
          currentSrc: "https://bluesky.cdn.imgeng.in/cogstock-images/own-1.jpg",
        }),
        detail: swift.sourceUrl!,
      },
      {
        key: "td-car-centre",
        listing: td,
        stock: "https://www.tdcar.im/inventory",
        website: "https://www.tdcar.im/",
        card: snapshot({
          href: td.sourceUrl,
          text: "2019 BMW 3 Series £24,990",
          src: "https://cdn.tdcar.im/bmw-1.jpg",
          currentSrc: "https://cdn.tdcar.im/bmw-1.jpg",
        }),
        detail: td.sourceUrl!,
      },
      {
        key: "ocean-motor-village",
        listing: ocean,
        stock: "https://www.oceanford.com/used-cars/ocean-ford/",
        website: "https://www.oceanmotorvillage.com/",
        card: snapshot({
          href: "https://www.oceanford.com/used-cars/21911132-kuga-st-line/",
          text: "2024 Ford Kuga £28,990",
          src: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS21911132_1.png",
          currentSrc: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS21911132_1.png",
        }),
        detail: "https://www.oceanford.com/used-cars/21911132-kuga-st-line/",
      },
      {
        key: "athol-garage",
        listing: athol,
        stock: "https://www.athol.im/used-cars/",
        website: "https://www.athol.im/",
        card: snapshot({
          href: athol.sourceUrl,
          text: "AVAILABLE £18,990",
          src: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS19360241_RMN398W_1.png",
          currentSrc: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS19360241_RMN398W_1.png",
        }),
        detail: athol.sourceUrl!,
      },
    ];

    for (const dealer of dealers) {
      const extra = snapshot({
        href: `${new URL(dealer.stock).origin}/used/extra-unplanned`,
        text: "Spare Extra £1,000",
      });
      const report = await runLiveVisualValidation({
        plan: frozenPlan([{
          ...replaceAction([dealer.listing]),
          dealerKey: dealer.key,
          displayName: dealer.key,
        }]),
        deps: {
          browser: mockBrowser({
            [canonicalizeLiveUrl(dealer.stock)!]: {
              anchors: [dealer.card, extra],
            },
            [canonicalizeLiveUrl(dealer.detail)!]: {
              title: dealer.listing.listing.title,
              text: `${dealer.listing.listing.title} £${(dealer.listing.listing.pricePence / 100).toLocaleString("en-GB")}`,
              images: [{
                tag: "img",
                href: dealer.detail,
                src: "https://cdn.example/car.jpg",
                currentSrc: "https://cdn.example/car.jpg",
                alt: "hero",
                text: "",
                visible: true,
                top: 0,
                left: 0,
                width: 900,
                height: 600,
                region: "gallery",
                ownerHref: dealer.detail,
              }],
            },
          }),
          fetchImage: fetchGood,
          resolveSite: () => ({
            dealerKey: dealer.key,
            website: dealer.website,
            stockUrls: [dealer.stock],
          }),
          now: () => "2026-09-29T21:10:00.000Z",
        },
      });
      expect(report.dealers[0]?.listings[0]?.match.assignedBy, dealer.key).not.toBeNull();
      expect(report.dealers[0]?.listings[0]?.status, dealer.key).toBe("pass");
      expect(report.dealers[0]?.census.drift, dealer.key).toBe(false);
      expect(report.dealers[0]?.hidePack, dealer.key).toBe(false);
    }
  });
});
