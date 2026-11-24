import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/media/authorize-listing-photo", () => ({
  loadListingPhotoAccess: vi.fn(),
  loadAuthorizedRevisionPhoto: vi.fn(),
}));

vi.mock("@/lib/media/authorize-upload-photo", () => ({ loadAuthorizedUploadPhoto: vi.fn() }));

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

import { loadListingPhotoAccess, loadAuthorizedRevisionPhoto } from "@/lib/media/authorize-listing-photo";
import { loadAuthorizedUploadPhoto } from "@/lib/media/authorize-upload-photo";
import { signedDeliveryForPhoto } from "@/lib/media/serve-photo";
import { checkRateLimit } from "@/lib/rate-limit";
import { GET } from "@/app/api/media/listing-photo/route";

const access = vi.mocked(loadListingPhotoAccess);
const authorize = vi.fn();

function request(width: string) {
  return new NextRequest(
    `http://localhost/api/media/listing-photo?imageId=img-1&source=listing&mode=fit&frame=gallery&w=${width}`,
  );
}

describe("GET /api/media/listing-photo widths", () => {
  beforeEach(() => {
    access.mockResolvedValue(null);
    authorize.mockReset();
    authorize.mockResolvedValue(null);
  });

  it("rejects aspect-ratio and oversized widths before authorization", async () => {
    for (const width of ["16", "4", "1", "3840"]) {
      const response = await GET(request(width));
      expect(response.status).toBe(400);
    }
    expect(access).not.toHaveBeenCalled();
  });

  it("accepts a ladder width and still requires an authorized photo", async () => {
    access.mockResolvedValue({ isPublic: false, authorize } as never);
    const response = await GET(request("1600"));
    expect(response.status).toBe(404);
    expect(access).toHaveBeenCalledWith("img-1");
    expect(authorize).toHaveBeenCalled();
  });

  it("marks an application 429 without authorizing or redirecting the image", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000, unavailable: false });
    const response = await GET(new NextRequest(request("1600"), {
      headers: { "x-forwarded-for": "192.0.2.21" },
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("server-timing")).toBe('itrader-media-limit;desc="shared-window"');
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("media access during a rate-limit database outage", () => {
  beforeEach(() => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000, unavailable: true });
    access.mockResolvedValue(null);
    vi.mocked(loadAuthorizedRevisionPhoto).mockResolvedValue(null);
    vi.mocked(loadAuthorizedUploadPhoto).mockResolvedValue(null);
    vi.mocked(signedDeliveryForPhoto).mockClear();
  });

  it.each(["listing", "revision", "upload"])("does not expose an unauthorised %s image", async source => {
    const response = await GET(new NextRequest(`http://localhost/api/media/listing-photo?imageId=private&source=${source}&mode=fit&frame=gallery&w=1600`));
    expect(response.status).toBe(404);
    expect(signedDeliveryForPhoto).not.toHaveBeenCalled();
  });

  it("still serves an authorised image", async () => {
    access.mockResolvedValue({ isPublic: false, authorize: async () => ({ id: "img-1" }) } as never);
    vi.mocked(signedDeliveryForPhoto).mockReturnValue({ kind: "imagekit", url: "https://ik.imagekit.io/example/photo.jpg" } as never);
    const response = await GET(request("1600"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://ik.imagekit.io/example/photo.jpg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("delivers a public rendition without consulting the limiter and rechecks access on the next request", async () => {
    const limit = vi.mocked(checkRateLimit);
    limit.mockClear();
    access.mockResolvedValueOnce({ photo: { id: "img-1" }, isPublic: true, authorize } as never);
    vi.mocked(signedDeliveryForPhoto).mockReturnValue({ kind: "redirect", url: "https://ik.imagekit.io/example/photo.jpg" });
    const response = await GET(request("1600"));
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(limit).not.toHaveBeenCalled();
    expect(signedDeliveryForPhoto).toHaveBeenCalledWith(expect.objectContaining({ reusePublicRendition: true }));
    expect((await GET(request("1600"))).status).toBe(404);
  });
});
