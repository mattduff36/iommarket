// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DealerCorrespondenceSettingsCard } from "@/app/(public)/dealer/dashboard/dealer-correspondence-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/actions/dealer/correspondence", () => ({
  saveDealerCorrespondenceSettings: vi.fn(),
  resendDealerCorrespondenceVerification: vi.fn(),
  disableDealerCorrespondence: vi.fn(),
}));

const baseProps = {
  primaryEmail: "owner@dealer.example",
  verifiedEmail: null,
  pendingEmail: null,
  verificationExpiresAt: null,
  categories: [],
  copyAssignedToPrimary: false,
};

describe("DealerCorrespondenceSettingsCard", () => {
  it("hides routing choices until a second address is enabled", async () => {
    const user = userEvent.setup();
    render(<DealerCorrespondenceSettingsCard {...baseProps} />);

    expect(screen.getByText("Login email:")).toBeTruthy();
    expect(screen.getByText(/security emails always go to your login address/i)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Buyer enquiries/i })).toBeNull();
    expect(screen.getByText("All iTrader emails go to your login address.")).toBeTruthy();

    await user.click(screen.getByRole("switch", { name: "Use a second correspondence email" }));

    expect(screen.getByRole("textbox", { name: /Second email address/i })).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(
      screen.getByRole("switch", { name: "Also send assigned emails to my login address" }),
    ).not.toBeChecked();
  });

  it("shows pending confirmation and the five category choices", () => {
    render(
      <DealerCorrespondenceSettingsCard
        {...baseProps}
        pendingEmail="sales@dealer.example"
        verificationExpiresAt="2099-01-01T00:00:00.000Z"
        categories={["BUYER_ENQUIRIES"]}
      />,
    );

    expect(screen.getByText(/every email still goes to owner@dealer.example/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend confirmation link" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Buyer enquiries/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Listing updates/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Reviews/i })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Subscription and cancellation/i })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Dealer account notices/i })).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Also send assigned emails to my login address" }),
    ).not.toBeChecked();
  });

  it("keeps the current verified address visible while a replacement is pending", () => {
    render(
      <DealerCorrespondenceSettingsCard
        {...baseProps}
        verifiedEmail="accounts@dealer.example"
        pendingEmail="sales@dealer.example"
        verificationExpiresAt="2099-01-01T00:00:00.000Z"
      />,
    );

    expect(screen.getByText(/continue to go to accounts@dealer.example/i)).toBeTruthy();
  });
});
