import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { acceptDealerUpgradeMock, pushMock, refreshMock } = vi.hoisted(() => ({
  acceptDealerUpgradeMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/actions/dealer-upgrade", () => ({
  acceptDealerUpgrade: acceptDealerUpgradeMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { DealerUpgradeForm } from "@/app/(public)/account/dealer-upgrade/dealer-upgrade-form";

const offerId = "clofferxxxxxxxxxxxxxxxxxxx";
const policyDigest = "a".repeat(64);

describe("DealerUpgradeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acceptDealerUpgradeMock.mockResolvedValue({
      data: { success: true, alreadyAccepted: false },
    });
  });

  it("shows every dealer policy and requires explicit acceptance", async () => {
    const user = userEvent.setup();
    render(<DealerUpgradeForm offerId={offerId} policyDigest={policyDigest} />);

    expect(screen.getByRole("link", { name: "Dealer Terms" })).toHaveAttribute(
      "href",
      "/dealer-terms",
    );
    expect(
      screen.getByRole("link", { name: "Acceptable Use Policy" }),
    ).toHaveAttribute("href", "/acceptable-use");
    expect(screen.getByRole("link", { name: "Refund Policy" })).toHaveAttribute(
      "href",
      "/refunds",
    );

    await user.click(
      screen.getByRole("button", { name: "Accept and activate dealer access" }),
    );
    expect(acceptDealerUpgradeMock).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/Accept the current dealer documents/i),
    ).toHaveLength(2);
  });

  it("activates after acceptance and opens dealer profile", async () => {
    const user = userEvent.setup();
    render(<DealerUpgradeForm offerId={offerId} policyDigest={policyDigest} />);

    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Accept and activate dealer access" }),
    );

    await waitFor(() => {
      expect(acceptDealerUpgradeMock).toHaveBeenCalledWith({
        offerId,
        policyDigest,
        dealerPoliciesAccepted: true,
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/dealer/profile");
    expect(refreshMock).toHaveBeenCalled();
  });
});
