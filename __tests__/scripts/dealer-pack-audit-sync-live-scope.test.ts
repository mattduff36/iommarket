import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sealPlan } from "@/scripts/dealer-pack-audit-sync/plan-file";
import {
  DEALER_PACK_AUDIT_VERSION,
  REQUIRED_BACKUP_ID,
  type DisablePackAction,
  type PlannedListing,
  type PreviewPackAuditPlan,
  type ReplacePackAction,
} from "@/scripts/dealer-pack-audit-sync/types";
import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";
import { PREVIEW_CONFIRM_DB } from "@/scripts/dealer-pack-audit-sync/safety";
import {
  classifyLiveDomRegion,
  collectStockCardsWithBoundedLoadMore,
  collectVisibleGallery,
  collectVisibleStockCards,
  imageOwnedByListing,
  inspectLiveNavigation,
  preferredImageSrc,
  type LiveBrowserPage,
  type LiveBrowserSession,
  type VisibleElementSnapshot,
} from "@/scripts/dealer-pack-audit-sync/live-observe";
import {
  createLiveRouteHandler,
  decideLiveBrowserRequest,
  installLiveBrowserNetworkGuard,
  type LiveFetchedResponseLike,
  type LiveRouteLike,
} from "@/scripts/dealer-pack-audit-sync/live-network";
import {
  CENSUS_DRIFT_HIDE_REASON,
  T1_STOCK_LIST_INACCESSIBLE_REASON,
} from "@/scripts/dealer-pack-audit-sync/live-census";
import {
  inspectRemoteImage,
  isSafeRemoteImageUrl,
  safeFetchRemoteImage,
} from "@/scripts/dealer-pack-audit-sync/live-quality";
import { wrapPlaywrightPage } from "@/scripts/dealer-pack-audit-sync/live-browser";
import { runLiveVisualValidation } from "@/scripts/dealer-pack-audit-sync/live-validate";
import { canonicalizeLiveUrl } from "@/scripts/dealer-pack-audit-sync/live-match";
import type { Page } from "@playwright/test";

function pngBytes(width: number, height: number, total = 120_000) {
  const bytes = Buffer.alloc(total);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const GOOD_IMAGE = pngBytes(1200, 800, 120_000);
const GOOD_CHECKSUM = createHash("sha256").update(GOOD_IMAGE).digest("hex");

function plannedListing(): PlannedListing {
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
  };
}

function baseline() {
  return {
    packId: "pack-1",
    dealerProfileId: "dealer-1",
    sourceRunId: "old-run",
    enabled: true,
    updatedAt: "2026-09-28T20:00:00.000Z",
    listings: [{
      id: "listing-old",
      userId: "user-1",
      dealerId: "dealer-1",
      previewPackId: "pack-1",
      status: "ADMIN_PREVIEW",
      lifecycleRevision: 1,
      photoRevision: 1,
      updatedAt: "2026-09-28T20:00:00.000Z",
      images: [],
      revisions: [],
    }],
  };
}

function replaceAction(): ReplacePackAction {
  return {
    kind: "replace",
    dealerKey: "dealer-a",
    displayName: "Dealer A",
    sourceRunId: "source-run",
    baseline: baseline(),
    listings: [plannedListing()],
    excludedListings: [],
  };
}

function disableAction(overrides: Partial<DisablePackAction> = {}): DisablePackAction {
  return {
    kind: "disable",
    dealerKey: "dealer-off",
    displayName: "Disabled Dealer",
    sourceRunId: null,
    baseline: baseline(),
    removeListings: true,
    reasons: ["unsafe"],
    excludedListings: [],
    ...overrides,
  };
}

function frozenPlan(actions: PreviewPackAuditPlan["actions"]): PreviewPackAuditPlan {
  return sealPlan({
    version: DEALER_PACK_AUDIT_VERSION,
    runId: "run-live-scope",
    createdAt: "2026-09-29T21:00:00.000Z",
    target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
    backupId: REQUIRED_BACKUP_ID,
    sourceRunId: "source-run-reviewed",
    adminUserId: "admin-1",
    actionCount: actions.length,
    actions,
  });
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
    ownerHref: "https://dealer.example/used/abc123",
    ...overrides,
  };
}

