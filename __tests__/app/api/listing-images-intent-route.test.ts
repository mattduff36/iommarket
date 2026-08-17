/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthenticationRequiredError } from "@/lib/auth";
import {
  PolicyAcceptanceRequiredError,
  PolicyAcceptanceVerificationError,
} from "@/lib/policy/gate";

const {
  requireAcceptedAuth,
  issueListingImageUploadIntent,
  finalizeListingImageUploadIntent,
  checkRateLimit,
  expireAbandonedListingImageIntents,
  processListingImageCleanupJobs,
} = vi.hoisted(() => ({
  requireAcceptedAuth: vi.fn(),
  issueListingImageUploadIntent: vi.fn(),
  finalizeListingImageUploadIntent: vi.fn(),
  checkRateLimit: vi.fn(),
  expireAbandonedListingImageIntents: vi.fn(),
  processListingImageCleanupJobs: vi.fn(),
}));

vi.mock("@/lib/policy/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy/gate")>(
    "@/lib/policy/gate",
  );
  return {
    ...actual,
    requireAcceptedAuth,
  };
});

vi.mock("@/lib/listings/photo-upload", () => ({
  issueListingImageUploadIntent,
  finalizeListingImageUploadIntent,
}));

vi.mock("@/lib/listings/photo-cleanup", () => ({
  expireAbandonedListingImageIntents,
  processListingImageCleanupJobs,
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
    requireAcceptedAuth.mockResolvedValue({ id: "user-1", email: "seller@example.com" });
    checkRateLimit.mockReturnValue({ allowed: true });
    expireAbandonedListingImageIntents.mockResolvedValue({ expired: 0 });
    processListingImageCleanupJobs.mockResolvedValue({ processed: 0 });
  });

  it("rejects an unauthenticated session with 401", async () => {
    requireAcceptedAuth.mockRejectedValue(new AuthenticationRequiredError());
    const { POST } = await import("@/app/api/listing-images/intent/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/listing-images/intent", {
        method: "POST",
        headers: { origin: "http://localhost:4000" },
      }),
    );

    expect(response.status).toBe(401);
    expect(issueListingImageUploadIntent).not.toHaveBeenCalled();
  });

  it("rejects a non-accepted session and does not issue an upload intent", async () => {
    requireAcceptedAuth.mockRejectedValue(new PolicyAcceptanceRequiredError());
    const { POST } = await import("@/app/api/listing-images/intent/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/listing-images/intent", {
        method: "POST",
        headers: { origin: "http://localhost:4000" },
      }),
    );

    expect(response.status).toBe(403);
    expect(issueListingImageUploadIntent).not.toHaveBeenCalled();
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

  it("returns 500 when policy acceptance cannot be verified on intent", async () => {
    requireAcceptedAuth.mockRejectedValue(
      new PolicyAcceptanceVerificationError(),
    );
    const { POST } = await import("@/app/api/listing-images/intent/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/listing-images/intent", {
        method: "POST",
        headers: { origin: "http://localhost:4000" },
      }),
    );

    expect(response.status).toBe(500);
    expect(issueListingImageUploadIntent).not.toHaveBeenCalled();
  });

  it("rejects finalize when the session has not accepted current policies", async () => {
    requireAcceptedAuth.mockRejectedValue(new PolicyAcceptanceRequiredError());
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
          publicId: "iommarket/listings/staging/user-1/intent-1",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(finalizeListingImageUploadIntent).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated finalize with 401", async () => {
    requireAcceptedAuth.mockRejectedValue(new AuthenticationRequiredError());
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
          publicId: "iommarket/listings/staging/user-1/intent-1",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(finalizeListingImageUploadIntent).not.toHaveBeenCalled();
  });

  it("returns 500 when finalize cannot verify policy acceptance", async () => {
    requireAcceptedAuth.mockRejectedValue(
      new PolicyAcceptanceVerificationError(),
    );
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
          publicId: "iommarket/listings/staging/user-1/intent-1",
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(finalizeListingImageUploadIntent).not.toHaveBeenCalled();
  });

  it("does not run a full expired-intent sweep on successful finalize", async () => {
    finalizeListingImageUploadIntent.mockResolvedValue({
      data: {
        id: "intent-1",
        publicId: "iommarket/listings/staging/user-1/intent-1",
        assetId: "asset-1",
        version: "99",
        width: 1600,
        height: 1000,
        format: "jpg",
        bytes: 12345,
      },
    });
    expireAbandonedListingImageIntents.mockRejectedValue(new Error("expire failed"));

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
          publicId: "iommarket/listings/staging/user-1/intent-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(expireAbandonedListingImageIntents).not.toHaveBeenCalled();
  });
});
