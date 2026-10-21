// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingManager } from "@/app/(admin)/admin/dealer-onboarding/onboarding-manager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/actions/admin/dealer-onboarding", () => ({
  sendDealerOnboardingInvite: vi.fn(),
  revokeDealerOnboardingInvite: vi.fn(),
}));

describe("dealer onboarding manager", () => {
  it("requires checking each dealer offer and has no launch-date control", () => {
    render(<OnboardingManager dealers={[]} invites={[]} selectedDealerId={null} />);
    expect(screen.getByText(/Check the selected dealer’s offer/)).toBeTruthy();
    expect(screen.getByText(/Preview Packs/)).toBeTruthy();
    expect(screen.queryByText(/Launch date/i)).toBeNull();
    expect(screen.getByRole("button", { name: /send onboarding email/i })).toBeDisabled();
  });

  it("shows DW's one-month offer without promising year-end access", () => {
    render(<OnboardingManager selectedDealerId="dw" invites={[]} dealers={[{
      id: "dw", name: "DW Cars", currentEmail: "dwcars@itrader.im.preview",
      tier: "PRO", accessLabel: "No active complimentary grant",
      resultingEndLabel: "One calendar month from acceptance, then paid Dealer Pro checkout",
    }]} />);
    expect(screen.getByText(/One calendar month from acceptance/)).toBeTruthy();
    expect(screen.queryByText(/31 December 2026/)).toBeNull();
  });

  it("lists only the dealers supplied by the eligibility query", () => {
    render(
      <OnboardingManager
        selectedDealerId={null}
        invites={[]}
        dealers={[
          {
            id: "cldealerxxxxxxxxxxxxxxxxx",
            name: "Athol Garage",
            currentEmail: "atholgarage@itrader.im.preview",
            tier: "PRO",
            accessLabel: "No active complimentary grant",
            resultingEndLabel: "23:59 on 31 December 2026 (Isle of Man time)",
          },
        ]}
      />,
    );
    expect(screen.getByRole("option", { name: /Athol Garage/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Manx Motors/ })).toBeNull();
  });
});
