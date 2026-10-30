// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, requireRole, expireStaleLiveListings, getSampleVisibility, resolveVisibleAdminPaymentWhere } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  expireStaleLiveListings: vi.fn(),
  getSampleVisibility: vi.fn(),
  resolveVisibleAdminPaymentWhere: vi.fn(async (where: unknown) => where),
  dbMock: {
    user: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    dealerProfile: { findMany: vi.fn(), count: vi.fn() },
    listing: { findMany: vi.fn(), count: vi.fn() },
    subscription: { findFirst: vi.fn() },
    tradeMembership: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    tradeReport: { count: vi.fn() },
    tradeListing: { count: vi.fn() },
    report: { count: vi.fn(), findMany: vi.fn() },
    dealerReview: { count: vi.fn() },
    dealerReviewResponseRevision: { count: vi.fn() },
    dealerReviewDispute: { count: vi.fn() },
    dealerCancellationRequest: { count: vi.fn() },
    monitoringIssue: { count: vi.fn() },
    payment: { count: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
    subscriptionCharge: { count: vi.fn(async () => 0), aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error("not found");
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ requireRole }));
vi.mock("@/lib/listings/expiry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listings/expiry")>();
  return { ...actual, expireStaleLiveListings };
});
vi.mock("@/lib/listings/sample-visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listings/sample-visibility")>();
  return { ...actual, getSampleVisibility };
});
vi.mock("@/lib/payments/payment-visibility", () => ({
  resolveVisibleAdminPaymentWhere,
}));
vi.mock("@/actions/admin/users", () => ({
  deleteUser: vi.fn(),
  revokeDealerAccess: vi.fn(),
  setUserRole: vi.fn(),
  setUserDisabled: vi.fn(),
}));
vi.mock("@/actions/admin/dealer-upgrade-offers", () => ({
  cancelDealerUpgradeOffer: vi.fn(),
  resendDealerUpgradeOffer: vi.fn(),
}));
vi.mock("@/actions/admin/dealer-tier", () => ({ setDealerTier: vi.fn() }));
vi.mock("@/actions/admin/dealers", () => ({
  verifyDealer: vi.fn(),
  downgradeDealerToUser: vi.fn(),
}));

import { DealerActions } from "@/app/(admin)/admin/dealers/dealer-actions";
import { UserActions } from "@/app/(admin)/admin/users/user-actions";

const PRO_PLAN = "C5D44F6F18094B94";

function dealerUser(overrides?: { membership?: { id: string; status: "PENDING" } | null; verified?: boolean }) {
  const now = new Date("2026-10-15T12:00:00Z");
  return {
    id: "user-1",
    name: "Test Motors",
    email: "dealer@example.com",
    phone: null,
    bio: null,
    authUserId: "auth-1",
    role: "DEALER" as const,
    deletedAt: null,
    disabledAt: null,
    disabledReason: null,
    createdAt: now,
    updatedAt: now,
    region: { name: "Douglas" },
    dealerUpgradeOffers: [],
    dealerProfile: {
      id: "dealer-1",
      name: "Test Motors",
      slug: "test-motors",
      tier: "PRO" as const,
      verified: overrides?.verified ?? true,
      phone: null,
      bio: null,
      website: null,
      subscriptions: [
        {
          id: "sub-1",
          status: "ACTIVE" as const,
          source: "PAYMENT" as const,
          paymentProvider: "RIPPLE" as const,
          providerPlanId: PRO_PLAN,
          providerSubscriptionId: "sub-live",
          stripeSubscriptionId: null,
          currentPeriodEnd: new Date("2026-11-15T12:00:00Z"),
          grantStartsAt: null,
          grantEndsAt: null,
          revokedAt: null,
          createdAt: now,
        },
      ],
      _count: { listings: 0 },
    },
    _count: { listings: 0, favourites: 0, savedSearches: 0, reports: 0, listingViews: 0 },
    membership: overrides?.membership === undefined
      ? { id: "mem-test", status: "PENDING" as const }
      : overrides.membership,
  };
}

