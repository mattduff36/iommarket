import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAcceptedAuthMock,
  checkRateLimitMock,
  makeRateLimitKeyMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAcceptedAuthMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  makeRateLimitKeyMock: vi.fn(),
  mockDb: {
    listing: {
      findUnique: vi.fn(),
    },
    favourite: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    report: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAcceptedAuthMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: makeRateLimitKeyMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/email/resend", () => ({
  sendReportNotificationEmail: vi.fn(),
  sendSellerContactEmail: vi.fn(),
  sendContactConfirmationEmail: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { contactSeller, reportListing } = await import("@/actions/listings");
const { toggleFavourite } = await import("@/actions/user-tools");

const PREVIEW_LISTING = {
  id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
  title: "Preview van",
  status: "ADMIN_PREVIEW",
  expiresAt: null,
  user: { email: "preview+athol-garage@preview.internal" },
};

describe("preview pack marketplace action gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockReturnValue({ allowed: true });
    requireAcceptedAuthMock.mockResolvedValue({
      id: "cluserxxxxxxxxxxxxxxxxxxxxx",
      role: "USER",
    });
    mockDb.listing.findUnique.mockResolvedValue(PREVIEW_LISTING);
  });

  it("refuses contact, favourite, and report on ADMIN_PREVIEW listings", async () => {
    await expect(
      contactSeller({
        listingId: PREVIEW_LISTING.id,
        name: "Buyer",
        email: "buyer@example.com",
        message: "Is this vehicle still available today?",
        website: "",
      }),
    ).resolves.toEqual({ error: "Listing unavailable" });

    await expect(
      reportListing({
        listingId: PREVIEW_LISTING.id,
        reporterEmail: "buyer@example.com",
        reasonCode: "FRAUD",
        reason: "This listing appears to be a scam with fake photos",
      }),
    ).resolves.toEqual({ error: "Listing unavailable" });

    await expect(
      toggleFavourite({ listingId: PREVIEW_LISTING.id }),
    ).resolves.toEqual({ error: "Listing unavailable" });

    expect(mockDb.report.create).not.toHaveBeenCalled();
    expect(mockDb.favourite.create).not.toHaveBeenCalled();
    expect(mockDb.favourite.delete).not.toHaveBeenCalled();
  });
});
