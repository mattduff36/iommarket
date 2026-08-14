/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireAuth = vi.fn();
const issueListingImageUploadIntent = vi.fn();
const finalizeListingImageUploadIntent = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth,
}));

vi.mock("@/lib/listings/photo-upload", () => ({
  issueListingImageUploadIntent,
  finalizeListingImageUploadIntent,
}));

vi.mock("@/lib/listings/photo-cleanup", () => ({
  expireAbandonedListingImageIntents: vi.fn(),
  processListingImageCleanupJobs: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  makeRateLimitKey: vi.fn((scope: string, key: string) => `${scope}:${key}`),
}));

describe("PHOTO-TRUST-001 listing image API routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: "user-1", email: "seller@example.com" });
    checkRateLimit.mockReturnValue({ allowed: true });
  });

  it("rejects untrusted origins and issues signed upload parameters", async () => {
    const { POST } = await import("@/app/api/listing-images/intent/route");
    const blocked = await POST(
      new NextRequest("http://localhost:4000/api/listing-images/intent", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(blocked.status).toBe(403);

    issueListingImageUploadIntent.mockResolvedValue({
      intent: {
        id: "intent-1",
        publicId: "iommarket/listings/staging/user-1/intent-1",
        expiresAt: new Date("2026-08-14T23:00:00.000Z"),
      },
      upload: { url: "https://api.cloudinary.com/v1_1/demo/image/upload", params: {} },
    });

    const allowed = await POST(
      new NextRequest("http://localhost:4000/api/listing-images/intent", {
        method: "POST",
        headers: { origin: "http://localhost:4000" },
      }),
    );
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      data: {
        uploadIntentId: "intent-1",
      },
    });
  });

  it("rejects forged finalize payloads", async () => {
    finalizeListingImageUploadIntent.mockResolvedValue({
      error: "The uploaded file does not match this request.",
    });
    const { POST } = await import("@/app/api/listing-images/finalize/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/listing-images/finalize", {
        method: "POST",
        headers: {
          origin: "http://localhost:4000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          uploadIntentId: "intent-1",
          publicId: "evil/id",
          assetId: "forged",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The uploaded file does not match this request.",
    });
  });
});
