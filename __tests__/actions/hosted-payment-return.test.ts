import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  getCurrentUserMock,
  supabaseGetUserMock,
  decodeContextMock,
  reconcileMock,
  checkRateLimitMock,
  makeRateLimitKeyMock,
  revalidatePathMock,
  paymentFindUnique,
  chargeFindFirst,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  supabaseGetUserMock: vi.fn(),
  decodeContextMock: vi.fn(),
  reconcileMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  makeRateLimitKeyMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  paymentFindUnique: vi.fn(),
  chargeFindFirst: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: supabaseGetUserMock } }),
}));
vi.mock("@/lib/payments/hosted-return-context", () => ({
  HOSTED_RETURN_COOKIE: "itrader-listing-checkout",
  decodeHostedReturnContext: decodeContextMock,
}));
vi.mock("@/lib/payments/reconcile-hosted-return", () => ({
  reconcileHostedReturn: reconcileMock,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  makeRateLimitKey: makeRateLimitKeyMock,
}));
vi.mock("@/lib/db", () => ({
  db: {
    payment: { findUnique: (...args: unknown[]) => paymentFindUnique(...args) },
    subscriptionCharge: { findFirst: (...args: unknown[]) => chargeFindFirst(...args) },
  },
}));

import { confirmHostedListingPayment, readHostedCheckoutLink } from "@/actions/hosted-payment-return";

const context = {
  userId: "user-1",
  paymentId: "payment-1",
  listingId: "listing-1",
  email: "seller@example.com",
  merchantReference: "merchant-ref-1",
  issuedAt: Date.now(),
};
const sessionUser = {
  id: "user-1",
  authUserId: "auth-1",
  email: "Seller@Example.com",
};
const authUser = {
  id: "auth-1",
  email: "seller@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
};
const longPaymentJobRef = "987654321098765432109876";

describe("confirmHostedListingPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({
      get: () => ({ value: "signed-context" }),
    });
    decodeContextMock.mockReturnValue(context);
    getCurrentUserMock.mockResolvedValue(sessionUser);
    supabaseGetUserMock.mockResolvedValue({ data: { user: authUser } });
    makeRateLimitKeyMock.mockReturnValue("hosted-return:user-1");
    checkRateLimitMock.mockResolvedValue({ allowed: true, unavailable: false });
    reconcileMock.mockResolvedValue({ status: "waiting" });
  });

  it("rejects malformed job references before reading context or doing work", async () => {
    expect(await confirmHostedListingPayment("12x")).toEqual({ status: "review" });
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("does not reconcile when the return cookie is absent or invalid", async () => {
    cookiesMock.mockResolvedValue({ get: () => undefined });
    decodeContextMock.mockReturnValueOnce(null);

    expect(await confirmHostedListingPayment(longPaymentJobRef)).toEqual({ status: "review" });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    expect(await confirmHostedListingPayment(longPaymentJobRef)).toEqual({ status: "sign-in" });
    expect(supabaseGetUserMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unconfirmed email", { ...authUser, email_confirmed_at: null }],
    ["different auth email", { ...authUser, email: "other@example.com" }],
    ["different auth user", { ...authUser, id: "auth-other" }],
  ])("rejects an %s", async (_caseName, returnedAuthUser) => {
    supabaseGetUserMock.mockResolvedValue({ data: { user: returnedAuthUser } });

    expect(await confirmHostedListingPayment(longPaymentJobRef)).toEqual({ status: "review" });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("rejects a different session user or email", async () => {
    getCurrentUserMock.mockResolvedValue({ ...sessionUser, id: "user-other" });
    expect(await confirmHostedListingPayment(longPaymentJobRef)).toEqual({ status: "review" });
    expect(supabaseGetUserMock).not.toHaveBeenCalled();

    getCurrentUserMock.mockResolvedValue({ ...sessionUser, email: "other@example.com" });
    expect(await confirmHostedListingPayment(longPaymentJobRef)).toEqual({ status: "review" });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("denies unavailable or rate-limited requests before reconciliation", async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, unavailable: false });

    expect(await confirmHostedListingPayment(longPaymentJobRef)).toEqual({ status: "waiting" });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("delegates the exact job reference string and revalidates only confirmed results", async () => {
    reconcileMock.mockResolvedValueOnce({ status: "waiting" });
    expect(await confirmHostedListingPayment(longPaymentJobRef)).toEqual({ status: "waiting" });
    expect(reconcileMock).toHaveBeenLastCalledWith(context, longPaymentJobRef);
    expect(revalidatePathMock).not.toHaveBeenCalled();

    reconcileMock.mockResolvedValueOnce({ status: "confirmed", listingId: "listing-1" });
    expect(await confirmHostedListingPayment(longPaymentJobRef)).toEqual({
      status: "confirmed",
      listingId: "listing-1",
    });
    expect(reconcileMock).toHaveBeenLastCalledWith(context, longPaymentJobRef);
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/sell/checkout"],
      ["/account/listings"],
    ]);
  });
});

describe("readHostedCheckoutLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({ get: () => ({ value: "signed-context" }) });
    decodeContextMock.mockReturnValue(context);
    getCurrentUserMock.mockResolvedValue(sessionUser);
    supabaseGetUserMock.mockResolvedValue({ data: { user: authUser } });
    makeRateLimitKeyMock.mockReturnValue("hosted-return:user-1");
    checkRateLimitMock.mockResolvedValue({ allowed: true, unavailable: false });
  });

  it("confirms a linked payment from the signed cookie without reconciling a provider reference", async () => {
    paymentFindUnique.mockResolvedValue({
      status: "SUCCEEDED",
      refundedAt: null,
      listingId: "listing-1",
      listing: { userId: "user-1" },
    });

    await expect(readHostedCheckoutLink()).resolves.toEqual({
      status: "confirmed",
      context: "listing",
      listingId: "listing-1",
    });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("does not treat a pending payment as linked", async () => {
    paymentFindUnique.mockResolvedValue({
      status: "PENDING",
      refundedAt: null,
      listingId: "listing-1",
      listing: { userId: "user-1" },
    });

    await expect(readHostedCheckoutLink()).resolves.toEqual({
      status: "waiting",
      context: "listing",
      listingId: "listing-1",
    });
  });
});
