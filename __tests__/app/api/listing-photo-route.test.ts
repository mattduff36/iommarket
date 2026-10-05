import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/media/authorize-listing-photo", () => ({
  loadAuthorizedListingPhoto: vi.fn(),
  loadAuthorizedRevisionPhoto: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 10,
    resetAt: Date.now() + 60_000,
    unavailable: false,
  })),
  makeRateLimitKey: () => "media-delivery-test",
}));

vi.mock("@/lib/media/serve-photo", () => ({
  signedDeliveryForPhoto: vi.fn(),
}));

import { loadAuthorizedListingPhoto } from "@/lib/media/authorize-listing-photo";
import { GET } from "@/app/api/media/listing-photo/route";

const authorize = vi.mocked(loadAuthorizedListingPhoto);

function request(width: string) {
  return new NextRequest(
    `http://localhost/api/media/listing-photo?imageId=img-1&source=listing&mode=fit&frame=gallery&w=${width}`,
  );
}

describe("GET /api/media/listing-photo widths", () => {
  beforeEach(() => {
    authorize.mockReset();
    authorize.mockResolvedValue(null);
  });

  it("rejects aspect-ratio and oversized widths before authorization", async () => {
    for (const width of ["16", "4", "1", "3840"]) {
      const response = await GET(request(width));
      expect(response.status).toBe(400);
    }
    expect(authorize).not.toHaveBeenCalled();
  });

  it("accepts a ladder width and still requires an authorized photo", async () => {
    const response = await GET(request("1600"));
    expect(response.status).toBe(404);
    expect(authorize).toHaveBeenCalledWith("img-1");
  });
});
