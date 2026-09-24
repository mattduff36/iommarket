import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDisabledError, AuthenticationRequiredError } from "@/lib/auth";
import { PolicyAcceptanceRequiredError } from "@/lib/policy/gate";

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
    listing: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/policy/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy/gate")>(
    "@/lib/policy/gate",
  );
  return {
    ...actual,
    requireAcceptedAuth: requireAcceptedAuthMock,
  };
});

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
  captureException: vi.fn(),
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

const contactInput = {
  listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
  name: "Buyer",
  email: "buyer@example.com",
  message: "Is this vehicle still available today?",
  website: "",
};

describe("contactSeller authorisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function expectBlocked(error: Error) {
    requireAcceptedAuthMock.mockRejectedValue(error);

    await expect(contactSeller(contactInput)).resolves.toEqual({
      error: "Sign in to message the seller.",
    });

    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(mockDb.listing.findUnique).not.toHaveBeenCalled();
    expect(sendSellerContactEmailMock).not.toHaveBeenCalled();
    expect(sendContactConfirmationEmailMock).not.toHaveBeenCalled();
  }

  it("AUTH-ENQ-001 refuses an unauthenticated enquiry before rate limit, database, or email", async () => {
    await expectBlocked(new AuthenticationRequiredError());
  });

  it("AUTH-ENQ-001 refuses a disabled account before rate limit, database, or email", async () => {
    await expectBlocked(new AccountDisabledError());
  });

  it("AUTH-ENQ-001 refuses an account without current policy acceptance", async () => {
    await expectBlocked(new PolicyAcceptanceRequiredError());
  });
});
