import { chromium, type Page } from "@playwright/test";
import type { AddressLookup } from "../../lib/images/safe-remote-image";
import { sleep } from "../dealer-stock-sync/rate-limit";
import {
  inspectLiveNavigation,
  isBlockedNavigation,
  navigationBlocked,
  navigationFailure,
  type LiveBrowserPage,
  type LiveBrowserSession,
  type LiveGotoOptions,
  type LiveNavigationResult,
  type VisibleElementSnapshot,
} from "./live-observe";
import {
  assertLiveResolvedHost,
  decideLiveBrowserRequest,
  installLiveBrowserNetworkGuard,
  type LiveHostResolver,
  type LiveRequestGuard,
  type LiveRoutePageLike,
} from "./live-network";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function dismissCookies(page: Page) {
  for (const name of [/accept all/i, /allow all/i, /accept/i, /agree/i]) {
    const cookie = page.getByRole("button", { name }).first();
    if (await cookie.count()) {
      await cookie.click({ timeout: 2_000 }).catch(() => undefined);
      await sleep(200);
    }
  }
}

const SNAPSHOT_LANDMARK = `
  function classAndId(node) {
    const raw = node.className;
    const cls = raw && typeof raw === "object" && "baseVal" in raw
      ? String(raw.baseVal || "")
      : String(raw || "");
    return cls + " " + (node.id || "");
  }
  function ancestorHints(el) {
    const hints = [];
    let node = el;
    while (node && node.nodeType === 1 && hints.length < 24) {
      hints.push(classAndId(node));
      node = node.parentElement;
    }
    return hints;
  }
  function liveRegion(el) {
    if (el.closest("header, [role='banner']")) return "header";
    if (el.closest("nav, [role='navigation']")) return "nav";
    if (el.closest("footer, [role='contentinfo']")) return "footer";
    if (el.closest("aside, [role='complementary']")) return "aside";
    let node = el;
    let gallery = false;
    while (node && node.nodeType === 1) {
      const lower = classAndId(node).toLowerCase();
      if (/related|similar|recommended|also-view|latest-stock|lateststock/.test(lower)) return "related";
      if (/gallery|swiper|carousel|lightbox|photoswipe/.test(lower)) gallery = true;
      node = node.parentElement;
    }
    if (gallery) return "gallery";
    if (el.closest("main, [role='main'], article")) return "main";
    return "unknown";
  }
  function imagePath(src) {
    try { return new URL(src).pathname; } catch { return src || null; }
  }
  function firstSrcsetUrl(srcset) {
    if (!srcset) return null;
    const first = String(srcset).split(",")[0];
    return first ? first.trim().split(/\\s+/)[0] || null : null;
  }
  function imageSrcFields(image) {
    const dataSrc = image.getAttribute("data-src") || image.getAttribute("data-lazy-src") || null;
    const srcset = image.getAttribute("srcset") || image.getAttribute("data-srcset") || null;
    const currentSrc = image.currentSrc || null;
    const src = image.src || dataSrc || firstSrcsetUrl(srcset) || null;
    return { src, currentSrc, dataSrc, srcset };
  }
`;

const SNAPSHOT_VISIBLE_ANCHORS = `(() => {
  ${SNAPSHOT_LANDMARK}
  return [...document.querySelectorAll("a[href]")].map((anchor) => {
    const rect = anchor.getBoundingClientRect();
    const img = [...anchor.querySelectorAll("img")].find((image) => {
      const size = image.getBoundingClientRect();
      return size.width >= 40 && size.height >= 40;
    });
    const style = window.getComputedStyle(anchor);
    const boxVisible =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width >= 40 &&
      rect.height >= 40;
    const imgRect = img ? img.getBoundingClientRect() : null;
    const srcFields = img ? imageSrcFields(img) : { src: null, currentSrc: null, dataSrc: null, srcset: null };
    return {
      tag: "a",
      href: anchor.href,
      src: srcFields.src,
      currentSrc: srcFields.currentSrc,
      dataSrc: srcFields.dataSrc,
      srcset: srcFields.srcset,
      alt: img ? img.alt || null : null,
      text: (anchor.innerText || "").replace(/\\s+/g, " ").trim(),
      visible: boxVisible || Boolean(img),
      top: rect.top || (imgRect ? imgRect.top : 0),
      left: rect.left || (imgRect ? imgRect.left : 0),
      width: Math.max(rect.width, imgRect ? imgRect.width : 0),
      height: Math.max(rect.height, imgRect ? imgRect.height : 0),
      region: liveRegion(anchor),
      ownerHref: anchor.href,
      imagePath: imagePath(srcFields.src),
      ancestorHints: ancestorHints(anchor),
    };
  });
})()`;

const SNAPSHOT_VISIBLE_IMAGES = `(() => {
  ${SNAPSHOT_LANDMARK}
  return [...document.querySelectorAll("img")].map((image) => {
    const rect = image.getBoundingClientRect();
    const style = window.getComputedStyle(image);
    const parent = image.closest("a");
    const srcFields = imageSrcFields(image);
    return {
      tag: "img",
      href: parent ? parent.href : null,
      src: srcFields.src,
      currentSrc: srcFields.currentSrc,
      dataSrc: srcFields.dataSrc,
      srcset: srcFields.srcset,
      alt: image.alt || null,
      text: image.alt || "",
      visible:
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width >= 40 &&
        rect.height >= 40,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      region: liveRegion(image),
      ownerHref: parent ? parent.href : null,
      imagePath: imagePath(srcFields.src),
      ancestorHints: ancestorHints(image),
    };
  });
})()`;

