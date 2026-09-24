import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";

describe("AdminConfirmDialog", () => {
  it("confirms, cancels, and shows a pending state", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <AdminConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete Alice?"
        description="This marks the account deleted and disabled."
        confirmLabel="Delete account"
        destructive
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Delete Alice?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <AdminConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete Alice?"
        description="This marks the account deleted and disabled."
        confirmLabel="Delete account"
        destructive
        pending
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Working…" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
