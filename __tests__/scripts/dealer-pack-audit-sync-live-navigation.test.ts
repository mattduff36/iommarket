import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Page } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import { wrapPlaywrightPage } from "@/scripts/dealer-pack-audit-sync/live-browser";
import {
  assertLiveResolvedHost,
  createLiveRouteHandler,
  installLiveBrowserNetworkGuard,
  resolveLiveRedirectUrl,
  type LiveFetchedResponseLike,
  type LiveRequestGuard,
  type LiveRouteLike,
} from "@/scripts/dealer-pack-audit-sync/live-network";

function publicLookup() {
  return Promise.resolve([{ address: "1.1.1.1", family: 4 as const }]);
}

function privateLookup() {
  return Promise.resolve([{ address: "127.0.0.1", family: 4 as const }]);
}

function fakeRoute(input: {
  url: string;
  resourceType?: string;
  isNavigationRequest?: boolean;
  fetchResponse?: { status: number; headers?: Record<string, string> };
  fetchByUrl?: Record<string, { status: number; headers?: Record<string, string> }>;
}): {
  route: LiveRouteLike;
  aborted: string[];
  continued: string[];
  fetched: Array<{ url?: string; maxRedirects?: number }>;
  fulfilledStatuses: number[];
} {
  const aborted: string[] = [];
  const continued: string[] = [];
  const fetched: Array<{ url?: string; maxRedirects?: number }> = [];
  const fulfilledStatuses: number[] = [];
  const toResponse = (value: {
    status: number;
    headers?: Record<string, string>;
  }): LiveFetchedResponseLike => ({
    status: () => value.status,
    headers: () => value.headers ?? {},
  });
  return {
    aborted,
    continued,
    fetched,
    fulfilledStatuses,
    route: {
      request() {
        return {
          url: () => input.url,
          resourceType: () => input.resourceType ?? "document",
          isNavigationRequest: () =>
            input.isNavigationRequest ?? input.resourceType !== "image",
          redirectedFrom: () => null,
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
        if (options.response) fulfilledStatuses.push(options.response.status());
      },
    } as LiveRouteLike,
  };
}

describe("live browser redirect and DNS preflight", () => {
  it("resolves relative Location against the current request URL", () => {
    expect(resolveLiveRedirectUrl("https://dealer.example/used", "/ok")).toBe(
      "https://dealer.example/ok",
    );
    expect(resolveLiveRedirectUrl("https://dealer.example/used", "https://evil.example/x")).toBe(
      "https://evil.example/x",
    );
    expect(resolveLiveRedirectUrl("https://dealer.example/used", "   ")).toBeNull();
  });

  it("rejects hosts whose DNS answers include private, loopback, or link-local addresses", async () => {
    expect(await assertLiveResolvedHost("https://127.0.0.1/used")).toMatchObject({
      ok: false,
      error: "private-or-local-host",
    });
    expect(await assertLiveResolvedHost("https://169.254.169.254/latest/meta-data")).toMatchObject({
      ok: false,
      error: "private-or-local-host",
    });
    expect(
      await assertLiveResolvedHost("https://cdn.example/car.jpg", privateLookup),
    ).toMatchObject({ ok: false, error: "private-or-local-host" });
    expect(
      await assertLiveResolvedHost("https://cdn.example/car.jpg", async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ]),
    ).toMatchObject({ ok: false, error: "private-or-local-host" });
    expect(
      await assertLiveResolvedHost("https://cdn.example/car.jpg", publicLookup),
    ).toMatchObject({ ok: true, blocked: false });
  });

  it("preflights document 302s and never fetches a disallowed Location", async () => {
    const handler = createLiveRouteHandler({
      getAllowedHosts: () => ["dealer.example"],
      lookupImpl: publicLookup,
    });
    const blocked = fakeRoute({
      url: "https://dealer.example/start",
      fetchResponse: {
        status: 302,
        headers: { location: "https://evil.example/phish" },
      },
    });
    await handler(blocked.route);
    expect(blocked.fetched).toEqual([{ maxRedirects: 0 }]);
    expect(blocked.aborted).toEqual(["https://dealer.example/start"]);
    expect(blocked.fulfilledStatuses).toEqual([]);
    expect(blocked.continued).toEqual([]);
  });

  it("follows an allowed same-host 302 by fetching the next hop with maxRedirects 0", async () => {
    const handler = createLiveRouteHandler({
      getAllowedHosts: () => ["dealer.example"],
      lookupImpl: publicLookup,
    });
    const allowed = fakeRoute({
      url: "https://dealer.example/start",
      fetchResponse: { status: 302, headers: { location: "/landed" } },
      fetchByUrl: {
        "https://dealer.example/landed": { status: 200, headers: { "content-type": "text/html" } },
      },
    });
    await handler(allowed.route);
    expect(allowed.fetched).toEqual([
      { maxRedirects: 0 },
      { url: "https://dealer.example/landed", maxRedirects: 0 },
    ]);
    expect(allowed.fulfilledStatuses).toEqual([200]);
    expect(allowed.aborted).toEqual([]);
    expect(allowed.continued).toEqual([]);
  });

  it("aborts CDN subresources whose DNS rebinds to a private address", async () => {
    const handler = createLiveRouteHandler({
      getAllowedHosts: () => ["dealer.example"],
      lookupImpl: privateLookup,
    });
    const image = fakeRoute({
      url: "https://cdn.example/car.jpg",
      resourceType: "image",
      isNavigationRequest: false,
    });
    await handler(image.route);
    expect(image.aborted).toEqual(["https://cdn.example/car.jpg"]);
    expect(image.continued).toEqual([]);
    expect(image.fetched).toEqual([]);
  });

  it("preflights and fulfills public CDN subresources after a public-only DNS answer", async () => {
    const handler = createLiveRouteHandler({
      getAllowedHosts: () => ["dealer.example"],
      lookupImpl: publicLookup,
    });
    const image = fakeRoute({
      url: "https://cdn.example/car.jpg",
      resourceType: "image",
      isNavigationRequest: false,
    });
    await handler(image.route);
    expect(image.continued).toEqual([]);
    expect(image.fetched).toEqual([{ maxRedirects: 0 }]);
    expect(image.fulfilledStatuses).toEqual([200]);
    expect(image.aborted).toEqual([]);
  });
});