describe("trade admin integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRADE_EXCHANGE_ENABLED = "1";
    getSampleVisibility.mockResolvedValue({ privateListings: true, dealerListings: true });
    expireStaleLiveListings.mockResolvedValue(undefined);
    requireRole.mockResolvedValue(undefined);
    dbMock.user.count.mockResolvedValue(0);
    dbMock.user.findMany.mockResolvedValue([]);
    dbMock.dealerProfile.count.mockResolvedValue(0);
    dbMock.dealerProfile.findMany.mockResolvedValue([]);
    dbMock.listing.count.mockResolvedValue(0);
    dbMock.listing.findMany.mockResolvedValue([]);
    dbMock.subscription.findFirst.mockResolvedValue(null);
    dbMock.tradeMembership.findMany.mockResolvedValue([]);
    dbMock.tradeMembership.findUnique.mockResolvedValue(null);
    dbMock.tradeMembership.count.mockResolvedValue(0);
    dbMock.tradeReport.count.mockResolvedValue(0);
    dbMock.tradeListing.count.mockResolvedValue(0);
    dbMock.report.count.mockResolvedValue(0);
    dbMock.report.findMany.mockResolvedValue([]);
    dbMock.dealerReview.count.mockResolvedValue(0);
    dbMock.dealerReviewResponseRevision.count.mockResolvedValue(0);
    dbMock.dealerReviewDispute.count.mockResolvedValue(0);
    dbMock.dealerCancellationRequest.count.mockResolvedValue(0);
    dbMock.monitoringIssue.count.mockResolvedValue(0);
    dbMock.payment.count.mockResolvedValue(0);
    dbMock.payment.findMany.mockResolvedValue([]);
    dbMock.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  });

  it("adds a review link from the user row and detail only when a membership id exists", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <UserActions variant="row" userId="user-1" currentRole="DEALER" isDisabled={false} userLabel="Test Motors" tradeMembershipId="mem-test" />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Test Motors" }));
    expect(screen.getByRole("menuitem", { name: "Review Trade application" })).toHaveAttribute(
      "href",
      "/admin/trade/applications/mem-test",
    );

    rerender(
      <UserActions variant="detail" userId="user-1" currentRole="DEALER" isDisabled={false} userLabel="Test Motors" tradeMembershipId="mem-test" />,
    );
    expect(screen.getByRole("link", { name: "Review Trade application" })).toHaveAttribute(
      "href",
      "/admin/trade/applications/mem-test",
    );

    rerender(
      <UserActions variant="row" userId="user-1" currentRole="DEALER" isDisabled={false} userLabel="Test Motors" />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Test Motors" }));
    expect(screen.queryByRole("menuitem", { name: "Review Trade application" })).not.toBeInTheDocument();
  });

  it("adds the dealer menu review link from the membership id", async () => {
    const user = userEvent.setup();
    render(
      <DealerActions
        dealerId="dealer-1"
        dealerName="Test Motors"
        userId="user-1"
        userLabel="Test Motors"
        verified
        canGrantAccess
        currentTier="PRO"
        hasActivePaidSubscription
        tradeMembershipId="mem-test"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Test Motors" }));
    expect(screen.getByRole("menuitem", { name: "Review Trade application" })).toHaveAttribute(
      "href",
      "/admin/trade/applications/mem-test",
    );

    cleanup();
    render(
      <DealerActions
        dealerId="dealer-1"
        dealerName="Test Motors"
        userId="user-1"
        userLabel="Test Motors"
        verified
        canGrantAccess
        currentTier="PRO"
        hasActivePaidSubscription={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Test Motors" }));
    expect(screen.queryByRole("menuitem", { name: "Review Trade application" })).not.toBeInTheDocument();
  });

  it("keeps a pending Trade application separate from an active account", async () => {
    const record = dealerUser();
    dbMock.user.findFirst.mockResolvedValue(record);
    dbMock.subscription.findFirst.mockResolvedValue({ id: "sub-1" });
    dbMock.tradeMembership.findUnique.mockResolvedValue(record.membership);
    const { default: Page } = await import("@/app/(admin)/admin/users/[id]/page");
    render(await Page({ params: Promise.resolve({ id: "user-1" }) }));

    expect(screen.getAllByText("Active").length).toBeGreaterThan(1);
    expect(screen.getByText("Public verified")).toBeInTheDocument();
    expect(screen.getByText("Trade application:")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("Active Pro:")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(1);
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review Trade application" })).toHaveAttribute(
      "href",
      "/admin/trade/applications/mem-test",
    );
    expect(dbMock.tradeMembership.findUnique).toHaveBeenCalledWith({
      where: { dealerId: "dealer-1" },
      select: { id: true, status: true },
    });
  });

  it("links dealers with no application to the list without inventing an id", async () => {
    const record = dealerUser({ membership: null, verified: false });
    record.dealerProfile.subscriptions = [];
    dbMock.user.findFirst.mockResolvedValue(record);
    dbMock.tradeMembership.findUnique.mockResolvedValue(null);
    const { default: Page } = await import("@/app/(admin)/admin/users/[id]/page");
    render(await Page({ params: Promise.resolve({ id: "user-1" }) }));

    expect(screen.getByText("Public unverified")).toBeInTheDocument();
    expect(screen.getByText("Not applied")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Applications" })).toHaveAttribute("href", "/admin/trade/applications");
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review Trade application" })).not.toBeInTheDocument();
  });

  it("labels the users list public badge separately from the Trade application", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    dbMock.user.findMany.mockResolvedValue([
      {
        id: "user-1",
        name: "Test Motors",
        email: "dealer@example.com",
        phone: null,
        role: "DEALER",
        deletedAt: null,
        disabledAt: null,
        createdAt: now,
        updatedAt: now,
        region: { name: "Douglas" },
        dealerUpgradeOffers: [],
        dealerProfile: {
          id: "dealer-1",
          name: "Test Motors",
          verified: true,
          tier: "PRO",
          subscriptions: [],
        },
        _count: { listings: 0 },
      },
    ]);
    dbMock.user.count.mockResolvedValue(1);
    dbMock.tradeMembership.findMany.mockResolvedValue([
      { id: "mem-test", dealerId: "dealer-1", status: "PENDING" },
    ]);
    const { default: Page } = await import("@/app/(admin)/admin/users/page");
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Trade")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Dealer Pro")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Test Motors" }));
    expect(screen.getByRole("menuitem", { name: "Review Trade application" })).toHaveAttribute(
      "href",
      "/admin/trade/applications/mem-test",
    );
  });

  it("shows Not applied on a dealer row without inventing an application id", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    dbMock.dealerProfile.findMany.mockResolvedValue([
      {
        id: "dealer-1",
        name: "Test Motors",
        slug: "test-motors",
        tier: "PRO",
        verified: false,
        createdAt: now,
        updatedAt: now,
        user: { id: "user-1", email: "dealer@example.com", name: "Test Motors", role: "DEALER", disabledAt: null },
        _count: { listings: 0, subscriptions: 0 },
        subscriptions: [],
      },
    ]);
    dbMock.dealerProfile.count.mockResolvedValue(1);
    dbMock.tradeMembership.findMany.mockResolvedValue([]);
    const { default: Page } = await import("@/app/(admin)/admin/dealers/page");
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("Public unverified").length).toBeGreaterThan(0);
    expect(screen.getByText("Trade")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByText("Not applied")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Not applied" })).toHaveAttribute("href", "/admin/trade/applications");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Test Motors" }));
    expect(screen.queryByRole("menuitem", { name: "Review Trade application" })).not.toBeInTheDocument();
  });

  it("shows the private Trade queue on the dashboard only while the flag is on", async () => {
    dbMock.tradeMembership.count.mockImplementation(async ({ where }: { where?: { status?: string } }) =>
      where?.status === "PENDING" ? 2 : 0,
    );
    dbMock.tradeReport.count.mockResolvedValue(1);
    dbMock.tradeListing.count.mockResolvedValue(4);
    const { default: Dashboard } = await import("@/app/(admin)/admin/page");
    const { unmount } = render(await Dashboard());
    expect(screen.getByRole("link", { name: "Open private Trade" })).toHaveAttribute("href", "/admin/trade");
    expect(screen.getByRole("link", { name: /Applications waiting/ })).toHaveAttribute(
      "href",
      "/admin/trade/applications?status=PENDING",
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(dbMock.tradeMembership.count).toHaveBeenCalled();
    unmount();

    process.env.TRADE_EXCHANGE_ENABLED = "0";
    dbMock.tradeMembership.count.mockClear();
    render(await Dashboard());
    expect(screen.queryByRole("link", { name: "Open private Trade" })).not.toBeInTheDocument();
    expect(dbMock.tradeMembership.count).not.toHaveBeenCalled();
  });
});
