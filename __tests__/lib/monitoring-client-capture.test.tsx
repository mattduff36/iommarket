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