function galleryImage(overrides: Partial<VisibleElementSnapshot> = {}): VisibleElementSnapshot {
  return {
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
    ...overrides,
  };
}

type MockPage = {
  status?: number;
  blocked?: boolean;
  title?: string;
  text?: string;
  anchors?: VisibleElementSnapshot[];
  images?: VisibleElementSnapshot[];
};

function mockBrowser(pages: Record<string, MockPage | MockPage[]>): LiveBrowserSession {
  let current = "";
  let currentPage: MockPage | undefined;
  const visits = new Map<string, number>();
  const pageAt = (url: string) => {
    const key = canonicalizeLiveUrl(url) ?? url;
    const entry = pages[key] ?? pages[url];
    if (!entry) return undefined;
    const n = visits.get(key) ?? 0;
    return Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)] : entry;
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

const site = {
  dealerKey: "dealer-a",
  website: "https://dealer.example/",
  stockUrls: ["https://dealer.example/used/"],
};

describe("live observer scoping", () => {
  it("rejects header logos and arbitrary nav anchors", () => {
    const cards = collectVisibleStockCards([
      snapshot({
        region: "header",
        href: "https://dealer.example/",
        src: "https://cdn.example/logo.png",
        currentSrc: "https://cdn.example/logo.png",
        text: "Dealer Home",
        width: 140,
        height: 48,
      }),
      snapshot({
        region: "nav",
        href: "https://dealer.example/used-cars/",
        src: "https://cdn.example/nav-banner.jpg",
        currentSrc: "https://cdn.example/nav-banner.jpg",
        text: "Used Cars",
      }),
      snapshot({
        region: "main",
        href: "https://dealer.example/contact",
        src: "https://cdn.example/showroom.jpg",
        currentSrc: "https://cdn.example/showroom.jpg",
        text: "Contact us",
      }),
      snapshot(),
    ]);
    expect(cards.map((card) => card.stockId)).toEqual(["abc123"]);
  });

  it("rejects related-stock and chrome images from the detail gallery", () => {
    const gallery = collectVisibleGallery(
      [
        galleryImage(),
        galleryImage({
          src: "https://cdn.example/logo.png",
          currentSrc: "https://cdn.example/logo.png",
          region: "header",
          ownerHref: "https://dealer.example/",
          href: "https://dealer.example/",
        }),
        galleryImage({
          src: "https://cdn.example/related-other.jpg",
          currentSrc: "https://cdn.example/related-other.jpg",
          region: "related",
          ownerHref: "https://dealer.example/used/other99",
          href: "https://dealer.example/used/other99",
        }),
      ],
      {
        listingUrl: "https://dealer.example/used/abc123",
        stockId: "abc123",
        ownerImagePaths: ["/car.jpg"],
      },
    );
    expect(gallery.gallerySrcs).toEqual(["https://cdn.example/car.jpg"]);
  });

  it("rejects a related swiper even when a descendant class looks like a gallery", () => {
    expect(classifyLiveDomRegion(["swiper-slide", "related-vehicles"])).toBe("related");
    const gallery = collectVisibleGallery(
      [
        galleryImage(),
        galleryImage({
          src: "https://cdn.example/related-swiper.jpg",
          currentSrc: "https://cdn.example/related-swiper.jpg",
          region: "gallery",
          ancestorHints: ["swiper-wrapper", "related-stock"],
          ownerHref: "https://dealer.example/used/other99",
          href: "https://dealer.example/used/other99",
        }),
      ],
      {
        listingUrl: "https://dealer.example/used/abc123",
        stockId: "abc123",
        ownerImagePaths: ["/car.jpg"],
      },
    );
    expect(gallery.gallerySrcs).toEqual(["https://cdn.example/car.jpg"]);
  });

  it("matches out-of-gallery stockIds only on token delimiters", () => {
    const scope = {
      listingUrl: "https://dealer.example/used/abc123",
      stockId: "abc123",
      ownerImagePaths: [] as string[],
    };
    expect(imageOwnedByListing("https://cdn.example/vehicles/abc123/hero.jpg", scope)).toBe(true);
    expect(imageOwnedByListing("https://cdn.example/vehicles/abc123-hero.jpg", scope)).toBe(true);
    expect(imageOwnedByListing("https://cdn.example/vehicles/abc1234/hero.jpg", scope)).toBe(false);
    expect(imageOwnedByListing("https://cdn.example/vehicles/xabc123/hero.jpg", scope)).toBe(false);
    const gallery = collectVisibleGallery(
      [
        galleryImage({
          src: "https://cdn.example/vehicles/abc1234/hero.jpg",
          currentSrc: "https://cdn.example/vehicles/abc1234/hero.jpg",
          region: "unknown",
          href: null,
          ownerHref: null,
        }),
        galleryImage({
          src: "https://cdn.example/vehicles/abc123/hero.jpg",
          currentSrc: "https://cdn.example/vehicles/abc123/hero.jpg",
          region: "unknown",
          href: null,
          ownerHref: null,
        }),
      ],
      scope,
    );
    expect(gallery.gallerySrcs).toEqual(["https://cdn.example/vehicles/abc123/hero.jpg"]);
  });

  it("keeps NetDirector hero/thumbs in unknown regions via NDS{id}_ ownership", () => {
    const scope = {
      listingUrl: "https://www.athol.im/used-cars/19360241/",
      stockId: "19360241",
      ownerImagePaths: [] as string[],
    };
    const ndsHero = galleryImage({
      src: null,
      currentSrc: null,
      dataSrc: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS19360241_RMN398W_1.png",
      srcset: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS19360241_RMN398W_1.png 800w",
      region: "unknown",
      href: null,
      ownerHref: null,
    });
    expect(preferredImageSrc(ndsHero)).toContain("NDS19360241_");
    expect(imageOwnedByListing(preferredImageSrc(ndsHero)!, scope, ndsHero)).toBe(true);
    const gallery = collectVisibleGallery(
      [
        ndsHero,
        galleryImage({
          src: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS99999999_OTHER_1.png",
          currentSrc: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS99999999_OTHER_1.png",
          region: "unknown",
          href: null,
          ownerHref: null,
        }),
        galleryImage({
          src: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS19360241_REL_1.png",
          currentSrc: "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS19360241_REL_1.png",
          region: "related",
          ancestorHints: ["latest-stock", "similar-vehicles"],
          ownerHref: "https://www.athol.im/used-cars/other99/",
          href: "https://www.athol.im/used-cars/other99/",
        }),
      ],
      scope,
    );
    expect(gallery.gallerySrcs).toEqual([
      "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/images/stock/hash/NDS19360241_RMN398W_1.png",
    ]);
  });

  it("rejects a gallery-region image anchored to a different listing", () => {
    const gallery = collectVisibleGallery(
      [
        galleryImage(),
        galleryImage({
          src: "https://cdn.example/other-car.jpg",
          currentSrc: "https://cdn.example/other-car.jpg",
          region: "gallery",
          ownerHref: "https://dealer.example/used/other99",
          href: "https://dealer.example/used/other99",
        }),
      ],
      {
        listingUrl: "https://dealer.example/used/abc123",
        stockId: "abc123",
        ownerImagePaths: ["/car.jpg"],
      },
    );
    expect(gallery.gallerySrcs).toEqual(["https://cdn.example/car.jpg"]);
  });
});

