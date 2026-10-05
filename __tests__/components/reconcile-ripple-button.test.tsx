// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReconcileRippleButton } from "@/app/(admin)/admin/payments/payment-actions";
import { adminActionsCellClass } from "@/components/admin/admin-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/actions/admin/payments", () => ({
  adminReconcileRipplePayment: vi.fn(),
  adminRefundPayment: vi.fn(),
}));

describe("ReconcileRippleButton", () => {
  it("keeps the closed action compact", () => {
    render(<ReconcileRippleButton paymentId="pay-1" />);

    expect(screen.getByRole("button", { name: "Reconcile" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Ripple payment job reference")).not.toBeInTheDocument();
  });

  it("opens a bounded vertical recovery form inside a nowrap action cell", async () => {
    const user = userEvent.setup();
    render(
      <table>
        <tbody>
          <tr>
            <td className={adminActionsCellClass}>
              <ReconcileRippleButton paymentId="pay-1" />
            </td>
          </tr>
        </tbody>
      </table>,
    );

    await user.click(screen.getByRole("button", { name: "Reconcile" }));

    const form = screen.getByText(/not proof of payment/).parentElement;
    expect(form).toHaveClass(
      "flex",
      "flex-col",
      "whitespace-normal",
      "text-left",
      "min-w-0",
      "w-80",
      "max-w-[min(20rem,80vw)]",
    );
    expect(screen.getByText(/Enter evidence copied from Ripple/)).toBeInTheDocument();
    expect(screen.getByLabelText("Ripple payment job reference")).toHaveClass("w-full", "min-w-0");
    expect(screen.getByLabelText("Ripple payment time")).toHaveClass("w-full", "min-w-0");
    expect(screen.getByLabelText("Reconciliation notes")).toHaveClass("w-full", "min-w-0");
    expect(screen.getByRole("checkbox", { name: /Amount, GBP currency/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /paid and not refunded/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm recovery" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
