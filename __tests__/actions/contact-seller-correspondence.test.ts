import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAcceptedAuthMock,
  checkRateLimitMock,
  sendSellerContactEmailMock,
  sendContactConfirmationEmailMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAcceptedAuthMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  sendSellerContactEmailMock: vi.fn(),
  sendContactConfirmationEmailMock: vi.fn(),
  mockDb: {
    siteSetting: { findMany: vi.fn().mockResolvedValue([]) },
    listing: { findUnique: vi.fn() },
    dealerProfile: { findFirst: vi.fn() },
    dealerCorrespondenceSettings: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/policy/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy/gate")>(
    "@/lib/policy/gate",
  );
  return { ...actual, requireAcceptedAuth: requireAcceptedAuthMock };
});

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: (scope: string, identifier: string) => `${scope}:${identifier}`,
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
  captureException: vi.fn(),
  reportHandledException: vi.fn(),
}));

vi.mock("@/lib/email/resend", () => ({
  sendReportNotificationEmail: vi.fn(),
  sendSellerContactEmail: sendSellerContactEmailMock,
  sendContactConfirmationEmail: sendContactConfirmationEmailMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { contactSeller } = await import("@/actions/listings");

const listingId = "cllisting123456789012345678";
const contactInput = {
  listingId,
  name: "Buyer",
  email: "buyer@example.com",
  message: "Is this vehicle still available today?",
  website: "",
};

describe("contactSeller correspondence routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.dealerProfile.findFirst.mockResolvedValue({ id: "dealer-1" });
    requireAcceptedAuthMock.mockResolvedValue({ id: "buyer-1", role: "USER" });
    checkRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 1000,
      unavailable: false,
    });
    sendSellerContactEmailMock.mockResolvedValue(undefined);
    sendContactConfirmationEmailMock.mockResolvedValue(undefined);
  });

  it("keeps a private seller enquiry on the listing owner", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      title: "Private van",
      status: "LIVE",
      expiresAt: null,
      dealerId: null,
      user: { email: "seller@example.com" },
    });

    await expect(contactSeller(contactInput)).resolves.toEqual({ data: { sent: true } });
    expect(mockDb.dealerCorrespondenceSettings.findUnique).not.toHaveBeenCalled();
    expect(sendSellerContactEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ sellerEmail: ["seller@example.com"] }),
    );
  });

  it("sends a dealer enquiry to the verified second address", async () => {
    mockDb.listing.findUnique.mockResolvedValue({
      id: listingId,
      title: "Dealer van",
      status: "LIVE",
      expiresAt: null,
      dealerId: "dealer-1",
      user: { email: "owner@dealer.example" },
    });
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue({
      verifiedEmail: "sales@dealer.example",
      categories: ["BUYER_ENQUIRIES"],
      copyAssignedToPrimary: true,
    });

    await contactSeller(contactInput);

    expect(sendSellerContactEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerEmail: ["sales@dealer.example", "owner@dealer.example"],
      }),
    );
    expect(sendContactConfirmationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ buyerEmail: "buyer@example.com" }),
    );
  });

  it("rejects enquiries to a dealer whose membership is no longer public", async () => {
    mockDb.dealerProfile.findFirst.mockResolvedValue(null);
    mockDb.listing.findUnique.mockResolvedValue({ id: listingId, title: "Dealer van", status: "LIVE", expiresAt: null, dealerId: "dealer-1", user: { email: "owner@dealer.example" } });
    expect(await contactSeller(contactInput)).toEqual({ error: "Listing unavailable" });
    expect(sendSellerContactEmailMock).not.toHaveBeenCalled();
    expect(sendContactConfirmationEmailMock).not.toHaveBeenCalled();
  });
});
