import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { managedMediaScope, managedUploadPaths, parseManagedMediaPath, assertManagedMediaMutation } from "@/lib/media/managed-policy";
import { createImageKitUploadToken } from "@/lib/media/direct-upload-token";

const local: NodeJS.ProcessEnv = {
  NODE_ENV: "test", DATABASE_URL: "postgresql://test@localhost/test", NEXT_PUBLIC_APP_URL: "http://localhost:4010",
  MEDIA_PROVIDER: "imagekit", NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit", IMAGEKIT_UPLOADS_ENABLED: "1",
  IMAGEKIT_PUBLIC_KEY: "test-public", IMAGEKIT_PRIVATE_KEY: "test-private", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
};
const prod: NodeJS.ProcessEnv = {
  ...local, VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://itrader.im",
  DATABASE_URL: "postgresql://postgres.snlqivvogfqesxpbjiei@aws-1-eu-west-2.pooler.supabase.com/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://snlqivvogfqesxpbjiei.supabase.co",
};

describe("managed ImageKit upload policy", () => {
  it("requires matching production runtime, origin and database identities", () => {
    expect(managedMediaScope(prod)).toBe("production");
    expect(() => managedMediaScope({ ...prod, NEXT_PUBLIC_APP_URL: "https://itrader.dev" })).toThrow();
    expect(() => managedMediaScope({ ...prod, POSTGRES_URL: "postgresql://test@localhost/test" })).toThrow();
    expect(() => managedMediaScope({ ...local, DATABASE_URL: prod.DATABASE_URL })).toThrow();
    expect(managedMediaScope(local)).toBe("local");
  });

  it("separates raw quarantine, verified listings and environments", () => {
    const paths = managedUploadPaths("staging", "user-1", "intent-1", "heic");
    expect(paths.quarantinePath).toBe("/iommarket-media/staging/quarantine/user-1/intent-1/source.heic");
    expect(paths.finalPath).toBe("/iommarket-media/staging/listings/user-1/intent-1/photo.webp");
    expect(parseManagedMediaPath(paths.finalPath)?.kind).toBe("listings");
    expect(() => managedUploadPaths("local", "../user", "intent", "jpg")).toThrow();
    expect(parseManagedMediaPath("/iommarket-media/local/listings/u/i/photo.jpg/../secret")).toBeNull();
    expect(parseManagedMediaPath("/iommarket-media/local/listings/u/i/photo%2ejpg")).toBeNull();
    expect(() => assertManagedMediaMutation(paths.finalPath, local)).toThrow();
    expect(() => assertManagedMediaMutation("/iommarket-migration/photo.jpg", prod)).toThrow();
  });

  it("signs every fixed upload field with a short-lived V2 JWT", () => {
    const result = createImageKitUploadToken({ userId: "user-1", intentId: "intent-1", format: "jpg", env: local, now: 1_800_000_000_000 });
    const { token, ...fields } = result.fields;
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT", kid: "test-public" });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({ ...fields, iat: 1_800_000_000, exp: 1_800_000_300 });
    expect(signature).toBe(createHmac("sha256", "test-private").update(`${header}.${payload}`).digest("base64url"));
    expect(fields.isPrivateFile).toBe("true");
    expect(fields.overwriteFile).toBe("false");
    expect(fields.useUniqueFileName).toBe("false");
    expect(fields.checks).toContain("10485760");
    expect(result.uploadUrl).toBe("https://upload.imagekit.io/api/v2/files/upload");
    expect(JSON.stringify(result)).not.toContain("test-private");
  });

  it.each(["heic", "heif"] as const)("allows only the verified HEIC/HEIF provider MIME aliases for %s", (format) => {
    const result = createImageKitUploadToken({ userId: "user-1", intentId: "intent-1", format, env: local, now: 1_800_000_000_000 });
    expect(result.fields.checks).toContain('"file.mime" IN ["image/heic","image/heif"]');
    expect(result.fields.isPrivateFile).toBe("true");
    expect(result.fields.overwriteFile).toBe("false");
  });

  it.each([
    ["jpg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"],
  ] as const)("keeps %s upload MIME validation exact", (format, mime) => {
    const result = createImageKitUploadToken({ userId: "user-1", intentId: "intent-1", format, env: local, now: 1_800_000_000_000 });
    expect(result.fields.checks).toContain(`"file.mime" IN ["${mime}"]`);
  });

  it("cannot issue an upload token without explicit enablement and the verified account", () => {
    const input = { userId: "user", intentId: "intent", format: "png" as const };
    expect(() => createImageKitUploadToken({ ...input, env: { ...local, IMAGEKIT_UPLOADS_ENABLED: "0" } })).toThrow();
    expect(() => createImageKitUploadToken({ ...input, env: { ...local, IMAGEKIT_URL_ENDPOINT: "https://attacker.example" } })).toThrow();
    expect(() => createImageKitUploadToken({ ...input, env: { ...local, IMAGEKIT_PUBLIC_KEY: undefined } })).toThrow();
  });
});
