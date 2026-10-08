import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), finalize: vi.fn(), rate: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/policy/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy/gate")>("@/lib/policy/gate");
  return {
    ...actual,
    requireAcceptedAuth: m.auth,
    acceptedAuthHttpStatus: (error: { statusCode?: number }) => (
      error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 500
        ? error.statusCode
        : actual.acceptedAuthHttpStatus(error)
    ),
  };
});
vi.mock("@/lib/media/managed-upload", () => ({ finalizeManagedImageKitUpload: m.finalize }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate, makeRateLimitKey: (scope: string, id: string) => `${scope}:${id}` }));
vi.mock("@/lib/monitoring", () => ({ captureException: m.capture }));
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
    m.capture.mockResolvedValue(null);
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
    m.auth.mockRejectedValueOnce({ statusCode: 401 });
    const expired = await POST(request());
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: "Sign in again to continue this photo upload.", code: "unauthorized" });
    m.auth.mockRejectedValueOnce({ statusCode: 403 });
    const denied = await POST(request());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "You don't have permission to upload listing photos.", code: "forbidden" });
    m.capture.mockResolvedValueOnce({ eventId: "evt_safe_1234" });
    m.auth.mockRejectedValueOnce({ statusCode: 500 });
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(500);
    const unavailableBody = await unavailable.text();
    expect(unavailableBody).toContain("We couldn't verify this upload right now.");
    expect(unavailableBody).toContain("evt_safe_1234");
    expect(unavailableBody).not.toContain("Not authorized");
    m.auth.mockResolvedValueOnce({ id: "admin", role: "ADMIN" });
    expect((await POST(request())).status).toBe(403);
    expect(m.finalize).not.toHaveBeenCalled();
  });
  it("does not accept client paths, dimensions or malformed IDs", async () => {
    for (const data of [{ ...body, filePath: "/other" }, { ...body, width: 800 }, { ...body, fileId: "../other" }]) expect((await POST(request(data))).status).toBe(400);
    expect(m.finalize).not.toHaveBeenCalled();
  });
  it("does not echo private provider errors", async () => {
    m.capture.mockResolvedValue({ eventId: "evt_safe_1234", issueId: "issue", fingerprint: "fp", createdIssue: true });
    m.finalize.mockRejectedValue(new Error("https://ik.imagekit.io/private?token=secret"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("secret");
    expect(body).not.toContain("imagekit.io");
    expect(body).toContain("temporarily unavailable");
    expect(body).toContain("evt_safe_1234");
    expect(body.toLowerCase()).not.toContain("invalid");
    expect(body.toLowerCase()).not.toContain("succeeded");
  });
  it("keeps the safe photo message when monitoring capture fails", async () => {
    m.capture.mockRejectedValue(new Error("monitoring database unavailable"));
    m.finalize.mockRejectedValue(new Error("ImageKit download failed (500)"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("temporarily unavailable");
    expect(body).not.toContain("monitoring database");
    expect(body).not.toContain("ImageKit download");
  });
  it("returns the pixel-size reason for an undersized image without provider details", async () => {
    m.finalize.mockRejectedValue(new Error("Images must be at least 800×480px."));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Images must be at least 800×480px.",
      code: "validation",
      retryable: false,
    });
    expect(m.capture).not.toHaveBeenCalled();
  });
  it("keeps conversion pending separate from an invalid file", async () => {
    m.finalize.mockRejectedValue(new Error("Image conversion is still processing. Retry verification shortly."));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "This photo is still being prepared. Wait briefly, then try again.",
      code: "processing",
      retryable: true,
    });
  });
  it("returns the expired upload reason", async () => {
    m.finalize.mockRejectedValue(new Error("This upload expired. Please try again."));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "This upload has expired. Select the photo again.",
      code: "expired",
      retryable: false,
    });
  });
});
