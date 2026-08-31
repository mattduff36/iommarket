import { chromium, type Page } from "@playwright/test";
import { extractGalleryFromHtml, extractDescriptionFromHtml } from "./html-media";
import { sleep } from "./rate-limit";

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
      userAgent: BROWSER_UA,
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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
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
  return withPublicPage(startUrl, async (_page, captured) => {
    return captured.find(match) ?? null;
  });
}

export async function fetchPageHtml(url: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": BROWSER_UA,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

export async function fetchClassicVehicleDetail(detailUrl: string, fetchImpl: typeof fetch = fetch) {
  try {
    const html = await fetchPageHtml(detailUrl, fetchImpl);
    const origin = new URL(detailUrl).origin;
    return {
      imageUrls: extractGalleryFromHtml(html, origin),
      description: extractDescriptionFromHtml(html),
    };
  } catch {
    return null;
  }
}
