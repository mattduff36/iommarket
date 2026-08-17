import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthenticationRequiredError } from "@/lib/auth";
import {
  PolicyAcceptanceRequiredError,
  PolicyAcceptanceVerificationError,
} from "@/lib/policy/gate";

const {
  requireAuthMock,
  requireAcceptedAuthMock,
  getCurrentDealerEntitlementMock,
  uploadMock,
  removeMock,
  getPublicUrlMock,
  dealerProfileUpdateMock,
  storageFromMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  requireAcceptedAuthMock: vi.fn(),
  getCurrentDealerEntitlementMock: vi.fn(),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
  dealerProfileUpdateMock: vi.fn(),
  storageFromMock: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireAuth: requireAuthMock,
  };
});

vi.mock("@/lib/policy/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy/gate")>(
    "@/lib/policy/gate",
  );
  return {
    ...actual,
    requireAcceptedAuth: requireAcceptedAuthMock,
  };
});

vi.mock("@/lib/dealers/entitlement", () => ({
  getCurrentDealerEntitlement: getCurrentDealerEntitlementMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: {
      update: dealerProfileUpdateMock,
    },
  },
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  makeRateLimitKey: vi.fn((scope: string, key: string) => `${scope}:${key}`),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    storage: {
      from: storageFromMock,
    },
  })),
}));

vi.mock("@/lib/upload/dealer-logo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/upload/dealer-logo")>(
    "@/lib/upload/dealer-logo",
  );
  return {
    ...actual,
    validateDealerLogoFile: vi.fn().mockResolvedValue({
      data: {
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        extension: "png",
        mimeType: "image/png",
      },
    }),
  };
});

function createLogoRequest() {
  const formData = new FormData();
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  formData.append("logo", new Blob([pngBytes], { type: "image/png" }), "logo.png");

  return new NextRequest("http://localhost/api/dealer-profile/logo", {
    method: "POST",
    headers: { origin: "http://localhost" },
    body: formData,
  });
}

describe("dealer logo upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    const acceptedDealer = {
      id: "user_123",
      authUserId: "11111111-1111-1111-1111-111111111111",
      role: "DEALER",
      dealerProfile: {
        id: "cmdealerprofile123",
        logoUrl: null,
      },
    };
    requireAuthMock.mockResolvedValue(acceptedDealer);
    requireAcceptedAuthMock.mockResolvedValue(acceptedDealer);
    getCurrentDealerEntitlementMock.mockResolvedValue({
      subscriptionId: "grant_123",
      source: "ADMIN_GRANT",
      tier: "STARTER",
      endsAt: new Date("2026-08-19T20:00:00.000Z"),
    });
    uploadMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({
      data: {
        publicUrl:
          "https://project.supabase.co/storage/v1/object/public/user-avatars/" +
          "11111111-1111-1111-1111-111111111111/dealer-logos/" +
          "cmdealerprofile123/new-logo.png",
      },
    });
    storageFromMock.mockReturnValue({
      upload: uploadMock,
      remove: removeMock,
      getPublicUrl: getPublicUrlMock,
    });
    dealerProfileUpdateMock.mockResolvedValue({});
  });

  it("uploads under the authenticated dealer namespace and persists its controlled URL", async () => {
    const { POST } = await import("@/app/api/dealer-profile/logo/route");
    const response = await POST(createLogoRequest());

    expect(response.status).toBe(200);
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /^11111111-1111-1111-1111-111111111111\/dealer-logos\/cmdealerprofile123\//,
      ),
      expect.any(Uint8Array),
      expect.objectContaining({ upsert: false, contentType: "image/png" }),
    );
    expect(dealerProfileUpdateMock).toHaveBeenCalledWith({
      where: { id: "cmdealerprofile123" },
      data: {
        logoUrl:
          "https://project.supabase.co/storage/v1/object/public/user-avatars/" +
          "11111111-1111-1111-1111-111111111111/dealer-logos/" +
          "cmdealerprofile123/new-logo.png",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { logoUrl: expect.stringContaining("/dealer-logos/cmdealerprofile123/") },
    });
  });

  it("denies an unauthenticated upload", async () => {
    requireAuthMock.mockRejectedValue(new AuthenticationRequiredError());
    requireAcceptedAuthMock.mockRejectedValue(new AuthenticationRequiredError());
    const { POST } = await import("@/app/api/dealer-profile/logo/route");
    const response = await POST(createLogoRequest());

    expect(response.status).toBe(401);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(dealerProfileUpdateMock).not.toHaveBeenCalled();
  });

  it("denies a non-accepted session and does not upload a logo", async () => {
    requireAcceptedAuthMock.mockRejectedValue(new PolicyAcceptanceRequiredError());
    const { POST } = await import("@/app/api/dealer-profile/logo/route");
    const response = await POST(createLogoRequest());

    expect(response.status).toBe(403);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(dealerProfileUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 500 when dealer logo auth verification fails", async () => {
    requireAcceptedAuthMock.mockRejectedValue(
      new PolicyAcceptanceVerificationError(),
    );
    const { POST } = await import("@/app/api/dealer-profile/logo/route");
    const response = await POST(createLogoRequest());

    expect(response.status).toBe(500);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(dealerProfileUpdateMock).not.toHaveBeenCalled();
  });

  it("never deletes a previous logo path owned by another account", async () => {
    const foreignLogoDealer = {
      id: "user_123",
      authUserId: "11111111-1111-1111-1111-111111111111",
      role: "DEALER",
      dealerProfile: {
        id: "cmdealerprofile123",
        logoUrl:
          "https://project.supabase.co/storage/v1/object/public/user-avatars/" +
          "22222222-2222-2222-2222-222222222222/dealer-logos/" +
          "cmdealerprofile123/other-logo.png",
      },
    };
    requireAuthMock.mockResolvedValue(foreignLogoDealer);
    requireAcceptedAuthMock.mockResolvedValue(foreignLogoDealer);
    const { POST } = await import("@/app/api/dealer-profile/logo/route");
    await POST(createLogoRequest());

    expect(removeMock).not.toHaveBeenCalled();
  });
});
