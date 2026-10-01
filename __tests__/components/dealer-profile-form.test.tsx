// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { updateMyDealerProfile } from "@/actions/account";
import { describe, expect, it, vi } from "vitest";
import { DealerProfileForm } from "@/app/(public)/dealer/profile/dealer-profile-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/actions/account", () => ({
  updateMyDealerProfile: vi.fn(),
}));

describe("DealerProfileForm", () => {
  const initialData = { name: "Northshore Motors", slug: "northshore-motors", bio: null, website: null, phone: null, logoUrl: null };
  it("requires confirmation before changing a public address", async () => {
    vi.mocked(updateMyDealerProfile).mockClear();
    vi.mocked(updateMyDealerProfile).mockResolvedValue({ data: {} } as never);
    const user = userEvent.setup();
    render(<DealerProfileForm initialData={initialData} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Public profile address" }), { target: { value: "northshore-cars" } });
    await user.click(screen.getByRole("button", { name: "Save Dealer Profile" }));
    expect(updateMyDealerProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("twice in any 365 days");
    await user.click(screen.getByRole("button", { name: "Save profile and address" }));
    await waitFor(() => expect(updateMyDealerProfile).toHaveBeenCalledTimes(1));
    expect(updateMyDealerProfile).toHaveBeenCalledWith(expect.objectContaining({ slug: "northshore-cars" }));
  });

  it("recovers from a thrown save error without losing the edited address", async () => {
    vi.mocked(updateMyDealerProfile).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<DealerProfileForm initialData={initialData} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Public profile address" }), { target: { value: "northshore-cars" } });
    await user.click(screen.getByRole("button", { name: "Save Dealer Profile" }));
    await user.click(screen.getByRole("button", { name: "Save profile and address" }));
    await screen.findByText("We could not update your dealer profile. Please try again.");
    expect(screen.getByRole("textbox", { name: "Public profile address" })).toHaveValue("northshore-cars");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Dealer Profile" })).not.toBeDisabled();
    });
  });

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
