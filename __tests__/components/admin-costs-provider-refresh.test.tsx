import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshProviderCosts, refreshPage } = vi.hoisted(() => ({
  refreshProviderCosts: vi.fn(),
  refreshPage: vi.fn(),
}));

vi.mock("@/actions/admin/costs", () => ({
  refreshProviderCosts,
}));

vi.mock("@/app/(admin)/admin/costs/use-refresh-page", () => ({
  useRefreshPage: () => refreshPage,
}));

import { CostProviderRefresh } from "@/app/(admin)/admin/costs/cost-provider-refresh";

describe("cost provider background refresh", () => {
  it("shows Last updated without invoking provider refresh in the Accounts preview", () => {
    refreshProviderCosts.mockClear();
    render(<CostProviderRefresh isOwner accountsPreview sync={{status:"SUCCEEDED",stale:false,quarantinedCount:0,completedAt:"2026-09-20T10:00:00.000Z",errorCode:null}}/>);
    expect(screen.getByText("Last updated")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Refresh provider costs"})).toBeNull();
    expect(refreshProviderCosts).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues bounded canonical slices until the ledger catches up", async () => {
    refreshProviderCosts
      .mockResolvedValueOnce({
        data: {
          status: "partial",
          caughtUp: false,
          message: "Provider costs were partly refreshed.",
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: "succeeded",
          caughtUp: false,
          message: "Provider costs were refreshed. More history remains.",
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: "succeeded",
          caughtUp: true,
          message: "Provider costs were refreshed.",
        },
      });

    render(
      <CostProviderRefresh
        isOwner
        sync={{
          status: "NONE",
          stale: true,
          quarantinedCount: 0,
          completedAt: null,
          errorCode: null,
        }}
      />,
    );

    await waitFor(() => expect(refreshProviderCosts).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Provider costs were refreshed.")).not.toBeNull();
    expect(refreshPage).toHaveBeenCalledTimes(1);
  });

  it("stops after four continuation requests", async () => {
    refreshProviderCosts.mockResolvedValue({
      data: {
        status: "partial",
        caughtUp: false,
        message: "Provider costs were partly refreshed.",
      },
    });

    render(
      <CostProviderRefresh
        isOwner
        sync={{
          status: "NONE",
          stale: true,
          quarantinedCount: 0,
          completedAt: null,
          errorCode: null,
        }}
      />,
    );

    await waitFor(() => expect(refreshProviderCosts).toHaveBeenCalledTimes(4));
    expect(
      await screen.findByText(
        "Provider costs were partly refreshed. More history remains for the next refresh.",
      ),
    ).not.toBeNull();
    expect(refreshPage).toHaveBeenCalledTimes(1);
  });
});
