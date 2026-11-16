import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), report: vi.fn(), lookup: vi.fn(), authorize: vi.fn() }));
vi.mock("@/lib/media/read-rate-limit", () => ({ checkMediaReadRateLimit: mocks.limit }));
vi.mock("@/lib/media/request-diagnostics", () => ({ reportMediaDenial: mocks.report }));
vi.mock("@/lib/db", () => ({ db: { dealerProfile: { findFirst: mocks.lookup } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/dealers/access", () => ({ getPublicDealerWhere: vi.fn() }));
vi.mock("@/lib/listings/sample-visibility", () => ({ getSampleVisibility: vi.fn() }));
vi.mock("@/lib/media/delivery-access", () => ({ allowsSignedDealerLogo: vi.fn() }));
vi.mock("@/lib/media/migrated-dealer-logos", () => ({ findMigratedDealerLogo: vi.fn() }));
vi.mock("@/lib/media/imagekit-api", () => ({ signedImageKitDeliveryUrl: vi.fn() }));
vi.mock("@/lib/media/imagekit-transforms", () => ({ imageKitDeliveryRelativePath: vi.fn(), imageKitFillTransform: vi.fn() }));
vi.mock("@/lib/media/dealer-logo-delivery", () => ({ dealerLogoDeliveryUrl: vi.fn() }));
vi.mock("@/lib/media/config", () => ({ readMediaProviderMode: vi.fn() }));
vi.mock("@/lib/media/authorize-listing-photo", () => ({ loadAuthorizedListingPhoto: mocks.authorize, loadAuthorizedRevisionPhoto: mocks.authorize }));
vi.mock("@/lib/media/authorize-upload-photo", () => ({ loadAuthorizedUploadPhoto: mocks.authorize }));
vi.mock("@/lib/media/serve-photo", () => ({ signedDeliveryForPhoto: vi.fn() }));
import { GET as listing } from "@/app/api/media/listing-photo/route";
import { GET as logo } from "@/app/api/media/cloudinary-ref/route";

beforeEach(() => vi.resetAllMocks());
describe("media denial route telemetry", () => {
  it.each([
    { handler: listing, path: "/api/media/listing-photo?imageId=img-1&mode=fit&frame=gallery&w=1600" },
    { handler: logo, path: "/api/media/cloudinary-ref?url=https%3A%2F%2Fres.cloudinary.com%2Fexample%2Flogo.png" },
  ])("preserves 429, Retry-After and authorization boundary for $path", async ({ handler, path }) => {
    mocks.limit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 30_000, unavailable: false, denialSource: "shared-window" });
    const response = await handler(new NextRequest("https://itrader.im" + path, { headers: { "x-vercel-id": "lhr1::request-123" } }));
    expect(response.status).toBe(429);expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ path, denialSource: "shared-window", requestId: "lhr1::request-123", retryAfterSeconds: 30 }));
    expect(mocks.authorize).not.toHaveBeenCalled();expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