export async function createPlaywrightLiveBrowser(options: {
  headed?: boolean;
} = {}): Promise<LiveBrowserSession> {
  const browser = await chromium.launch({ headless: options.headed !== true });
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    locale: "en-GB",
    viewport: { width: 1440, height: 1100 },
  });
  return {
    async openPage(): Promise<LiveBrowserPage> {
      const page = await context.newPage();
      return wrapPlaywrightPage(page);
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

export async function wrapPlaywrightPage(
  page: Page,
  options: {
    requestGuard?: LiveRequestGuard;
    lookupImpl?: AddressLookup;
    resolveHost?: LiveHostResolver;
  } = {},
): Promise<LiveBrowserPage> {
  let allowedHosts: readonly string[] | undefined;
  let lastGuardError: string | null = null;
  const documentFinalUrls = new Map<string, string>();
  const decide = options.requestGuard ?? decideLiveBrowserRequest;
  const resolveHost =
    options.resolveHost ??
    ((url: string) => assertLiveResolvedHost(url, options.lookupImpl));
  const inspectAllowedNavigation = async (url: string) => {
    const decision = decide({
      url,
      resourceType: "document",
      isNavigationRequest: true,
      redirectedFromUrl: null,
      allowedHosts,
    });
    if (decision.action === "abort") {
      return { ok: false as const, error: decision.error };
    }
    const resolved = await resolveHost(url);
    return resolved.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: resolved.error };
  };
  await installLiveBrowserNetworkGuard(page as Page & LiveRoutePageLike, {
    getAllowedHosts: () => allowedHosts,
    lookupImpl: options.lookupImpl,
    resolveHost: async (url) => {
      const resolved = await resolveHost(url);
      if (!resolved.ok) lastGuardError = resolved.error;
      return resolved;
    },
    guard: (input) => {
      const decision = decide(input);
      lastGuardError = decision.action === "abort" ? decision.error : null;
      return decision;
    },
    onDocumentFinalUrl: (requestedUrl, finalUrl) => {
      documentFinalUrls.set(requestedUrl, finalUrl);
    },
  });
  return {
    async goto(url: string, gotoOptions?: LiveGotoOptions): Promise<LiveNavigationResult> {
      allowedHosts = gotoOptions?.allowedHosts;
      lastGuardError = null;
      const requested = await inspectAllowedNavigation(url);
      if (!requested.ok) return navigationBlocked(url, requested.error);
      try {
        let currentUrl = url;
        let response = null;
        for (let hop = 0; hop < 10; hop += 1) {
          documentFinalUrls.delete(currentUrl);
          response = await page.goto(currentUrl, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          const finalUrl = documentFinalUrls.get(currentUrl);
          if (!finalUrl || finalUrl === currentUrl) break;
          currentUrl = finalUrl;
        }
        await dismissCookies(page);
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        await sleep(800);
        const landed = page.url();
        const landedCheck = await inspectAllowedNavigation(landed);
        if (!landedCheck.ok) {
          return navigationBlocked(landed, landedCheck.error);
        }
        const status = response?.status() ?? null;
        const title = await page.title().catch(() => "");
        const blocked = isBlockedNavigation({ status, title, error: null });
        return {
          ok: status != null && status < 400 && !blocked,
          status,
          url: landed,
          title,
          error: blocked ? "blocked" : status != null && status >= 400 ? `HTTP ${status}` : null,
          blocked,
        };
      } catch (error) {
        if (lastGuardError) {
          return navigationBlocked(url, lastGuardError);
        }
        return navigationFailure(
          url,
          error instanceof Error ? error.message : "navigation-failed",
        );
      }
    },
    snapshotAnchors() {
      return page.evaluate(SNAPSHOT_VISIBLE_ANCHORS) as Promise<VisibleElementSnapshot[]>;
    },
    snapshotImages() {
      return page.evaluate(SNAPSHOT_VISIBLE_IMAGES) as Promise<VisibleElementSnapshot[]>;
    },
    async clickVisibleLoadMore() {
      const control = page
        .getByRole("button", { name: /^(load more|show more|see more)$/i })
        .or(page.getByRole("link", { name: /^(load more|show more|see more)$/i }))
        .first();
      if (!(await control.count()) || !(await control.isVisible().catch(() => false))) {
        return false;
      }
      const href = await control.getAttribute("href");
      if (href && href !== "#" && !href.startsWith("javascript:")) {
        try {
          const resolved = new URL(href, page.url()).href;
          if (!inspectLiveNavigation(resolved, allowedHosts).ok) return false;
        } catch {
          return false;
        }
      }
      await control.click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await sleep(400);
      return true;
    },
    async pageText() {
      return page.evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").trim());
    },
    async screenshot() {
      try {
        return await page.screenshot({ fullPage: true, timeout: 15_000 });
      } catch {
        return null;
      }
    },
    url() {
      return page.url();
    },
    async close() {
      await page.close();
    },
  };
}
