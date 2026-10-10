import { describe, expect, it } from "vitest";
import { isOwnedListingImage } from "@/lib/dealer-stock-sync/images";

const image = {
  provider: "CLOUDINARY" as const,
  publicId: "iommarket/listings/preview-packs/franklins/test/0",
  url: "https://res.cloudinary.com/fixture/image/private/v1/iommarket/listings/preview-packs/franklins/test/0.jpg",
  width: 1200, height: 800, order: 0,
};

describe("stock sync image ownership boundary", () => {
  it.each([
    "https://res.cloudinary.com.attacker.invalid/photo.jpg",
    "https://attacker.invalid/res.cloudinary.com/photo.jpg",
    "http://res.cloudinary.com/fixture/photo.jpg",
    "https://ik.imagekit.io/foreign/photo.jpg",
  ])("rejects an untrusted or mismatched delivery URL: %s", (url) => {
    expect(isOwnedListingImage({ ...image, url })).toBe(false);
  });
  it("does not treat a one-pixel asset as a usable vehicle photograph", () => {
    expect(isOwnedListingImage({ ...image, width: 1, height: 1 })).toBe(false);
  });
});
