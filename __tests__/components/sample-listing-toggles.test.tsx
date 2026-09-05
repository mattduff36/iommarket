import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SampleListingToggles } from "@/app/(admin)/admin/preview-packs/sample-listing-toggles";

const { setSampleListingVisibilityMock, refreshMock } = vi.hoisted(() => ({
  setSampleListingVisibilityMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/actions/admin/preview-controls", () => ({
  setSampleListingVisibility: setSampleListingVisibilityMock,
}));

describe("SampleListingToggles", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setSampleListingVisibilityMock.mockResolvedValue({
      data: { kind: "private", visible: false },
    });
  });

  it("renders both sample listing switches from server state", () => {
    render(
      <SampleListingToggles
        samplePrivateVisible={true}
        sampleDealerVisible={false}
      />,
    );

    expect(screen.getByRole("switch", { name: "Private sample listings" })).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(screen.getByRole("switch", { name: "Dealer sample listings" })).toHaveAttribute(
      "data-state",
      "unchecked",
    );
  });

  it("toggles private sample listings and refreshes the page", async () => {
    const user = userEvent.setup();
    render(
      <SampleListingToggles
        samplePrivateVisible={true}
        sampleDealerVisible={true}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Private sample listings" }));

    await waitFor(() => {
      expect(setSampleListingVisibilityMock).toHaveBeenCalledWith({
        kind: "private",
        visible: false,
      });
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("shows an error when the visibility update fails", async () => {
    setSampleListingVisibilityMock.mockResolvedValue({ error: "Could not update." });
    const user = userEvent.setup();
    render(
      <SampleListingToggles
        samplePrivateVisible={true}
        sampleDealerVisible={true}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Dealer sample listings" }));

    expect(await screen.findByText("Could not update.")).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
