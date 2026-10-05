// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminRefundSubscriptionPayment } from "@/actions/admin/payments";
import { RefundSubPaymentButton } from "@/app/(admin)/admin/payments/subscription-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/actions/admin/payments", () => ({
  adminRefundSubscriptionPayment: vi.fn(),
  adminCancelSubscription: vi.fn(),
}));

const subscriptionId = "clxxxxxxxxxxxxxxxxxxxxxxxxx";
const charge = {
  id: "claaaaaaaaaaaaaaaaaaaaaaa",
  amount: 4999,
  currency: "gbp",
  paymentReference: "pay-later",
};

describe("RefundSubPaymentButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows that there is no unrefunded payment to confirm", () => {
    render(
      <RefundSubPaymentButton
        subscriptionId={subscriptionId}
        charge={null}
        recordLocally
      />,
    );

    expect(screen.getByText("No unrefunded payment")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record portal refund" })).not.toBeInTheDocument();
  });

  it("confirms the fixture charge and retries that same operation", async () => {
    const user = userEvent.setup();
    vi.mocked(adminRefundSubscriptionPayment)
      .mockResolvedValueOnce({ error: "Try again" })
      .mockResolvedValueOnce({ data: { refunded: true, chargeId: charge.id } });

    render(
      <RefundSubPaymentButton
        subscriptionId={subscriptionId}
        charge={charge}
        recordLocally
      />,
    );

    await user.click(screen.getByRole("button", { name: "Record portal refund" }));
    expect(screen.getByText(/pay-later/)).toHaveTextContent("£49.99");
    expect(screen.getByText(/does not send a refund to Ripple/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm record" }));
    expect(await screen.findByText("Try again")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm record" }));

    expect(adminRefundSubscriptionPayment).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(adminRefundSubscriptionPayment).mock.calls;
    expect(first?.[0]).toMatchObject({
      subscriptionId,
      chargeId: charge.id,
      reason: "REQUESTED_BY_CUSTOMER",
    });
    expect(second?.[0]).toMatchObject({
      subscriptionId,
      chargeId: charge.id,
      operationId: first?.[0].operationId,
    });
    expect(first?.[0].operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
