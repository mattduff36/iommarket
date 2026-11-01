import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/media/authorize-listing-photo", () => ({
  loadAuthorizedListingPhoto: vi.fn(),
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

import { loadAuthorizedListingPhoto, loadAuthorizedRevisionPhoto } from "@/lib/media/authorize-listing-photo";
import { loadAuthorizedUploadPhoto } from "@/lib/media/authorize-upload-photo";
import { signedDeliveryForPhoto } from "@/lib/media/serve-photo";
import { checkRateLimit } from "@/lib/rate-limit";
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

describe("media access during a rate-limit database outage", () => {
  beforeEach(() => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000, unavailable: true });
    vi.mocked(loadAuthorizedListingPhoto).mockResolvedValue(null);
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
    vi.mocked(loadAuthorizedListingPhoto).mockResolvedValue({ id: "img-1" } as never);
    vi.mocked(signedDeliveryForPhoto).mockReturnValue({ kind: "imagekit", url: "https://ik.imagekit.io/example/photo.jpg" } as never);
    const response = await GET(request("1600"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://ik.imagekit.io/example/photo.jpg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
  });
});
