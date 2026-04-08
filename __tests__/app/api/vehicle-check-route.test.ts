/* @vitest-environment node */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getVehicleCheckResult = vi.fn();

vi.mock("@/lib/services/vehicle-check-aggregator", () => ({
  getVehicleCheckResult,
}));

describe("POST /api/vehicle-check", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function buildRequest(
    body: string,
    headers: Record<string, string> = {}
  ): NextRequest {
    return new NextRequest("http://localhost:4000/api/vehicle-check", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-real-ip": headers["x-real-ip"] ?? "127.0.0.1",
        "user-agent": headers["user-agent"] ?? crypto.randomUUID(),
        ...headers,
      },
    });
  }

  it("returns validation errors for unsupported registrations", async () => {
    const { POST } = await import("@/app/api/vehicle-check/route");
    const response = await POST(
      buildRequest(JSON.stringify({ registration: "bad input" }))
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        registration: ["Enter a valid UK or Isle of Man registration"],
      },
    });
  });

  it("returns a successful lookup payload", async () => {
    getVehicleCheckResult.mockResolvedValue({
      normalizedRegistration: "AB12CDE",
      displayRegistration: "AB12 CDE",
      isManx: false,
      lookupTargetRegistration: "AB12CDE",
      vehicle: null,
      motHistory: null,
      mileage: null,
      auctionHistory: null,
      warnings: [],
      sourceNotes: [],
      checkedAt: new Date().toISOString(),
    });

    const { POST } = await import("@/app/api/vehicle-check/route");
    const response = await POST(
      buildRequest(JSON.stringify({ registration: "AB12 CDE" }))
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      result: {
        normalizedRegistration: "AB12CDE",
        displayRegistration: "AB12 CDE",
      },
    });
    expect(getVehicleCheckResult).toHaveBeenCalledWith("AB12CDE");
  });

  it("maps service errors to JSON responses", async () => {
    getVehicleCheckResult.mockRejectedValue(new Error("lookup exploded"));

    const { POST } = await import("@/app/api/vehicle-check/route");
    const response = await POST(
      buildRequest(JSON.stringify({ registration: "AB12 CDE" }))
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "lookup exploded",
    });
  });

  it("rejects invalid JSON", async () => {
    const { POST } = await import("@/app/api/vehicle-check/route");
    const response = await POST(buildRequest("{", { "user-agent": "invalid-json" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON",
    });
  });
});
