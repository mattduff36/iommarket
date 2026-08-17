/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getActiveModelsByMake = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("@/lib/vehicle-catalogue/queries", () => ({
  getActiveModelsByMake,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  makeRateLimitKey: (scope: string, requester: string) =>
    `${scope}:${requester}`,
}));

describe("GET /api/vehicle-catalogue/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue({ allowed: true });
    getActiveModelsByMake.mockResolvedValue([]);
  });

  it("returns 400 for a missing make", async () => {
    const { GET } = await import("@/app/api/vehicle-catalogue/models/route");
    const response = await GET(
      new NextRequest("http://localhost/api/vehicle-catalogue/models"),
    );
    expect(response.status).toBe(400);
    expect(getActiveModelsByMake).not.toHaveBeenCalled();
  });

  it("returns 429 before querying models", async () => {
    checkRateLimit.mockReturnValue({ allowed: false });
    const { GET } = await import("@/app/api/vehicle-catalogue/models/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/vehicle-catalogue/models?make=Volkswagen",
        { headers: { "x-real-ip": "127.0.0.1" } },
      ),
    );
    expect(response.status).toBe(429);
    expect(getActiveModelsByMake).not.toHaveBeenCalled();
  });

  it("returns bounded query results with public cache headers", async () => {
    getActiveModelsByMake.mockResolvedValue([
      { id: "t-roc", name: "T-Roc", aliases: [] },
    ]);
    const { GET } = await import("@/app/api/vehicle-catalogue/models/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/vehicle-catalogue/models?make=Volkswagen",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, stale-while-revalidate=3600",
    );
    await expect(response.json()).resolves.toEqual({
      models: [{ id: "t-roc", name: "T-Roc", aliases: [] }],
    });
    expect(getActiveModelsByMake).toHaveBeenCalledWith("Volkswagen");
  });
});
