import { beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticTarget, installRequestDiagnostics, requestDiagnostics, safeRequestDiagnostics } from "@/lib/monitoring/request-diagnostics";

describe("request diagnostics", () => {
  beforeEach(() => vi.useRealTimers());
  it("removes query values, identifiers and third-party paths", () => {
    expect(diagnosticTarget("/api/listings/private-id?email=secret", "https://example.test")).toBe("/api/listings/:segment");
    expect(diagnosticTarget("https://project.supabase.co/auth/v1/token?secret=x", "https://example.test")).toBe("provider:supabase");
    expect(diagnosticTarget("/api/media/listing-photo?photoId=private&width=960", "https://example.test")).toBe("/api/media/listing-photo");
    expect(diagnosticTarget("/api/monitoring/events", "https://example.test")).toBeNull();
  });
  it("preserves only exact provider tokens when sanitizing again", () => {
    for (const provider of ["provider:external", "provider:imagekit", "provider:supabase"]) {
      expect(diagnosticTarget(provider, "https://example.test")).toBe(provider);
    }
    for (const input of ["provider:private", "provider:external?private", "provider:imagekit/private", "provider:supabase#private"]) {
      expect(diagnosticTarget(input, "https://example.test")).toBeNull();
    }
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
      expect(requestDiagnostics()[0]).toMatchObject({ outcome: "network-error", errorCategory: "TypeError", signalAborted: false });
      fetch.mockRejectedValue(new DOMException("cancelled", "AbortError"));
      await expect(target.fetch("/search")).rejects.toHaveProperty("name", "AbortError");
      expect(failure).toHaveBeenCalledTimes(1);
      expect(requestDiagnostics()[1]).toMatchObject({ outcome: "cancelled", errorCategory: "AbortError", signalAborted: false });
    } finally { restore(); }
  });
  it.each([
    ["omitted", true],
    ["undefined", true],
    ["null", false],
    ["active override", false],
    ["aborted override", true],
  ] as const)("uses the effective fetch signal with %s init.signal without changing inputs", async (mode, signalAborted) => {
    const controller = new AbortController();
    controller.abort("private abort reason");
    const active = new AbortController();
    const request = new Request("https://example.test/api/listings/private-id?secret=value", { signal: controller.signal, method: "POST", body: "private body" });
    const init = mode === "omitted" ? undefined : {
      signal: mode === "null" ? null : mode === "undefined" ? undefined : mode === "active override" ? active.signal : controller.signal,
    };
    const error = new TypeError("private exception message");
    const fetch = vi.fn().mockRejectedValue(error);
    const target = { fetch }; const failure = vi.fn();
    const restore = installRequestDiagnostics(target, "https://example.test", failure);
    try {
      await expect(target.fetch(request, init)).rejects.toBe(error);
      expect(fetch.mock.calls[0]?.[0]).toBe(request);
      expect(fetch.mock.calls[0]?.[1]).toBe(init);
      expect(fetch.mock.contexts[0]).toBe(target);
      expect(request.bodyUsed).toBe(false);
      expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        target: "/api/listings/:segment", method: "POST", outcome: "network-error",
        errorCategory: "TypeError", signalAborted,
      }));
      expect(JSON.stringify(requestDiagnostics())).not.toMatch(/private|secret|value|reason|message|body/);
    } finally { restore(); }
  });
  it("reads abort state at rejection and keeps non-AbortError failures reportable", async () => {
    const controller = new AbortController();
    const error = new DOMException("private timeout", "TimeoutError");
    const target = { fetch: vi.fn().mockImplementation(async () => { controller.abort("private reason"); throw error; }) };
    const failure = vi.fn();
    const restore = installRequestDiagnostics(target, "https://example.test", failure);
    try {
      await expect(target.fetch("/search", { signal: controller.signal })).rejects.toBe(error);
      expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        outcome: "network-error", errorCategory: "TimeoutError", signalAborted: true,
      }));
    } finally { restore(); }
  });
  it.each([new Error("private"), new DOMException("private", "NetworkError"), { name: "SecurityError", message: "private" }, { name: "private-name" }, "private", null])(
    "records a closed exception category without exception contents (%#)", async (error) => {
      const target = { fetch: vi.fn().mockRejectedValue(error) };
      const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
      try {
        await expect(target.fetch("/search")).rejects.toBe(error);
        const category = error && typeof error === "object" && "name" in error
          && ["Error", "NetworkError", "SecurityError"].includes(error.name) ? error.name : "other";
        expect(requestDiagnostics()[0]).toMatchObject({ errorCategory: category, signalAborted: false });
        expect(JSON.stringify(requestDiagnostics())).not.toContain("private");
      } finally { restore(); }
    },
  );
  it("rejects forged private fields and discards stale breadcrumbs", async () => {
    const row = { at: Date.now(), target: "/search", method: "GET", status: 200, durationMs: 1, outcome: "ok", body: "secret", requestId: "email@example.com" };
    expect(safeRequestDiagnostics([row])).toEqual([{ at: row.at, target: "/search", method: "GET", status: 200, durationMs: 1, outcome: "ok" }]);
    expect(safeRequestDiagnostics([{ ...row, target: "/search?secret=x" }])).toEqual([]);
    const target = { fetch: vi.fn().mockResolvedValue(new Response("ok")) };
    const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
    try { await target.fetch("/search"); expect(requestDiagnostics(Date.now() + 300001)).toEqual([]); } finally { restore(); }
  });
  it("validates optional exception and abort facts without coercing malformed values", () => {
    const row = { at: 0, target: "/api/media/listing-photo", method: "GET", status: null, durationMs: 300_000, outcome: "network-error" };
    expect(safeRequestDiagnostics([{ ...row, errorCategory: "TypeError", signalAborted: false }]))
      .toEqual([{ ...row, errorCategory: "TypeError", signalAborted: false }]);
    for (const facts of [
      { errorCategory: "private", signalAborted: "true" },
      { errorCategory: ["TypeError"], signalAborted: 1 },
      { errorCategory: { name: "TypeError" }, signalAborted: null },
      { errorCategory: null, signalAborted: {} },
    ]) expect(safeRequestDiagnostics([{ ...row, ...facts, message: "private", abortReason: "private" }])).toEqual([row]);
    for (const malformed of [
      null, [], "private", { ...row, method: ["GET"] }, { ...row, outcome: ["network-error"] },
      { ...row, at: -1 }, { ...row, durationMs: 300_001 }, { ...row, durationMs: NaN },
      { ...row, status: 600 }, { ...row, target: "provider:external?private" },
    ]) expect(safeRequestDiagnostics([malformed])).toEqual([]);
  });
});


