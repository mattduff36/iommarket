// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientErrorListener } from "@/components/monitoring/client-error-listener";
import {
  isExpectedClientCancellation,
  serializeConsoleArgs,
  shouldIgnoreConsoleError,
} from "@/lib/monitoring/console-filter";
import {
  createClientEventKey,
  createClientEventLimiter,
  sendClientMonitoringEvent,
} from "@/lib/monitoring/client-ingest";
import { installRequestDiagnostics, type RequestDiagnostic } from "@/lib/monitoring/request-diagnostics";

describe("MON-CLIENT-001 / MON-CLIENT-002 console and window capture", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("filters noise and serializes console arguments", () => {
    expect(shouldIgnoreConsoleError("Warning: each child should have a key")).toBe(true);
    expect(shouldIgnoreConsoleError("Failed to POST /api/monitoring/events")).toBe(true);
    expect(shouldIgnoreConsoleError("{}")).toBe(true);
    expect(shouldIgnoreConsoleError("Payment failed")).toBe(false);
    expect(shouldIgnoreConsoleError('{"isTrusted":true}')).toBe(true);
    expect(shouldIgnoreConsoleError("Error invoking postMessage: Java object is gone")).toBe(true);
    expect(shouldIgnoreConsoleError("undefined is not an object (evaluating 'window.webkit.messageHandlers')")).toBe(true);
    expect(shouldIgnoreConsoleError("Failed to connect to MetaMask")).toBe(true);
    expect(shouldIgnoreConsoleError("App action failed while accessing window.webkit.messageHandlers")).toBe(false);
    expect(shouldIgnoreConsoleError("Payment action failed: Failed to connect to MetaMask")).toBe(false);
    expect(shouldIgnoreConsoleError("Script error.")).toBe(false);
    expect(shouldIgnoreConsoleError("Script error")).toBe(false);
    expect(shouldIgnoreConsoleError("Load failed")).toBe(false);
    expect(shouldIgnoreConsoleError("Console Error: Failed to fetch RSC payload for /admin")).toBe(false);
    expect(
      isExpectedClientCancellation(
        new DOMException("signal is aborted without reason", "AbortError"),
      ),
    ).toBe(true);
    expect(serializeConsoleArgs([new Error("boom"), { a: 1 }])).toContain("Error: boom");
  });

  it("dedupes, respects the per-page cap, and skips monitoring recursion", async () => {
    const limiter = createClientEventLimiter(2, 5_000);
    const key = createClientEventKey({ message: "same", stack: "stack" });
    expect(limiter.canSend(key, 1_000)).toBe(true);
    expect(limiter.canSend(key, 1_100)).toBe(false);
    expect(limiter.canSend("other", 1_200)).toBe(true);
    expect(limiter.canSend("third", 1_300)).toBe(false);

    const fetchImpl = vi.fn();
    await sendClientMonitoringEvent(
      { message: "loop", route: "/api/monitoring/events" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("captures a generic network rejection with browser context within existing limits", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientErrorListener />);
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: new TypeError("Load failed") });
    window.dispatchEvent(event);
    window.dispatchEvent(event);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.message).toBe("Load failed");
    expect(body.extra.diagnostics.online).toBe(navigator.onLine);
    expect(body.extra.diagnostics.visibility).toBe(document.visibilityState);
  });

  it.each([
    ["https://ik.imagekit.io/private/photo.jpg?secret=value", "/api/media/listing-photo?photoId=private", "provider:imagekit"],
    ["", "/api/media/listing-photo?photoId=private", "/api/media/listing-photo"],
  ])("attributes failed images to currentSrc with src fallback (%#)", async (currentSrc, src, expected) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientErrorListener />);
    const image = document.createElement("img");
    image.src = src;
    Object.defineProperty(image, "currentSrc", { value: currentSrc });
    document.body.appendChild(image);
    try {
      image.dispatchEvent(new Event("error"));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body.message).toBe(`Resource failed to load: ${expected}`);
      expect(body.tags.filename).toBe(expected);
      expect(JSON.stringify(body)).not.toMatch(/photoId|private|secret|imagekit\.io/);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/monitoring/events");
    } finally { image.remove(); }
  });

  it("still attributes script failures using src", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientErrorListener />);
    const script = document.createElement("script");
    script.src = "https://external.test/private.js?secret=value";
    document.body.appendChild(script);
    try {
      script.dispatchEvent(new Event("error"));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body.tags.filename).toBe("provider:external");
      expect(JSON.stringify(body)).not.toMatch(/external\.test|private|secret/);
    } finally { script.remove(); }
  });

  it("attaches the failing request explicitly without suppressing generic hidden-page failures", async () => {
    const error = new TypeError("private network detail");
    const controller = new AbortController();
    controller.abort("private abort reason");
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      if (input === "/api/monitoring/events") return { ok: true };
      throw error;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<ClientErrorListener />);
    await expect(window.fetch("/api/listings/private-id?secret=value", { signal: controller.signal })).rejects.toBe(error);
    const reports = fetchMock.mock.calls.filter(call => call[0] === "/api/monitoring/events");
    expect(reports).toHaveLength(1);
    const body = JSON.parse(String(reports[0][1]?.body));
    expect(body.extra.triggeringRequest).toMatchObject({
      target: "/api/listings/:segment", method: "GET", status: null,
      outcome: "network-error", errorCategory: "TypeError", signalAborted: true,
    });
    expect(body.extra.diagnostics.visibility).toBe("hidden");
    expect(JSON.stringify(body)).not.toMatch(/private|secret|reason/);
  });

  it("keeps an explicit triggering request even after the breadcrumb history has moved on", async () => {
    const triggeringRequest: RequestDiagnostic = {
      at: Date.now(), target: "/api/listings/:segment", method: "POST", status: 503,
      durationMs: 1, outcome: "http-error", requestId: "failure-request-123",
    };
    const target = { fetch: vi.fn().mockResolvedValue(new Response("ok")) };
    const restore = installRequestDiagnostics(target, window.location.origin, vi.fn());
    try {
      for (let index = 0; index < 11; index++) await target.fetch("/search");
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
      await sendClientMonitoringEvent({ message: "Request failed", extra: {
        triggeringRequest: { ...triggeringRequest, body: "private", url: "/private?secret=value" },
      } }, fetchImpl);
      const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
      expect(body.extra.requests).toHaveLength(10);
      expect(body.extra.requests.every((request: RequestDiagnostic) => request.target === "/search")).toBe(true);
      expect(body.extra.triggeringRequest).toEqual(triggeringRequest);
      expect(JSON.stringify(body)).not.toMatch(/private|secret/);
    } finally { restore(); }
  });

  it("captures window errors, unhandled rejections, and console.error once", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<ClientErrorListener />);

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "window boom",
        error: new Error("window boom"),
        filename: "app.ts",
        lineno: 10,
        colno: 2,
      }),
    );

    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: new Error("rejected boom") });
    window.dispatchEvent(rejection);

    const cancellation = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(cancellation, "reason", {
      value: new DOMException("signal is aborted without reason", "AbortError"),
    });
    window.dispatchEvent(cancellation);

    console.error("Payment failed for listing");
    console.error("Warning: ignore me");
    console.error("Payment failed for listing");

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    const types = bodies.map((body) => body.tags?.type);
    expect(types).toContain("window.onerror");
    expect(types).toContain("unhandledrejection");
    expect(types).toContain("console.error");
    expect(types.filter((type) => type === "console.error")).toHaveLength(1);
    expect(bodies.some((body) => String(body.message).includes("Warning:"))).toBe(false);
    expect(
      bodies.some((body) => String(body.message).includes("signal is aborted")),
    ).toBe(false);
  });
});
