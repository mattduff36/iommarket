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
  setUserRole,
  setUserDisabled: vi.fn(),
  grantDealerAccess: vi.fn(),
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

  it("confirms a reversible soft delete from the row menu", async () => {
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
    expect(screen.getByText(/listings stay archived/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    expect(deleteUser).toHaveBeenCalledWith({ userId: "user-1" });
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("keeps visible controls and the dealer promotion dialog on the detail page", async () => {
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
    expect(screen.getByText(/paid subscription/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dealer" }));
    expect(screen.getByRole("button", { name: "Promote to dealer" })).toBeInTheDocument();
    expect(setUserRole).not.toHaveBeenCalled();
  });
});
