import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteImageKitFile, purgeImageKitUrl } from "@/lib/media/imagekit-api";
import { deleteImage } from "@/lib/upload/cloudinary";

vi.mock("@/lib/database-sync/effects", () => ({ assertExternalEffectAllowed: vi.fn() }));
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production", VERCEL_ENV: "preview", ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: "postgresql://test@db.syneonzucehwlghqmfbg.supabase.co/postgres",
  IMAGEKIT_PRIVATE_KEY: "test", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
};
const path = "/iommarket-media/staging/listings/user/intent/photo.jpg";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("staging storage boundary", () => {
  it.each([
    "/iommarket-media/production/listings/user/intent/photo.jpg",
    "/iommarket-migration/photo.jpg", "/unknown/photo.jpg",
  ])("refuses an unknown production identifier resolving to %s", async (filePath) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ fileId: "file", filePath }));
    await expect(deleteImageKitFile({ fileId: "file", env, fetchImpl })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/details");
  });

  it("checks observed identity and permits only staging storage deletion", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ fileId: "different", filePath: path }))
      .mockResolvedValueOnce(Response.json({ fileId: "file", filePath: path }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteImageKitFile({ fileId: "file", env, fetchImpl })).rejects.toThrow(/identity/);
    await deleteImageKitFile({ fileId: "file", env, fetchImpl });
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });

  it("rejects production purges and permits staging original purges", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    await expect(purgeImageKitUrl({
      url: `${env.IMAGEKIT_URL_ENDPOINT}/tr:orig-true${path.replace("/staging/", "/production/")}`, env, fetchImpl,
    })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    await purgeImageKitUrl({ url: `${env.IMAGEKIT_URL_ENDPOINT}/tr:orig-true${path}`, env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never deletes legacy Cloudinary files from staging, even without clone provenance", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    for (const key of ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]) vi.stubEnv(key, undefined);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    await deleteImage("unrecorded-production-photo");
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.stubEnv("ITRADER_DEPLOYMENT_ROLE", undefined);
    await expect(deleteImage("unrecorded-production-photo")).rejects.toThrow(/identity/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
