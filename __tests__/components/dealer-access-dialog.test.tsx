import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setUserRoleMock, grantDealerAccessMock } = vi.hoisted(() => ({
  setUserRoleMock: vi.fn(),
  grantDealerAccessMock: vi.fn(),
}));

vi.mock("@/actions/admin/users", () => ({
  setUserRole: setUserRoleMock,
  grantDealerAccess: grantDealerAccessMock,
}));

import { DealerAccessDialog } from "@/app/(admin)/admin/users/dealer-access-dialog";

describe("DealerAccessDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUserRoleMock.mockResolvedValue({ data: { role: "DEALER" } });
    grantDealerAccessMock.mockResolvedValue({
      data: { source: "ADMIN_GRANT" },
    });
  });

  it("requires explicit confirmation with an accessible duration choice", async () => {
    const onOpenChange = vi.fn();
    const onCompleted = vi.fn();

    render(
      <DealerAccessDialog
        userId="clxxxxxxxxxxxxxxxxxxxxxxxxx"
        userLabel="Manx Motors"
        mode="promote"
        open
        onOpenChange={onOpenChange}
        onCompleted={onCompleted}
      />
    );

    expect(
      screen.getByRole("dialog", { name: "Promote to dealer" })
    ).toBeTruthy();
    expect(screen.getByText(/No payment will be taken or recorded/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "90 days" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Promote to dealer" })
    );

    await waitFor(() => {
      expect(setUserRoleMock).toHaveBeenCalledWith({
        userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        role: "DEALER",
        grantDurationDays: 90,
      });
    });
    expect(onCompleted).toHaveBeenCalled();
  });

  it("validates a custom duration before granting existing dealer access", () => {
    render(
      <DealerAccessDialog
        userId="clxxxxxxxxxxxxxxxxxxxxxxxxx"
        userLabel="Manx Motors"
        mode="grant"
        open
        onOpenChange={vi.fn()}
        onCompleted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /Custom duration/i }));
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "Custom access duration in days",
      }),
      { target: { value: "0" } }
    );

    expect(
      screen
        .getByRole("button", { name: "Grant free access" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(grantDealerAccessMock).not.toHaveBeenCalled();
  });
});
