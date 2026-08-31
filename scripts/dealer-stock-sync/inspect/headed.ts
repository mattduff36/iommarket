import { mkdir } from "fs/promises";
import { join } from "path";
import { chromium, type Page } from "@playwright/test";
import { sleep } from "../rate-limit";
import { countPriceLikeCards, detectBlockedPage, detectFacebookRedirect } from "./cards";
import { rankStockLinks } from "./links";
import type { DealerInspectEvidence, InspectKind, InspectPageEvidence } from "./evidence";
import { concludeFromPages } from "./evidence";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MAX_CLICKS = 8;

async function dismissCookies(page: Page) {
  for (const name of [/accept all/i, /allow all/i, /accept/i, /agree/i, /ok/i]) {
    const cookie = page.getByRole("button", { name }).first();
    if (await cookie.count()) {
      await cookie.click({ timeout: 2_000 }).catch(() => undefined);
      await sleep(250);
    }
  }
}

async function collectLinks(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((anchor) => ({
      href: (anchor as HTMLAnchorElement).href,
      text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
    })),
  );
}

async function recordPage(
  page: Page,
  jsonUrls: string[],
  shotDir: string,
  shotName: string,
): Promise<InspectPageEvidence> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const html = await page.content().catch(() => "");
  const cards = countPriceLikeCards(html);
  const blocked = Boolean(detectBlockedPage({ title, html, status: null }));
  let screenshotRel: string | null = null;
  try {
    await mkdir(shotDir, { recursive: true });
    const file = join(shotDir, shotName);
    await page.screenshot({ path: file, fullPage: true, timeout: 15_000 });
    screenshotRel = `shots/${shotName}`;
  } catch {
    screenshotRel = null;
  }
  return {
    url,
    title,
    screenshotRel,
    priceLikeCards: cards.count,
    priceSamples: cards.samples,
    jsonUrls: [...new Set(jsonUrls)],
    blocked,
    facebook: detectFacebookRedirect(url),
    error: null,
  };
}

export async function inspectDealerHeaded(input: {
  dealerKey: string;
  displayName: string;
  connectorKey: string;
  startUrls: string[];
  archiveUnique: number;
  archiveImportable: number;
  kind: InspectKind;
  evidenceDir: string;
}): Promise<DealerInspectEvidence> {
  const shotDir = join(input.evidenceDir, "shots");
  const pages: InspectPageEvidence[] = [];
  const clickedHrefs: string[] = [];
  const visited = new Set<string>();
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      locale: "en-GB",
      viewport: { width: 1440, height: 1100 },
    });
    const page = await context.newPage();
    let jsonUrls: string[] = [];
    page.on("response", (response) => {
      const type = response.headers()["content-type"] ?? "";
      const url = response.url();
      if (
        type.includes("json") &&
        /vehicle|stock|car|used|search|inventory|motor/i.test(url) &&
        !/google|facebook|analytics|hotjar|cookie/i.test(url)
      ) {
        jsonUrls.push(url);
      }
    });

    const queue = input.startUrls.filter(Boolean);
    let clicks = 0;
    let shotIndex = 0;

    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      jsonUrls = [];
      try {
        const response = await page.goto(next, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await dismissCookies(page);
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        await sleep(1_200);
        const status = response?.status() ?? null;
        if (status === 401 || status === 403) {
          const recorded = await recordPage(page, jsonUrls, shotDir, `${String(shotIndex).padStart(2, "0")}-blocked.png`);
          pages.push({ ...recorded, blocked: true, error: `HTTP ${status}` });
          break;
        }
        const recorded = await recordPage(
          page,
          jsonUrls,
          shotDir,
          `${String(shotIndex).padStart(2, "0")}.png`,
        );
        shotIndex += 1;
        pages.push(recorded);
        if (recorded.blocked || recorded.facebook) break;

        if (clicks < MAX_CLICKS) {
          const ranked = rankStockLinks(await collectLinks(page), page.url(), visited);
          for (const link of ranked.slice(0, MAX_CLICKS - clicks)) {
            if (!queue.includes(link.href) && !visited.has(link.href)) {
              queue.push(link.href);
              clickedHrefs.push(link.href);
              clicks += 1;
            }
          }
        }
      } catch (error) {
        pages.push({
          url: next,
          title: "",
          screenshotRel: null,
          priceLikeCards: 0,
          priceSamples: [],
          jsonUrls: [],
          blocked: /403|401|captcha|cloudflare/i.test(error instanceof Error ? error.message : String(error)),
          facebook: detectFacebookRedirect(next),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  const suggestedStockUrls = pages
    .filter((page) => page.priceLikeCards >= 3 && !page.facebook && !page.blocked)
    .map((page) => page.url);

  const draft: DealerInspectEvidence = {
    dealerKey: input.dealerKey,
    displayName: input.displayName,
    connectorKey: input.connectorKey,
    archiveUnique: input.archiveUnique,
    archiveImportable: input.archiveImportable,
    kind: input.kind,
    skipReason: null,
    conclusion: "",
    suggestedStockUrls: [...new Set(suggestedStockUrls)],
    clickedHrefs,
    pages,
    maxVisibleCards: Math.max(0, ...pages.map((page) => page.priceLikeCards)),
    jsonPayloadCount: pages.reduce((sum, page) => sum + page.jsonUrls.length, 0),
  };
  draft.conclusion = concludeFromPages(draft);
  return draft;
}
