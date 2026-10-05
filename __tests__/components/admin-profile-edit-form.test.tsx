// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
const saveAdminProfile = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/actions/admin/profile-edit", () => ({
  saveAdminProfile: (...args: unknown[]) => saveAdminProfile(...args),
}));

import { AdminProfileEditForm } from "@/app/(admin)/admin/users/[id]/profile/profile-edit-form";

const dealer = {
  dealerId: "cldealerxxxxxxxxxxxxxxxxx",
  slug: "ocean-motor-village",
  name: "Ocean Motor Village Preview",
  phone: "01624 222222",
  website: "https://www.oceanmotorvillage.com",
  bio: "Dealer bio",
  updatedAt: "2026-10-04T12:00:00.000Z",
};

function renderForm() {
  render(
    <AdminProfileEditForm
      userId="clxxxxxxxxxxxxxxxxxxxxxxxxx"
      userUpdatedAt="2026-10-04T12:00:00.000Z"
      accountName="Account Holder"
      accountPhone="01624 111111"
      accountBio="Account bio"
      regionId=""
      regions={[]}
      dealer={dealer}
      disabledAccount={false}
    />,
  );
}

describe("AdminProfileEditForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks before discarding unsaved changes", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByRole("textbox", { name: /business name/i }));
    await user.type(screen.getByRole("textbox", { name: /business name/i }), "Ocean Motor Village");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox", { name: /business name/i })).toHaveValue("Ocean Motor Village");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(push).toHaveBeenCalledWith("/admin/users/clxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(saveAdminProfile).not.toHaveBeenCalled();
  });

  it("sends the timestamp from the first save on the second edit", async () => {
    const user = userEvent.setup();
    saveAdminProfile.mockImplementation(async (input: {
      account: { name: string; phone: string; bio: string; regionId: string | null };
      dealer: { name: string; phone: string; website: string; bio: string };
    }) => ({
      data: {
        userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        userUpdatedAt: "2026-10-04T12:00:00.000Z",
        unchanged: false,
        account: {
          name: input.account.name,
          phone: input.account.phone,
          bio: input.account.bio,
          regionId: input.account.regionId,
        },
        dealer: {
          dealerId: dealer.dealerId,
          slug: dealer.slug,
          updatedAt: input.dealer.name === "Ocean Motor Village"
            ? "2026-10-04T12:05:00.000Z"
            : "2026-10-04T12:06:00.000Z",
          name: input.dealer.name,
          phone: input.dealer.phone,
          website: input.dealer.website,
          bio: input.dealer.bio,
        },
      },
    }));
    renderForm();

    await user.clear(screen.getByRole("textbox", { name: /business name/i }));
    await user.type(screen.getByRole("textbox", { name: /business name/i }), "Ocean Motor Village");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeInTheDocument());

    await user.clear(screen.getByRole("textbox", { name: /dealer phone/i }));
    await user.type(screen.getByRole("textbox", { name: /dealer phone/i }), "01624 999999");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(saveAdminProfile).toHaveBeenCalledTimes(2));
    expect(saveAdminProfile).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedUserUpdatedAt: "2026-10-04T12:00:00.000Z",
      dealer: expect.objectContaining({
        expectedDealerUpdatedAt: "2026-10-04T12:05:00.000Z",
        name: "Ocean Motor Village",
        phone: "01624 999999",
      }),
    }));
  });
});
