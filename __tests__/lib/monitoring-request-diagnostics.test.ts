import { beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticTarget, installRequestDiagnostics, requestDiagnostics, safeRequestDiagnostics } from "@/lib/monitoring/request-diagnostics";

describe("request diagnostics", () => {
  beforeEach(() => vi.useRealTimers());
  it("removes query values, identifiers and third-party paths", () => {
    expect(diagnosticTarget("/api/listings/private-id?email=secret", "https://example.test")).toBe("/api/listings/:segment");
    expect(diagnosticTarget("https://project.supabase.co/auth/v1/token?secret=x", "https://example.test")).toBe("provider:supabase");
    expect(diagnosticTarget("/api/monitoring/events", "https://example.test")).toBeNull();
  });
  it("preserves response and request arguments, bounds history and excludes its own reporting", async () => {
    const response = new Response("test", { status: 503, headers: { "x-request-id": "safe-request-123" } });
    const fetch = vi.fn().mockResolvedValue(response);
    const target = { fetch }; const failure = vi.fn();
    const restore = installRequestDiagnostics(target, "https://example.test", failure);
    try {
      for (let i = 0; i < 12; i++) expect(await target.fetch("/api/listings/secret", { method: "POST" })).toBe(response);
      expect(requestDiagnostics()).toHaveLength(10);
      expect(requestDiagnostics()[0]).toMatchObject({ target: "/api/listings/:segment", status: 503, requestId: "safe-request-123", method: "POST" });
      await target.fetch("/api/monitoring/events");
      expect(failure).toHaveBeenCalledTimes(12);
      expect(fetch).toHaveBeenCalledWith("/api/listings/secret", { method: "POST" });
    } finally { restore(); }
    expect(target.fetch).toBe(fetch);
    expect(requestDiagnostics()).toEqual([]);
  });
  it("preserves thrown errors, isolates reporting failures and records cancellation without alerting", async () => {
    const error = new TypeError("network"); const fetch = vi.fn().mockRejectedValue(error);
    const target = { fetch }; const failure = vi.fn(() => { throw new Error("report failed"); });
    const restore = installRequestDiagnostics(target, "https://example.test", failure);
    try {
      await expect(target.fetch("/search")).rejects.toBe(error);
      expect(requestDiagnostics()[0]?.outcome).toBe("network-error");
      fetch.mockRejectedValue(new DOMException("cancelled", "AbortError"));
      await expect(target.fetch("/search")).rejects.toHaveProperty("name", "AbortError");
      expect(failure).toHaveBeenCalledTimes(1);
      expect(requestDiagnostics()[1]?.outcome).toBe("cancelled");
    } finally { restore(); }
  });
  it("rejects forged private fields and discards stale breadcrumbs", async () => {
    const row = { at: Date.now(), target: "/search", method: "GET", status: 200, durationMs: 1, outcome: "ok", body: "secret", requestId: "email@example.com" };
    expect(safeRequestDiagnostics([row])).toEqual([{ at: row.at, target: "/search", method: "GET", status: 200, durationMs: 1, outcome: "ok" }]);
    expect(safeRequestDiagnostics([{ ...row, target: "/search?secret=x" }])).toEqual([]);
    const target = { fetch: vi.fn().mockResolvedValue(new Response("ok")) };
    const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
    try { await target.fetch("/search"); expect(requestDiagnostics(Date.now() + 300001)).toEqual([]); } finally { restore(); }
  });
});
