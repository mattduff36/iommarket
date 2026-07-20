import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DealerProfileForm } from "@/app/(public)/dealer/profile/dealer-profile-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/actions/account", () => ({
  updateMyDealerProfile: vi.fn(),
}));

describe("DealerProfileForm", () => {
  it("places logo requirements immediately below the save action", () => {
    render(
      <DealerProfileForm
        initialData={{
          name: "Northshore Motors",
          slug: "northshore-motors",
          bio: null,
          website: null,
          phone: null,
          logoUrl: null,
        }}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "Save Dealer Profile" });
    const helperText = screen.getByText(
      "* Dealer logos should be in PNG, JPG, GIF, or WebP format. Square images work best. Maximum 5 MB.",
    );

    expect(saveButton.parentElement?.contains(helperText)).toBe(true);
    expect(helperText).toHaveClass("text-text-secondary");
    expect(helperText).toHaveClass("md:whitespace-nowrap");
    expect(helperText).not.toHaveClass("whitespace-nowrap");
    expect(helperText).not.toHaveClass("max-w-prose");
    expect(helperText).toHaveAttribute("id", "dealer-logo-guidance");
    expect(screen.queryByText(/^Add your dealer logo$/)).toBeNull();
  });
});
