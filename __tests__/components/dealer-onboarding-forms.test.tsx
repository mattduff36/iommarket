import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OnboardingClaimForm,
  safeOnboardingRecoveryUrl,
} from "@/app/(public)/dealer/onboarding/claim/onboarding-claim-form";
import { OnboardingAcceptForm } from "@/app/(public)/dealer/onboarding/accept/onboarding-accept-form";

const beginMock = vi.fn();
const completeMock = vi.fn();

vi.mock("@/actions/dealer-onboarding", () => ({
  beginDealerOnboardingClaim: (...args: unknown[]) => beginMock(...args),
  completeDealerOnboardingClaim: (...args: unknown[]) => completeMock(...args),
}));

describe("dealer onboarding pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beginMock.mockResolvedValue({ error: "This invitation has expired. Ask iTrader to send a new one." });
    completeMock.mockResolvedValue({ data: { completed: true } });
  });

  it("does not start authentication until the dealer continues", () => {
    render(<OnboardingClaimForm token={"a".repeat(43)} />);
    expect(beginMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /continue securely/i }));
    expect(beginMock).toHaveBeenCalledTimes(1);
  });

  it("shows an expired invitation error from the secure continue action", async () => {
    render(<OnboardingClaimForm token={"a".repeat(43)} />);
    fireEvent.click(screen.getByRole("button", { name: /continue securely/i }));
    expect(await screen.findByText(/expired/i)).toBeTruthy();
  });

  it("allows only the same-origin recovery callback for full-page navigation", () => {
    const valid =
      "https://itrader.im/auth/callback?token_hash=hashed-token&type=recovery&next=%2Fdealer%2Fonboarding%2Faccept";
    expect(safeOnboardingRecoveryUrl(valid, "https://itrader.im")).toBe(valid);
    expect(
      safeOnboardingRecoveryUrl(
        valid.replace("https://itrader.im", "https://attacker.example"),
        "https://itrader.im",
      ),
    ).toBeNull();
    expect(
      safeOnboardingRecoveryUrl(
        "https://itrader.im/auth/callback?token_hash=x&type=recovery&next=%2Faccount",
        "https://itrader.im",
      ),
    ).toBeNull();
  });

  it("completes only after password and all three checks", async () => {
    render(<OnboardingAcceptForm />);
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText(/Confirm new password/), {
      target: { value: "new-password" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /18 or over/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I acknowledge/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Dealer Terms/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept and activate/i }));
    expect(await screen.findByText(/dealer account is ready/i)).toBeTruthy();
    expect(completeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ageAttested: true,
        accountPoliciesAccepted: true,
        dealerPoliciesAccepted: true,
      }),
    );
  });
});
