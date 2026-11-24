import { describe, expect, it } from "vitest";
import { signedImageKitDeliveryUrl } from "@/lib/media/imagekit-api";

const env = {
  ...process.env,
  IMAGEKIT_PRIVATE_KEY: "test-signing-key",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/test",
  IMAGEKIT_SIGNATURE_TTL_SECONDS: "300",
};
const relativePath = "tr:w-800/listing/photo.webp";

describe("ImageKit public rendition cache", () => {
  it("reuses the transformed URL through a short window and keeps signatures inside their existing lifetime", () => {
    const now = 1_800_000_001_000;
    const first = signedImageKitDeliveryUrl({ relativePath, env, now, reusePublicRendition: true });
    expect(signedImageKitDeliveryUrl({ relativePath, env, now: now + 20_000, reusePublicRendition: true })).toBe(first);
    expect(signedImageKitDeliveryUrl({ relativePath, env, now: now + 60_000, reusePublicRendition: true })).not.toBe(first);
    expect(Number(new URL(first).searchParams.get("ik-t"))).toBe(1_800_000_300);
    expect(signedImageKitDeliveryUrl({ relativePath, env, now })).not.toBe(first);
  });
});
