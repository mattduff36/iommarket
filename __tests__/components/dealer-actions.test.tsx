// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/actions/admin/dealers", () => ({
  verifyDealer: vi.fn(),
  downgradeDealerToUser: vi.fn(),
}));

vi.mock("@/actions/admin/dealer-tier", () => ({
  setDealerTier: vi.fn(),
}));

vi.mock("@/actions/admin/users", () => ({
  grantDealerAccess: vi.fn(),
  setUserRole: vi.fn(),
}));

import { DealerActions } from "@/app/(admin)/admin/dealers/dealer-actions";

describe("DealerActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits package controls and row-height helper copy for paid subscriptions", async () => {
    const user = userEvent.setup();
    render(
      <DealerActions
        dealerId="dealer-1"
        dealerName="TD Car Centre"
        userId="user-1"
        userLabel="Taylor"
        verified
        canGrantAccess
        currentTier="PRO"
        hasActivePaidSubscription
      />,
    );

    expect(screen.queryByText(/paid subscription/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions for TD Car Centre" }));
    expect(screen.getByRole("menuitem", { name: "Unverify dealer" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Change package" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Downgrade to user" })).toBeInTheDocument();
  });

  it("does not offer to downgrade an admin-owned dealer profile", async () => {
    const user = userEvent.setup();
    render(
      <DealerActions
        dealerId="dealer-1"
        dealerName="Admin Motors"
        userId="admin-1"
        userLabel="Admin"
        verified
        canGrantAccess={false}
        currentTier="PRO"
        hasActivePaidSubscription={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for Admin Motors" }));
    expect(
      screen.queryByRole("menuitem", { name: "Downgrade to user" }),
    ).not.toBeInTheDocument();
  });
});