describe("live navigation host policy", () => {
  it("blocks private, localhost, and cross-host targets", () => {
    const allowed = ["dealer.example"];
    expect(inspectLiveNavigation("https://dealer.example/used", allowed).ok).toBe(true);
    expect(inspectLiveNavigation("https://127.0.0.1/used", allowed).ok).toBe(false);
    expect(inspectLiveNavigation("http://localhost/used", allowed).ok).toBe(false);
    expect(inspectLiveNavigation("https://192.168.0.10/used", allowed).ok).toBe(false);
    expect(inspectLiveNavigation("https://169.254.169.254/latest/meta-data", allowed).ok).toBe(false);
    expect(inspectLiveNavigation("https://[fe80::1]/used", allowed).ok).toBe(false);
    expect(inspectLiveNavigation("file:///etc/passwd", allowed).ok).toBe(false);
    expect(inspectLiveNavigation("https://evil.example/used", allowed).ok).toBe(false);
    expect(inspectLiveNavigation("https://evil.example/phish", allowed).error).toBe("host-not-allowed");
  });
});

function publicLookup() {
  return Promise.resolve([{ address: "1.1.1.1", family: 4 as const }]);
}

function fakeRoute(input: {
  url: string;
  resourceType?: string;
  isNavigationRequest?: boolean;
  redirectedFromUrl?: string | null;
  fetchResponse?: { status: number; headers?: Record<string, string> };
  fetchByUrl?: Record<string, { status: number; headers?: Record<string, string> }>;
}): {
  route: LiveRouteLike;
  aborted: string[];
  continued: string[];
  fetched: Array<{ url?: string; maxRedirects?: number }>;
  fulfilled: LiveFetchedResponseLike[];
} {
  const aborted: string[] = [];
  const continued: string[] = [];
  const fetched: Array<{ url?: string; maxRedirects?: number }> = [];
  const fulfilled: LiveFetchedResponseLike[] = [];
  const toResponse = (value: { status: number; headers?: Record<string, string> }) => ({
    status: () => value.status,
    headers: () => value.headers ?? {},
  });
  return {
    aborted,
    continued,
    fetched,
    fulfilled,
    route: {
      request() {
        return {
          url: () => input.url,
          resourceType: () => input.resourceType ?? "document",
          isNavigationRequest: () => input.isNavigationRequest ?? input.resourceType !== "image",
          redirectedFrom: () =>
            input.redirectedFromUrl ? { url: () => input.redirectedFromUrl! } : null,
        };
      },
      abort() {
        aborted.push(input.url);
      },
      continue() {
        continued.push(input.url);
      },
      async fetch(options?: { url?: string; maxRedirects?: number }) {
        fetched.push({ url: options?.url, maxRedirects: options?.maxRedirects });
        const target = options?.url ?? input.url;
        const mapped = input.fetchByUrl?.[target];
        if (mapped) return toResponse(mapped);
        return toResponse(input.fetchResponse ?? { status: 200 });
      },
      async fulfill(options: { response?: LiveFetchedResponseLike }) {
        if (options.response) fulfilled.push(options.response);
      },
    } as LiveRouteLike,
  };
}

