import { chromium, type Page } from "@playwright/test";
import { extractDescriptionFromHtml, extractNetDirectorGalleryFromHtml } from "./html-media";
import { sleep } from "./rate-limit";
import { PublicReadStatusError, retryPublicRead } from "./public-read-retry";

export async function gotoPublicPage(page: Page, url: string, allowInitialBlockedDocument = false) {
  return retryPublicRead(async () => {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    // Some public sites return 403 for the initial document, then render their
    // normal list after JavaScript settles. List extraction still fails closed
    // if no real stock appears; detail requests require a successful response.
    if (response && !response.ok() && !(allowInitialBlockedDocument && response.status() === 403)) {
      throw new PublicReadStatusError(response.status());
    }
    return response;
  });
}

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const HEADER_ALLOWLIST = [
  "authorization",
  "accept",
  "content-type",
  "origin",
  "referer",
  "user-agent",
] as const;

function sanitizeHeaders(headers: Record<string, string>) {
  const sanitized: Record<string, string> = {};
  for (const key of HEADER_ALLOWLIST) {
    const value = headers[key] ?? headers[key.toUpperCase()];
    if (value) sanitized[key] = value;
  }
  return sanitized;
}

async function dismissCookies(page: Page) {
  for (const name of [/accept all/i, /allow all/i, /accept/i, /agree/i]) {
    const cookie = page.getByRole("button", { name }).first();
    if (await cookie.count()) {
      await cookie.click({ timeout: 2_000 }).catch(() => undefined);
      await sleep(200);
    }
  }
}

export async function withPublicPage<T>(
  startUrl: string,
  run: (page: Page, captured: CapturedRequest[], jsonPayloads: unknown[], htmlPayloads: string[]) => Promise<T>,
  options: {
    captureJson?: boolean;
    settleMs?: number;
    waitForSelector?: string;
    headed?: boolean;
    captureHtmlUrls?: (url: string) => boolean;
  } = {},
) {
  const headed = options.headed === true || process.env.DEALER_STOCK_HEADED === "1";
  const browser = await chromium.launch({ headless: !headed });
  try {
    const browserContext = await browser.newContext({
      locale: "en-GB",
      viewport: { width: 1440, height: 1100 },
    });
    const page = await browserContext.newPage();
    const captured: CapturedRequest[] = [];
    const jsonPayloads: unknown[] = [];
    const htmlPayloads: string[] = [];
    const pending: Promise<void>[] = [];
    page.on("request", (request) => {
      captured.push({
        url: request.url(),
        method: request.method(),
        headers: sanitizeHeaders(request.headers()),
        body: request.postData(),
      });
    });
    if (options.captureJson) {
      page.on("response", (response) => {
        const contentType = response.headers()["content-type"] ?? "";
        const url = response.url();
        if (
          !contentType.includes("json") ||
          !/vehicle|stock|car|used|search|inventory/i.test(url) ||
          /google|facebook|analytics|hotjar|cookie/i.test(url)
        ) {
          return;
        }
        pending.push(
          Promise.race([
            response.json(),
            sleep(1_500).then(() => null),
          ])
            .then((payload) => {
              if (payload != null) jsonPayloads.push(payload);
            })
            .catch(() => undefined),
        );
      });
    }
    if (options.captureHtmlUrls) {
      page.on("response", (response) => {
        if (!options.captureHtmlUrls?.(response.url())) return;
        pending.push(
          response
            .text()
            .then((text) => {
              if (text && text.length > 40) htmlPayloads.push(text);
            })
            .catch(() => undefined),
        );
      });
    }
    await gotoPublicPage(page, startUrl, true);
    await dismissCookies(page);
    if (options.waitForSelector) {
      await page.locator(options.waitForSelector).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    }
    await sleep(options.settleMs ?? 1_200);
    await Promise.all(pending);
    const result = await run(page, captured, jsonPayloads, htmlPayloads);
    await browserContext.close();
    return result;
  } finally {
    await browser.close();
  }
}

export async function capturePublicListRequest(
  startUrl: string,
  match: (request: CapturedRequest) => boolean,
) {
  // NetDirector's public stock pages require the normal visible browser mode.
  return withPublicPage(startUrl, async (_page, captured) => {
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const request = captured.find(match);
      if (request) return request;
      await sleep(250);
    }
    return captured.find(match) ?? null;
  }, { headed: true });
}

export async function fetchPageHtml(url: string, fetchImpl: typeof fetch = fetch) {
  return retryPublicRead(async () => {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": BROWSER_UA,
      },
    });
    if (!response.ok) throw new PublicReadStatusError(response.status);
    return response.text();
  });
}

export async function fetchClassicVehicleDetail(detailUrl: string, fetchImpl: typeof fetch = fetch) {
  try {
    const html = await fetchPageHtml(detailUrl, fetchImpl);
    const origin = new URL(detailUrl).origin;
    return {
      imageUrls: extractNetDirectorGalleryFromHtml(html, origin),
      description: extractDescriptionFromHtml(html),
    };
  } catch {
    return null;
  }
}
