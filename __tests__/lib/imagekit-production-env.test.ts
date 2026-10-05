import { describe, expect, it } from "vitest";
import { classifyLaunchEnvironment, PRODUCTION_SENSITIVE_KEYS } from "@/lib/ops/production-env-contract";
import { validateVercelProductionEnvMetadata } from "@/lib/ops/production-env";
const strict = { MEDIA_PROVIDER: "imagekit", NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit", MEDIA_UPLOAD_PROVIDER: "imagekit",
  IMAGEKIT_UPLOADS_ENABLED: "1", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
  IMAGEKIT_PRIVATE_KEY: "private_" + "x".repeat(40), IMAGEKIT_PUBLIC_KEY: "public_test", VERCEL_ENV: "production" };
const mediaIssues = (env: Record<string, string | undefined>) => classifyLaunchEnvironment(env).issues.filter(i => /IMAGEKIT|MEDIA_PROVIDER|MEDIA_UPLOAD|CLOUDINARY/.test(i.key));

describe("production media environment contract", () => {
  it("accepts verified ImageKit-only configuration without requiring retired Cloudinary credentials", () => {
    expect(mediaIssues(strict)).toEqual([]);
  });
  it("still requires Cloudinary credentials when delivery is rolled back", () => {
    expect(mediaIssues({ ...strict, MEDIA_PROVIDER: "cloudinary", NEXT_PUBLIC_MEDIA_PROVIDER: "cloudinary" }).map(i => i.key)).toContain("CLOUDINARY_API_SECRET");
  });
  it.each([{ NEXT_PUBLIC_MEDIA_PROVIDER: "cloudinary" }, { IMAGEKIT_PRIVATE_KEY: "" }, { IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/other" }, { IMAGEKIT_DEV_UPLOADS: "1" }, { IMAGEKIT_UPLOADS_ENABLED: "0" }])("rejects an incomplete or mismatched ImageKit cutover: %j", change => {
    expect(mediaIssues({ ...strict, ...change }).length).toBeGreaterThan(0);
  });
  it("does not require an ImageKit secret for an existing Cloudinary-only release", () => {
    const rows = PRODUCTION_SENSITIVE_KEYS.filter(k => k !== "IMAGEKIT_PRIVATE_KEY").map(key => ({ key, type: "sensitive", target: ["production"] }));
    expect(() => validateVercelProductionEnvMetadata(rows)).not.toThrow();
  });
  it("requires media secrets that are present to remain sensitive, without requiring both providers", () => {
    expect(PRODUCTION_SENSITIVE_KEYS as readonly string[]).toContain("IMAGEKIT_PRIVATE_KEY");
    const rows = PRODUCTION_SENSITIVE_KEYS.filter(k => k !== "CLOUDINARY_API_SECRET").map(key => ({ key, type: "sensitive", target: ["production"] }));
    expect(() => validateVercelProductionEnvMetadata(rows)).not.toThrow();
    expect(() => validateVercelProductionEnvMetadata(rows.map(row => row.key === "IMAGEKIT_PRIVATE_KEY" ? { ...row, type: "encrypted" } : row))).toThrow();
  });
});