describe("live browser request and route guard", () => {
  it("aborts document navigations and redirects before they are issued", async () => {
    const allowed = ["dealer.example"];
    expect(decideLiveBrowserRequest({
      url: "https://dealer.example/used",
      resourceType: "document",
      isNavigationRequest: true,
      allowedHosts: allowed,
    }).action).toBe("continue");
    expect(decideLiveBrowserRequest({
      url: "https://127.0.0.1/used",
      resourceType: "document",
      isNavigationRequest: true,
      allowedHosts: allowed,
    })).toMatchObject({ action: "abort", error: "private-or-local-host" });
    expect(decideLiveBrowserRequest({
      url: "http://localhost/admin",
      isNavigationRequest: true,
      allowedHosts: allowed,
    }).action).toBe("abort");
    expect(decideLiveBrowserRequest({
      url: "https://169.254.169.254/latest/meta-data",
      resourceType: "document",
      redirectedFromUrl: "https://dealer.example/used",
      allowedHosts: allowed,
    }).error).toBe("private-or-local-host");
    expect(decideLiveBrowserRequest({
      url: "https://evil.example/phish",
      resourceType: "document",
      redirectedFromUrl: "https://dealer.example/used",
      allowedHosts: allowed,
    })).toMatchObject({ action: "abort", error: "host-not-allowed" });
    expect(decideLiveBrowserRequest({
      url: "https://cdn.example/car.jpg",
      resourceType: "image",
      isNavigationRequest: false,
      allowedHosts: allowed,
    }).action).toBe("continue");
    expect(decideLiveBrowserRequest({
      url: "https://127.0.0.1/secret.jpg",
      resourceType: "image",
      isNavigationRequest: false,
      allowedHosts: allowed,
    }).action).toBe("abort");

    const handler = createLiveRouteHandler({
      getAllowedHosts: () => allowed,
      lookupImpl: publicLookup,
    });
    const allowedNav = fakeRoute({ url: "https://dealer.example/used" });
    const privateNav = fakeRoute({ url: "https://127.0.0.1/used" });
    const redirect = fakeRoute({
      url: "https://evil.example/",
      redirectedFromUrl: "https://dealer.example/used",
    });
    const cdnImage = fakeRoute({
      url: "https://cdn.example/car.jpg",
      resourceType: "image",
      isNavigationRequest: false,
    });
    await handler(allowedNav.route);
    await handler(privateNav.route);
    await handler(redirect.route);
    await handler(cdnImage.route);
    expect(allowedNav.continued).toEqual([]);
    expect(allowedNav.fetched).toEqual([{ maxRedirects: 0 }]);
    expect(allowedNav.fulfilled).toHaveLength(1);
    expect(privateNav.aborted).toEqual(["https://127.0.0.1/used"]);
    expect(redirect.aborted).toEqual(["https://evil.example/"]);
    expect(cdnImage.continued).toEqual([]);
    expect(cdnImage.fetched).toEqual([{ maxRedirects: 0 }]);
    expect(cdnImage.fulfilled).toHaveLength(1);

    const customGuard = vi.fn(() => ({ action: "abort" as const, error: "custom-block" }));
    const custom = fakeRoute({ url: "https://dealer.example/used" });
    await createLiveRouteHandler({
      getAllowedHosts: () => allowed,
      guard: customGuard,
    })(custom.route);
    expect(customGuard).toHaveBeenCalled();
    expect(custom.aborted).toEqual(["https://dealer.example/used"]);

    const handlers: Array<(route: LiveRouteLike) => unknown> = [];
    await installLiveBrowserNetworkGuard({
      async route(_pattern, handler) {
        handlers.push(handler);
      },
    }, { getAllowedHosts: () => allowed, lookupImpl: publicLookup });
    expect(handlers).toHaveLength(1);
    const installed = fakeRoute({ url: "https://[fe80::1]/used" });
    await handlers[0]?.(installed.route);
    expect(installed.aborted).toEqual(["https://[fe80::1]/used"]);

    const handlersForWrap: Array<(route: LiveRouteLike) => unknown> = [];
    let gotoCalls = 0;
    const fakePage = {
      async route(_pattern: string, handler: (route: LiveRouteLike) => unknown) {
        handlersForWrap.push(handler);
      },
      async goto() {
        gotoCalls += 1;
        return { status: () => 200 };
      },
      getByRole() {
        return { first: () => ({ count: async () => 0, click: async () => undefined }) };
      },
      waitForLoadState: async () => undefined,
      evaluate: async () => [],
      title: async () => "Used cars",
      screenshot: async () => Buffer.from("shot"),
      url: () => "https://dealer.example/used",
      close: async () => undefined,
    };
    const wrapped = await wrapPlaywrightPage(fakePage as unknown as Page, {
      lookupImpl: publicLookup,
    });
    const blocked = await wrapped.goto("https://127.0.0.1/used", {
      allowedHosts: ["dealer.example"],
    });
    expect(blocked).toMatchObject({ ok: false, blocked: true, error: "private-or-local-host" });
    expect(gotoCalls).toBe(0);
    const wrapRedirect = fakeRoute({
      url: "https://evil.example/phish",
      redirectedFromUrl: "https://dealer.example/used",
    });
    await handlersForWrap[0]?.(wrapRedirect.route);
    expect(wrapRedirect.aborted).toEqual(["https://evil.example/phish"]);
  });
});