describe("request purpose and response provenance", () => {
  it("leaves header-pair accessors to native fetch without consuming them", async () => {
    let reads = 0;
    const pair: [string, string] = ["RSC", "1"];
    Object.defineProperty(pair, "1", { get: () => String(++reads) });
    let sent: string | null = null;
    const target = { fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Request(input, init).headers.get("rsc");
      return new Response("ok");
    }) };
    const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
    try {
      await target.fetch("https://example.test/search", { headers: [pair] });
      expect({ reads, sent }).toEqual({ reads: 1, sent: "1" });
      expect(requestDiagnostics()[0].requestKind).toBeUndefined();
    } finally { restore(); }
  });

  it("uses native header storage without calling a shadowed get method", async () => {
    const headers = new Headers({ RSC: "1" });
    const shadowedGet = vi.fn(() => { headers.set("RSC", "changed"); return null; });
    Object.defineProperty(headers, "get", { value: shadowedGet });
    let sent: string | null = null;
    const target = { fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Request(input, init).headers.get("rsc");
      return new Response("ok");
    }) };
    const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
    try {
      await target.fetch("https://example.test/search", { headers });
      expect(sent).toBe("1");
      expect(shadowedGet).not.toHaveBeenCalled();
      expect(requestDiagnostics()[0].requestKind).toBe("rsc");
    } finally { restore(); }
  });

  it("leaves accessor-based init headers to native fetch and marks purpose unknown", async () => {
    let reads = 0;
    const init = { get headers() { reads += 1; return { RSC: "1", "x-test-read": String(reads) }; } };
    let sent: string | null = null;
    const target = { fetch: vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      sent = new Request(input, options).headers.get("x-test-read");
      return new Response("ok");
    }) };
    const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
    try {
      await target.fetch("https://example.test/search", init);
      expect({ reads, sent }).toEqual({ reads: 1, sent: "1" });
      expect(requestDiagnostics()[0].requestKind).toBeUndefined();
    } finally { restore(); }
  });

  it("does not evaluate an input headers override when init supplies the real headers", async () => {
    const request = new Request("https://example.test/search", { headers: { RSC: "1" } });
    const getter = vi.fn(() => { throw new Error("must not read shadowed headers"); });
    Object.defineProperty(request, "headers", { get: getter });
    const target = { fetch: vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      expect(new Request(input, options).headers.get("purpose")).toBe("prefetch");
      return new Response("ok");
    }) };
    const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
    try {
      await target.fetch(request, { headers: { purpose: "prefetch" } });
      expect(getter).not.toHaveBeenCalled();
      expect(requestDiagnostics()[0].requestKind).toBe("prefetch");
    } finally { restore(); }
  });

  it("does not consume a one-use header iterable before the real fetch", async () => {
    let seenRsc: string | null = null;
    function* oneUseHeaders() { yield ["RSC", "1"]; }
    const headers = oneUseHeaders() as unknown as HeadersInit;
    const target = { fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenRsc = new Headers(init?.headers).get("RSC");
      return new Response("ok");
    }) };
    const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
    try {
      await target.fetch("/search", { headers });
      expect(seenRsc).toBe("1");
    } finally { restore(); }
  });

  it("distinguishes RSC prefetch and the existing account polling route without exposing headers", async () => {
    const target = { fetch: vi.fn().mockRejectedValue(new TypeError("private failure")) };
    const failure = vi.fn();
    const restore = installRequestDiagnostics(target, "https://example.test", failure);
    try {
      await expect(target.fetch("/api/account-updates?scope=private", {
        headers: { RSC: "1", "Next-Router-Prefetch": "1", authorization: "private-token" },
      })).rejects.toThrow();
      expect(failure).toHaveBeenLastCalledWith(expect.objectContaining({
        target: "/api/account-updates", requestKind: "prefetch",
      }));
      await expect(target.fetch("/search", { headers: { RSC: "1" } })).rejects.toThrow();
      expect(failure).toHaveBeenLastCalledWith(expect.objectContaining({ requestKind: "rsc" }));
      expect(JSON.stringify(requestDiagnostics())).not.toMatch(/private|authorization|scope/);
    } finally { restore(); }
  });

  it("honours Request headers and an explicit init override without altering either", async () => {
    const original = vi.fn().mockResolvedValue(new Response("ok"));
    const target = { fetch: original };
    const restore = installRequestDiagnostics(target, "https://example.test", vi.fn());
    try {
      const request = new Request("https://example.test/search", { headers: { RSC: "1" } });
      await target.fetch(request);
      const override = { headers: { accept: "text/html" } };
      await target.fetch(request, override);
      expect(requestDiagnostics().map(row => row.requestKind)).toEqual(["rsc", "fetch"]);
      expect(original.mock.calls[1]).toEqual([request, override]);
      expect(request.headers.get("RSC")).toBe("1");
    } finally { restore(); }
  });

  it("retains safe response provenance when a 500 lacks a server request reference", async () => {
    const response = new Response("private response body", { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
    Object.defineProperties(response, {
      url: { value: "https://example.test/privacy?private=value" },
      redirected: { value: true },
      type: { value: "basic" },
    });
    const target = { fetch: vi.fn().mockResolvedValue(response) };
    const failure = vi.fn();
    const restore = installRequestDiagnostics(target, "https://example.test", failure);
    try {
      expect(await target.fetch("/search")).toBe(response);
      expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        requestKind: "fetch", responseType: "basic", responseContentType: "html",
        redirected: true, responseTarget: "/:segment", status: 500,
      }));
      expect(response.bodyUsed).toBe(false);
      expect(JSON.stringify(requestDiagnostics())).not.toMatch(/private|value|charset/);
    } finally { restore(); }
  });

  it("accepts only closed optional provenance values and still rejects malformed request targets", () => {
    const base = { at: 0, target: "/api/account-updates", method: "GET", status: 500, durationMs: 1, outcome: "http-error" };
    const safe = { requestKind: "prefetch", responseType: "basic", responseContentType: "html", redirected: false, responseTarget: "/api/media/cloudinary-ref" };
    expect(safeRequestDiagnostics([{ ...base, ...safe }])).toEqual([{ ...base, ...safe }]);
    expect(safeRequestDiagnostics([{ ...base, requestKind: "private", responseType: ["basic"], responseContentType: "private", redirected: "true", responseTarget: "/search?secret=value" }])).toEqual([base]);
    expect(safeRequestDiagnostics([{ ...base, target: "/api/account-updates/private" }])).toEqual([]);
  });
});
