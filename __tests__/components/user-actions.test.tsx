// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteUser, setUserRole, setDealerTier, revokeDealerAccess } = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  setUserRole: vi.fn(),
  setDealerTier: vi.fn(),
  revokeDealerAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/actions/admin/users", () => ({
  deleteUser,
  restoreUser: vi.fn(),
  revokeDealerAccess,
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
  setDealerTier,
}));

import { UserActions } from "@/app/(admin)/admin/users/user-actions";

describe("UserActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteUser.mockResolvedValue({ data: { success: true } });
    setUserRole.mockResolvedValue({ data: { role: "ADMIN" } });
    setDealerTier.mockResolvedValue({ data: { success: true } });
    revokeDealerAccess.mockResolvedValue({ data: { success: true } });
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

  it("confirms role and package changes, then acknowledges success", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <UserActions
        userId="user-1"
        currentRole="USER"
        isDisabled={false}
        userLabel="Alice"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.getByText(/grants administrator access/i)).toBeInTheDocument();
    expect(setUserRole).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Update role" }));
    expect(setUserRole).toHaveBeenCalledWith({ userId: "user-1", role: "ADMIN" });
    expect(await screen.findByRole("status")).toHaveTextContent("Account role updated.");

    rerender(
      <UserActions
        userId="user-1"
        currentRole="DEALER"
        currentTier="STARTER"
        isDisabled={false}
        userLabel="Alice"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pro" }));
    expect(screen.getByText(/updates the dealer package/i)).toBeInTheDocument();
    expect(setDealerTier).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Update package" }));
    expect(setDealerTier).toHaveBeenCalledWith({ userId: "user-1", tier: "PRO" });
    expect(await screen.findByRole("status")).toHaveTextContent("Dealer package updated.");
  });

  it("explains revoke effects, prevents duplicate requests, and shows returned warnings", async () => {
    const user = userEvent.setup();
    let resolveAction: ((value: { data: { success: true }; warning: string }) => void) | undefined;
    revokeDealerAccess.mockImplementation(
      () => new Promise((resolve) => { resolveAction = resolve; }),
    );
    render(
      <UserActions
        userId="user-1"
        currentRole="DEALER"
        isDisabled={false}
        userLabel="Alice"
        hasActiveAdminGrant
      />,
    );

    await user.click(screen.getByRole("button", { name: "Revoke free access" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/dealer listings will be hidden/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/login remains active/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/paid Ripple subscription is unchanged and is not cancelled/i)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Revoke free access" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(revokeDealerAccess).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    resolveAction?.({ data: { success: true }, warning: "Access revoked, but the email could not be sent." });
    expect(await screen.findByRole("status")).toHaveTextContent("Access revoked, but the email could not be sent.");

    setUserRole.mockRejectedValueOnce(new Error("secret server detail"));
    await user.click(screen.getByRole("button", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Update role" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to update role");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
