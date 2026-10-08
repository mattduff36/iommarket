import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), finalize: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/policy/gate", () => ({ requireAcceptedAuth: m.auth, acceptedAuthHttpStatus: (e: { statusCode?: number }) => e.statusCode ?? 401 }));
vi.mock("@/lib/media/managed-upload", () => ({ finalizeManagedImageKitUpload: m.finalize }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate, makeRateLimitKey: (scope: string, id: string) => `${scope}:${id}` }));
import { POST } from "@/app/api/listing-images/imagekit-finalize/route";
const body = { uploadIntentId: "intent", fileId: "raw-file" };
function request(data: unknown = body, origin = "https://itrader.dev") {
  return new NextRequest("https://itrader.dev/api/listing-images/imagekit-finalize", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(data) });
}
const finalIntent = { id: "intent", userId: "user", deliveryType: "imagekit-managed", publicId: "imagekit/staging/user/intent", imageKitFileId: "final-file", imageKitFilePath: "/iommarket-media/staging/listings/user/intent/photo.jpg", assetId: "final-file", folder: "/iommarket-media/staging/quarantine/user/intent", version: "source:raw-file", width: 1200, height: 800, format: "jpg", bytes: 100 };

describe("managed ImageKit finalize route", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("IMAGEKIT_UPLOADS_ENABLED", "1");
    m.auth.mockResolvedValue({ id: "user", role: "USER" }); m.rate.mockResolvedValue({ allowed: true }); m.finalize.mockResolvedValue(finalIntent);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("uses only authenticated ownership and identifiers and returns verified final metadata", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(m.finalize).toHaveBeenCalledWith({ userId: "user", intentId: "intent", fileId: "raw-file" });
    expect(await response.json()).toMatchObject({ data: { uploadIntentId: "intent", imageKitFileId: "final-file", provider: "IMAGEKIT" } });
  });
  it("fails closed when disabled or called cross-origin", async () => {
    expect((await POST(request(body, "https://attacker.example"))).status).toBe(403);
    vi.stubEnv("IMAGEKIT_UPLOADS_ENABLED", "0"); expect((await POST(request())).status).toBe(404);
    expect(m.finalize).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated, non-accepted or administrator seller uploads", async () => {
    m.auth.mockRejectedValueOnce({ statusCode: 401 }); expect((await POST(request())).status).toBe(401);
    m.auth.mockRejectedValueOnce({ statusCode: 403 }); expect((await POST(request())).status).toBe(403);
    m.auth.mockResolvedValueOnce({ id: "admin", role: "ADMIN" }); expect((await POST(request())).status).toBe(403);
    expect(m.finalize).not.toHaveBeenCalled();
  });
  it("does not accept client paths, dimensions or malformed IDs", async () => {
    for (const data of [{ ...body, filePath: "/other" }, { ...body, width: 800 }, { ...body, fileId: "../other" }]) expect((await POST(request(data))).status).toBe(400);
    expect(m.finalize).not.toHaveBeenCalled();
  });
  it("does not echo private provider errors", async () => {
    m.finalize.mockRejectedValue(new Error("https://ik.imagekit.io/private?token=secret"));
    const response = await POST(request());
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain("secret");
    expect(body).toContain("could not be verified");
  });
  it("returns the pixel-size reason for an undersized image without provider details", async () => {
    m.finalize.mockRejectedValue(new Error("Images must be at least 800×480px."));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Images must be at least 800×480px." });
  });
});