describe("SSRF-safe live image fetch", () => {
  it("refuses private hosts, localhost, and non-HTTPS before download", async () => {
    const fetchImage = vi.fn(async () => {
      throw new Error("should-not-fetch");
    });
    for (const url of [
      "http://cdn.example/car.jpg",
      "https://127.0.0.1/secret.jpg",
      "https://192.168.0.10/car.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/car.jpg",
    ]) {
      expect(isSafeRemoteImageUrl(url), url).toBe(false);
      const signal = await inspectRemoteImage(url, fetchImage);
      expect(signal.qualityError).toBe("unsafe-url");
    }
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("blocks DNS answers that resolve to private addresses", async () => {
    const result = await safeFetchRemoteImage("https://images.example/photo.jpg", {
      lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
      transport: async () => {
        throw new Error("should-not-transport");
      },
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/public addresses|unsafe URL/i);
    }
  });
});

describe("T1 list recensus and disabled packs", () => {
  it("reports card deltas when the stock list changes after detail visits", async () => {
    const plan = frozenPlan([replaceAction()]);
    const report = await runLiveVisualValidation({
      plan,
      deps: {
        browser: mockBrowser({
          "https://dealer.example/used": [
            { anchors: [snapshot()], title: "Used cars" },
            {
              anchors: [
                snapshot(),
                snapshot({
                  href: "https://dealer.example/used/new456",
                  text: "2022 Extra Van £8,000",
                  src: "https://cdn.example/van.jpg",
                  currentSrc: "https://cdn.example/van.jpg",
                }),
              ],
              title: "Used cars later",
            },
          ],
          "https://dealer.example/used/abc123": {
            title: "2024 Example Car",
            text: "2024 Example Car £12,995",
            images: [galleryImage()],
          },
        }),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => site,
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    const census = report.dealers[0]?.census;
    expect(census?.t0CardCount).toBe(1);
    expect(census?.t1ListCardCount).toBe(2);
    expect(census?.cardDeltas.added).toContain("https://dealer.example/used/new456");
    expect(census?.drift).toBe(false);
    expect(report.dealers[0]?.listings[0]?.status).toBe("pass");
    expect(report.dealers[0]?.hidePack).toBe(false);
    expect(report.ok).toBe(true);
  });

  it("treats T0/T1 card disappearance as conservative census drift", async () => {
    const plan = frozenPlan([replaceAction()]);
    const report = await runLiveVisualValidation({
      plan,
      deps: {
        browser: mockBrowser({
          "https://dealer.example/used": [
            {
              anchors: [
                snapshot(),
                snapshot({
                  href: "https://dealer.example/used/gone456",
                  text: "2022 Extra Van £8,000",
                  src: "https://cdn.example/van.jpg",
                  currentSrc: "https://cdn.example/van.jpg",
                }),
              ],
              title: "Used cars",
            },
            { anchors: [snapshot()], title: "Used cars later" },
          ],
          "https://dealer.example/used/abc123": {
            title: "2024 Example Car",
            text: "2024 Example Car £12,995",
            images: [galleryImage()],
          },
        }),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => site,
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(report.dealers[0]?.census.cardDeltas.removed).toContain("https://dealer.example/used/gone456");
    expect(report.dealers[0]?.census.drift).toBe(true);
    expect(report.dealers[0]?.hidePack).toBe(true);
    expect(report.dealers[0]?.hideReason).toBe(CENSUS_DRIFT_HIDE_REASON);
    expect(report.dealers[0]?.listings[0]?.status).toBe("drift");
    expect(report.dealers[0]?.listings[0]?.findings).toContain(CENSUS_DRIFT_HIDE_REASON);
    expect(report.ok).toBe(false);
  });

  it("hides a dealer with a stable reason when T1 stock-list is inaccessible after T0", async () => {
    const plan = frozenPlan([replaceAction()]);
    const report = await runLiveVisualValidation({
      plan,
      deps: {
        browser: mockBrowser({
          "https://dealer.example/used": [
            { anchors: [snapshot()], title: "Used cars" },
            { status: 503, title: "Unavailable" },
          ],
          "https://dealer.example/used/abc123": {
            title: "2024 Example Car",
            text: "2024 Example Car £12,995",
            images: [galleryImage()],
          },
        }),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => ({
          dealerKey: "dealer-a",
          website: null,
          stockUrls: ["https://dealer.example/used/"],
        }),
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(report.dealers[0]?.census.t0Accessible).toBe(true);
    expect(report.dealers[0]?.census.t1ListAccessible).toBe(false);
    expect(report.dealers[0]?.listings[0]?.status).toBe("pass");
    expect(report.dealers[0]?.hidePack).toBe(true);
    expect(report.dealers[0]?.hideReason).toBe(T1_STOCK_LIST_INACCESSIBLE_REASON);
    expect(report.ok).toBe(false);
  });

  it("classifies disabled packs without source identities as unverified and hides them", async () => {
    const plan = frozenPlan([disableAction()]);
    const report = await runLiveVisualValidation({
      plan,
      deps: {
        browser: mockBrowser({
          "https://dealer.example/used": { anchors: [snapshot()] },
        }),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => ({ ...site, dealerKey: "dealer-off" }),
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(report.dealers[0]?.actionKind).toBe("disable");
    expect(report.dealers[0]?.listings).not.toHaveLength(0);
    expect(report.dealers[0]?.listings[0]?.status).toBe("unverified");
    expect(report.dealers[0]?.listings[0]?.findings).toContain("unverified-no-source-identity");
    expect(report.dealers[0]?.hidePack).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("audits disabled packs when excluded source identities exist", async () => {
    const plan = frozenPlan([
      disableAction({
        excludedListings: [{
          identityKey: "stockId:abc123",
          sourceUrl: "https://dealer.example/used/abc123",
          title: "2024 Example Car",
          reasons: ["manual-disable"],
          findings: [],
        }],
      }),
    ]);
    const report = await runLiveVisualValidation({
      plan,
      deps: {
        browser: mockBrowser({
          "https://dealer.example/used": { anchors: [snapshot()] },
          "https://dealer.example/used/abc123": {
            title: "2024 Example Car",
            text: "2024 Example Car £12,995",
            images: [galleryImage()],
          },
        }),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => ({ ...site, dealerKey: "dealer-off" }),
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(report.dealers[0]?.listings[0]?.status).toBe("pass");
    expect(report.dealers[0]?.listings[0]?.identityKey).toBe("stockId:abc123");
    expect(report.dealers[0]?.hidePack).toBe(false);
  });

  it("hides a dealer when stock navigation is private or cross-host", async () => {
    const privateReport = await runLiveVisualValidation({
      plan: frozenPlan([replaceAction()]),
      deps: {
        browser: mockBrowser({
          "https://dealer.example/used": { anchors: [snapshot()] },
          "https://dealer.example/used/abc123": {
            title: "2024 Example Car",
            text: "2024 Example Car £12,995",
            images: [galleryImage()],
          },
        }),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => ({
          dealerKey: "dealer-a",
          website: null,
          stockUrls: ["https://127.0.0.1/used/"],
        }),
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(privateReport.dealers[0]?.hidePack).toBe(true);
    expect(privateReport.dealers[0]?.census.t0Accessible).toBe(false);

    const crossHostReport = await runLiveVisualValidation({
      plan: frozenPlan([replaceAction()]),
      deps: {
        browser: mockBrowser({
          "https://dealer.example/used": {
            anchors: [snapshot({ href: "https://evil.example/used/abc123" })],
          },
          "https://evil.example/used/abc123": {
            title: "2024 Example Car",
            text: "2024 Example Car £12,995",
            images: [galleryImage({
              href: "https://evil.example/used/abc123",
              ownerHref: "https://evil.example/used/abc123",
            })],
          },
        }),
        fetchImage: async (url) => ({
          url,
          bytes: GOOD_IMAGE,
          contentType: "image/png",
          status: 200,
        }),
        resolveSite: () => site,
        now: () => "2026-09-29T21:10:00.000Z",
      },
    });
    expect(crossHostReport.dealers[0]?.listings[0]?.status).toBe("inaccessible");
    expect(crossHostReport.dealers[0]?.hidePack).toBe(true);
    expect(crossHostReport.dealers[0]?.listings[0]?.findings).toContain("host-not-allowed");
  });
});

describe("live load more, badges, and related stock", () => {
  it("marks COMING SOON/AVAILABLE/SOLD card titles as unreliable", () => {
    const cards = collectVisibleStockCards([
      snapshot({ text: "COMING SOON £12,995" }),
      snapshot({
        href: "https://dealer.example/used/sold1",
        text: "SOLD",
        src: "https://cdn.example/sold.jpg",
        currentSrc: "https://cdn.example/sold.jpg",
      }),
    ]);
    expect(cards.every((card) => card.titleReliable === false)).toBe(true);
  });

  it("expands a bounded visible Load more without leaving the stock host", async () => {
    let loads = 0;
    const moreCard = snapshot({
      href: "https://dealer.example/used/more1",
      text: "2022 Extra Van £8,000",
      src: "https://cdn.example/van.jpg",
      currentSrc: "https://cdn.example/van.jpg",
    });
    const page: LiveBrowserPage = {
      async goto() {
        return {
          ok: true,
          status: 200,
          url: "https://dealer.example/used",
          title: "Used",
          error: null,
          blocked: false,
        };
      },
      async snapshotAnchors() {
        return loads === 0 ? [snapshot()] : [snapshot(), moreCard];
      },
      async snapshotImages() {
        return [];
      },
      async clickVisibleLoadMore() {
        if (loads >= 1) return false;
        loads += 1;
        return true;
      },
      async pageText() {
        return "";
      },
      async screenshot() {
        return null;
      },
      url: () => "https://dealer.example/used",
      async close() {},
    };
    const cards = await collectStockCardsWithBoundedLoadMore(
      page,
      [],
      ["dealer.example"],
    );
    expect(loads).toBe(1);
    expect(cards.map((card) => card.stockId).sort()).toEqual(["abc123", "more1"]);
  });

  it("drops TD related-inventory and latest-stock images while keeping the owner gallery", () => {
    const gallery = collectVisibleGallery(
      [
        galleryImage({
          src: "https://cdn.tdcar.im/bmw-1.jpg",
          currentSrc: "https://cdn.tdcar.im/bmw-1.jpg",
          href: "https://www.tdcar.im/inventory/2019-bmw-3-series-330i-m-sport",
          ownerHref: "https://www.tdcar.im/inventory/2019-bmw-3-series-330i-m-sport",
        }),
        galleryImage({
          src: "https://cdn.tdcar.im/audi-related.jpg",
          currentSrc: "https://cdn.tdcar.im/audi-related.jpg",
          region: "related",
          ancestorHints: ["latest-stock"],
          href: "https://www.tdcar.im/inventory/2018-audi-a3",
          ownerHref: "https://www.tdcar.im/inventory/2018-audi-a3",
        }),
      ],
      {
        listingUrl: "https://www.tdcar.im/inventory/2019-bmw-3-series-330i-m-sport",
        stockId: "inventory/2019-bmw-3-series-330i-m-sport",
        ownerImagePaths: ["/bmw-1.jpg"],
      },
    );
    expect(gallery.gallerySrcs).toEqual(["https://cdn.tdcar.im/bmw-1.jpg"]);
  });
});
