import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), sign: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/media/migrated-dealer-logos", () => ({ findMigratedDealerLogo: mocks.find }));
vi.mock("@/lib/media/imagekit-api", () => ({ signedImageKitDeliveryUrl: mocks.sign }));
vi.mock("@/lib/images/safe-remote-image", () => ({ downloadSafeRemoteImage: mocks.download }));
import { renderDealerSocialImage, isAllowedDealerLogoUrl } from "@/lib/images/dealer-social";
const logo = "https://res.cloudinary.com/owned/image/upload/v1/logo.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=", "base64");

describe("ImageKit dealer share delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MEDIA_PROVIDER", "imagekit");
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "owned");
    mocks.find.mockReturnValue({ destinationPath: "/iommarket-migration/image/logo.png", resourceType: "image" });
    mocks.sign.mockReturnValue("https://ik.imagekit.io/itraderim/tr:f-png/logo.png?signed=test");
    mocks.download.mockResolvedValue({ contentType: "image/png", bytes: png });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the reviewed ImageKit destination without fetching Cloudinary", async () => {
    await renderDealerSocialImage("Dealer", logo);
    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("ik.imagekit.io/") }));
    expect(mocks.sign).toHaveBeenCalledWith(expect.objectContaining({ relativePath: expect.stringContaining("f-png/") }));
  });

  it("normalizes the read-only database-copy marker before the exact map lookup", async () => {
    await renderDealerSocialImage("Dealer", logo + "#itrader-database-sync-readonly");
    expect(mocks.find).toHaveBeenCalledWith(logo);
  });

  it("does not require Cloudinary credentials for an exactly mapped logo", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", undefined);
    expect(isAllowedDealerLogoUrl(logo)).toBe(true);
    await expect(renderDealerSocialImage("Dealer", logo)).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("fails closed on an unmapped logo in strict mode", async () => {
    mocks.find.mockReturnValue(null);
    await expect(renderDealerSocialImage("Dealer", logo)).rejects.toThrow(/mapped|unresolved/i);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("preserves explicit Cloudinary rollback", async () => {
    vi.stubEnv("MEDIA_PROVIDER", "cloudinary");
    await renderDealerSocialImage("Dealer", logo);
    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({ url: logo }));
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
