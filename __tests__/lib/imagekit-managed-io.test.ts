import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadManagedImageKitBytes, requireManagedFileDetails, deleteManagedImageKitFile } from "@/lib/media/managed-io";

vi.mock("@/lib/database-sync/effects", () => ({ assertExternalEffectAllowed: vi.fn() }));
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test", DATABASE_URL: "postgresql://test@localhost/test", NEXT_PUBLIC_APP_URL: "http://localhost:4010",
  IMAGEKIT_PRIVATE_KEY: "test-private", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
};
const path = "/iommarket-media/local/listings/user/intent/photo.jpg";
const details = { fileId: "file-1", filePath: path, isPrivateFile: true, size: 100, width: 1200, height: 800, fileType: "image" };

describe("managed ImageKit I/O guards", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects provider dimensions below the listing minimum", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ...details, width: 385, height: 294 }));
    await expect(requireManagedFileDetails({ fileId: "file-1", filePath: path, env, fetchImpl })).rejects.toThrow("Images must be at least 800×480px.");
  });

  it("requires observed private identity and never accepts a substituted path", async () => {
    const fetchImpl = vi.fn(async () => Response.json(details));
    await expect(requireManagedFileDetails({ fileId: "file-1", filePath: path, env, fetchImpl })).resolves.toEqual(details);
    fetchImpl.mockResolvedValueOnce(Response.json({ ...details, filePath: "/iommarket-migration/photo.jpg" }));
    await expect(requireManagedFileDetails({ fileId: "file-1", filePath: path, env, fetchImpl })).rejects.toThrow(/identity/);
    fetchImpl.mockResolvedValueOnce(Response.json({ ...details, isPrivateFile: false }));
    await expect(requireManagedFileDetails({ fileId: "file-1", filePath: path, env, fetchImpl })).rejects.toThrow(/private/);
  });

  it("downloads originals without automatic optimization and disallows redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
    await expect(downloadManagedImageKitBytes({ filePath: path, env, fetchImpl })).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("tr:orig-true/");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });

  it("bounds both declared and streamed response sizes", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-length": "10485761" } }));
    await expect(downloadManagedImageKitBytes({ filePath: path, env, fetchImpl })).rejects.toThrow(/size/);
    fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    await expect(downloadManagedImageKitBytes({ filePath: path, env, fetchImpl, maxBytes: 2 })).rejects.toThrow(/size/);
  });

  it("will not mutate another environment or any migrated original", async () => {
    const fetchImpl = vi.fn();
    for (const filePath of [path.replace("/local/", "/production/"), "/iommarket-migration/photo.jpg"]) {
      await expect(deleteManagedImageKitFile({ fileId: "file-1", filePath, env, fetchImpl, allowlist: [{ fileId: "file-1", filePath }] })).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires explicit matching deletion ownership", async () => {
    const fetchImpl = vi.fn(async () => Response.json(details));
    await expect(deleteManagedImageKitFile({ fileId: "file-1", filePath: path, env, fetchImpl, allowlist: [] })).rejects.toThrow(/allowlist/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
