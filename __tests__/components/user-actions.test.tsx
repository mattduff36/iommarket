// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteUser, setUserRole } = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  setUserRole: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/actions/admin/users", () => ({
  deleteUser,
  restoreUser: vi.fn(),
  revokeDealerAccess: vi.fn(),
  resendDealerUpgradeOffer: vi.fn(),
  cancelDealerUpgradeOffer: vi.fn(),
  setUserRole,
  setUserDisabled: vi.fn(),
  grantDealerAccess: vi.fn(),
}));

vi.mock("@/actions/admin/dealer-upgrade-offers", () => ({
  resendDealerUpgradeOffer: vi.fn(),
  cancelDealerUpgradeOffer: vi.fn(),
}));

vi.mock("@/actions/admin/dealer-tier", () => ({
  setDealerTier: vi.fn(),
}));

import { UserActions } from "@/app/(admin)/admin/users/user-actions";

describe("UserActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteUser.mockResolvedValue({ data: { success: true } });
    setUserRole.mockResolvedValue({ data: { role: "ADMIN" } });
  });

  it("confirms a permanent delete from the row menu", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    render(
      <UserActions
        variant="row"
        userId="user-1"
        currentRole="USER"
        isDisabled={false}
        userLabel="Alice"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for Alice" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByText(/permanently deletes the account/i)).toBeInTheDocument();
    expect(screen.queryByText(/can be restored/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    expect(deleteUser).toHaveBeenCalledWith({ userId: "user-1" });
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("keeps paid-subscription guidance out of compact table rows", () => {
    render(
      <UserActions
        variant="row"
        userId="user-1"
        currentRole="DEALER"
        isDisabled={false}
        userLabel="Alice"
        currentTier="PRO"
        hasActivePaidSubscription
      />,
    );

    expect(screen.queryByText(/paid subscription/i)).not.toBeInTheDocument();
  });

  it("keeps historical dealer package controls read-only after downgrade", async () => {
    const user = userEvent.setup();
    render(
      <UserActions
        variant="detail"
        userId="user-1"
        currentRole="USER"
        isDisabled={false}
        userLabel="Alice"
        currentTier="STARTER"
        hasActivePaidSubscription
      />,
    );

    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.queryByText(/paid subscription/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Package")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dealer" }));
    expect(screen.getByRole("button", { name: "Send dealer offer" })).toBeInTheDocument();
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("omits Change package from a downgraded user's row menu", async () => {
    const user = userEvent.setup();
    render(
      <UserActions
        variant="row"
        userId="user-1"
        currentRole="USER"
        isDisabled={false}
        userLabel="Alice"
        currentTier="STARTER"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for Alice" }));
    expect(
      screen.queryByRole("menuitem", { name: "Change package" }),
    ).not.toBeInTheDocument();
  });

  it("shows resend and cancel controls for a pending dealer offer", () => {
    render(
      <UserActions
        variant="detail"
        userId="user-1"
        currentRole="USER"
        isDisabled={false}
        userLabel="Alice"
        pendingDealerUpgradeOfferId="clofferxxxxxxxxxxxxxxxxxxx"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Resend dealer offer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel dealer offer" }),
    ).toBeInTheDocument();
  });
});
