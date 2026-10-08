import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dealerLogoDeliveryUrl } from "@/lib/media/dealer-logo-delivery";

const env = {
  NODE_ENV: "test",
  MEDIA_PROVIDER: "cloudinary",
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "owned-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "new-secret",
} as NodeJS.ProcessEnv;

function signature(path: string, secret: string) {
  return createHash("sha1").update(`${path}${secret}`).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "").slice(0, 8);
}

describe("dealer logo Cloudinary delivery after key rotation", () => {
  it("re-signs only the authorized stored private URL with the current key", () => {
    const path = "c_fit,w_256,h_256/v1234567890/dealers/logo.png";
    const stored = `https://res.cloudinary.com/owned-cloud/image/private/s--${signature(path, "old-secret")}--/${path}#itrader-database-sync-readonly`;
    const delivery = dealerLogoDeliveryUrl(stored, env);

    expect(delivery).toBe(`https://res.cloudinary.com/owned-cloud/image/private/s--${signature(path, "new-secret")}--/${path}`);
    expect(delivery).not.toContain(signature(path, "old-secret"));
  });

  it("preserves public assets and URLs from another Cloudinary account", () => {
    const publicUrl = "https://res.cloudinary.com/owned-cloud/image/upload/v2/logo.png";
    const otherCloudUrl = "https://res.cloudinary.com/other-cloud/image/private/s--stale--/v2/logo.png";
    expect(dealerLogoDeliveryUrl(publicUrl, env)).toBe(publicUrl);
    expect(dealerLogoDeliveryUrl(otherCloudUrl, env)).toBe(otherCloudUrl);
  });

  it("fails closed for an owned private logo when current signing credentials are unavailable", () => {
    const privateUrl = "https://res.cloudinary.com/owned-cloud/image/private/s--old--/v2/logo.png";
    expect(() => dealerLogoDeliveryUrl(privateUrl, { ...env, CLOUDINARY_API_SECRET: "" })).toThrow(/signing is unavailable/);
  });
});
