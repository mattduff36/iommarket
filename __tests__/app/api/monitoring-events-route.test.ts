/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { shouldSampleClientEvent } from "@/lib/monitoring/ingest-guard";
import { sanitizeMonitoringContext } from "@/lib/monitoring/capture";

const captureException = vi.fn();
const getCurrentUser = vi.fn();

vi.mock("@/lib/monitoring", async () => {
  const actual = await vi.importActual<typeof import("@/lib/monitoring")>(
    "@/lib/monitoring",
  );
  return {
    ...actual,
    captureException: (...args: unknown[]) => captureException(...args),
  };
});

vi.mock("@/lib/auth", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  makeRateLimitKey: vi.fn((scope: string, key: string) => `${scope}:${key}`),
}));

function postEvent(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:4000/api/monitoring/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("OPS-INGEST-001 monitoring events ingest", () => {
  it("never invents a server stack for a browser error without a stack", async () => {
    const { POST } = await import("@/app/api/monitoring/events/route");
    getCurrentUser.mockResolvedValue(null);
    await POST(postEvent({ message: "Load failed" }));
    expect(captureException.mock.calls.at(-1)?.[0].error.stack).toBeUndefined();
    await POST(postEvent({ message: "Load failed", stack: "at browser.js:1:2" }));
    expect(captureException.mock.calls.at(-1)?.[0].error.stack).toBe("at browser.js:1:2");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue(null);
    captureException.mockResolvedValue({ issueId: "iss_1", eventId: "evt_1" });
  });

  it("caps HIGH and CRITICAL client severity at MEDIUM", async () => {
    const { POST } = await import("@/app/api/monitoring/events/route");

    for (const severity of ["HIGH", "CRITICAL"] as const) {
      captureException.mockClear();
      const response = await POST(postEvent({ message: "client boom", severity }));
      expect(response.status).toBe(202);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "CLIENT",
          severity: "MEDIUM",
        }),
      );
    }
  });

  it("preserves sampled LOW client severity and drops the rest", async () => {
    const { POST } = await import("@/app/api/monitoring/events/route");
    const response = await POST(postEvent({ message: "minor glitch", severity: "LOW" }));
    expect(response.status).toBe(202);
    if (shouldSampleClientEvent("minor glitch", "LOW")) {
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ source: "CLIENT", severity: "LOW" }),
      );
    } else {
      expect(captureException).not.toHaveBeenCalled();
    }
  });

  it("rejects events from a foreign origin", async () => {
    const { POST } = await import("@/app/api/monitoring/events/route");
    const request = new NextRequest("http://localhost:4000/api/monitoring/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        host: "localhost:4000",
      },
      body: JSON.stringify({ message: "client boom" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(captureException).not.toHaveBeenCalled();
  });
  it("returns a failure when persistence fails instead of acknowledging a lost event", async () => {
    captureException.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/monitoring/events/route");
    const response = await POST(postEvent({ message: "client failure", severity: "HIGH" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, eventId: null });
  });

  it("persists validated triggering-request facts independently from request breadcrumbs", async () => {
    const { POST } = await import("@/app/api/monitoring/events/route");
    const triggeringRequest = {
      at: 123, target: "/api/media/listing-photo", method: "GET", status: null, durationMs: 1,
      outcome: "network-error", errorCategory: "TypeError", signalAborted: false,
    };
    const breadcrumb = { ...triggeringRequest, target: "/search", status: 200, outcome: "ok" };
    const response = await POST(postEvent({ message: "Request failed", extra: {
      triggeringRequest: { ...triggeringRequest, url: "https://private.test?secret=value", message: "private", reason: "private" },
      requests: [breadcrumb],
    } }));
    expect(response.status).toBe(202);
    const captured = captureException.mock.calls.at(-1)?.[0];
    expect(captured.extra.triggeringRequest).toEqual(triggeringRequest);
    expect(captured.extra.requests).toEqual([breadcrumb]);
    const persisted = sanitizeMonitoringContext(captured);
    expect(persisted.extra?.triggeringRequest).toEqual(triggeringRequest);
    expect(JSON.stringify(persisted.extra)).not.toMatch(/private|secret|reason|message/);
  });

  it.each([
    null, "private", [], {},
    { at: 0, target: "/search?secret=value", method: "GET", status: null, durationMs: 1, outcome: "network-error" },
  ])("does not persist a malformed triggering request (%#)", async (triggeringRequest) => {
    const { POST } = await import("@/app/api/monitoring/events/route");
    const response = await POST(postEvent({ message: "Request failed", extra: { triggeringRequest } }));
    expect(response.status).toBe(202);
    expect(captureException.mock.calls.at(-1)?.[0].extra.triggeringRequest).toBeUndefined();
  });

});
