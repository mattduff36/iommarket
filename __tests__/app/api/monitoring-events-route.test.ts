/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { shouldSampleClientEvent } from "@/lib/monitoring/ingest-guard";

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
});