function listen(
  handler: http.RequestListener,
): Promise<{ server: http.Server; origin: string; port: number }> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function closeServer(server: http.Server) {
  await new Promise<void>((resolve, reject) => {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function originGuard(allowedOrigin: string): LiveRequestGuard {
  return (input) => {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return { action: "abort", error: "invalid-url" };
    }
    if (parsed.protocol !== "http:") {
      return { action: "abort", error: "unsupported-protocol" };
    }
    if (parsed.origin !== allowedOrigin) {
      return { action: "abort", error: "host-not-allowed" };
    }
    return { action: "continue", error: null };
  };
}

async function allowLoopbackHost(url: string) {
  try {
    if (new URL(url).hostname === "127.0.0.1") {
      return { ok: true as const, error: null, blocked: false as const };
    }
  } catch {
    return { ok: false as const, error: "invalid-url", blocked: true as const };
  }
  return assertLiveResolvedHost(url);
}

async function installLoopbackGuard(page: Page, allowedOrigin: string) {
  await installLiveBrowserNetworkGuard(page, {
    getAllowedHosts: () => ["127.0.0.1"],
    guard: originGuard(allowedOrigin),
    resolveHost: allowLoopbackHost,
  });
}

describe("live browser HTTP redirect interception", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    const pending = closers.splice(0);
    for (const close of pending.reverse()) {
      await close();
    }
  });

  it("blocks a real 302 to a disallowed origin and allows a same-host 302", async () => {
    const forbiddenHits: string[] = [];
    const forbidden = await listen((request, response) => {
      forbiddenHits.push(`${request.method ?? "GET"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "text/html" });
      response.end("forbidden-secret");
    });
    closers.push(() => closeServer(forbidden.server));

    const allowed = await listen((request, response) => {
      if (request.url === "/go-evil") {
        response.writeHead(302, { Location: `${forbidden.origin}/secret` });
        response.end();
        return;
      }
      if (request.url === "/go-ok") {
        response.writeHead(302, { Location: "/landed" });
        response.end();
        return;
      }
      if (request.url === "/landed") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Landed</title><body>safe-landed</body>");
        return;
      }
      response.writeHead(404);
      response.end();
    });
    closers.push(() => closeServer(allowed.server));

    const browser = await chromium.launch({ headless: true });
    closers.push(async () => {
      await browser.close();
    });
    const context = await browser.newContext();
    closers.push(async () => {
      await context.close();
    });

    const blockedPage = await context.newPage();
    await installLoopbackGuard(blockedPage, allowed.origin);
    try {
      await blockedPage.goto(`${allowed.origin}/go-evil`, {
        waitUntil: "domcontentloaded",
        timeout: 8_000,
      });
      throw new Error("expected disallowed redirect target to be blocked");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "expected disallowed redirect target to be blocked"
      ) {
        throw error;
      }
    }
    expect(forbiddenHits).toEqual([]);

    const okPage = await context.newPage();
    const wrapped = await wrapPlaywrightPage(okPage, {
      requestGuard: originGuard(allowed.origin),
      resolveHost: allowLoopbackHost,
    });
    const navigation = await wrapped.goto(`${allowed.origin}/go-ok`, {
      allowedHosts: ["127.0.0.1"],
    });
    expect(navigation.error).toBeNull();
    expect(navigation).toMatchObject({
      ok: true,
      status: 200,
      url: `${allowed.origin}/landed`,
    });
    expect(okPage.url()).toBe(`${allowed.origin}/landed`);
    expect(await okPage.textContent("body")).toMatch(/safe-landed/);
    expect(forbiddenHits).toEqual([]);
  }, 60_000);
});
