import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MANUAL_COST_CATEGORIES } from "@/lib/costs/manual-categories";

const { addManualCostCategory, recordManualProjectCost, refreshProviderCosts } = vi.hoisted(() => ({
  addManualCostCategory: vi.fn(),
  recordManualProjectCost: vi.fn(),
  refreshProviderCosts: vi.fn(),
}));

vi.mock("@/lib/costs/db", () => ({
  costDb: {},
}));

vi.mock("@/actions/admin/costs", () => ({
  addManualCostCategory,
  recordManualProjectCost,
  refreshProviderCosts,
  requestProjectInvoice: vi.fn(),
  retryProjectCostEmail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/dist/client/components/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { OwnerCostControls } from "@/app/(admin)/admin/costs/cost-actions";
import { CostProviderRefresh } from "@/app/(admin)/admin/costs/cost-provider-refresh";

const sync = {
  status: "NONE" as const,
  stale: false,
  quarantinedCount: 0,
  completedAt: null,
  errorCode: null,
};

describe("manual cost controls", () => {
  it("defaults to pounds and hides the external reference and refresh button", () => {
    render(
      <OwnerCostControls
        canRetryEmail={false}
        categories={[...DEFAULT_MANUAL_COST_CATEGORIES]}
      />,
    );

    expect(screen.getByLabelText(/^Amount/)).not.toBeNull();
    expect(screen.getByLabelText("Currency")).toHaveProperty("value", "GBP");
    expect(screen.getByRole("option", { name: "Manual Adjustment" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "Database" })).toBeNull();
    expect(screen.queryByLabelText(/external reference/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh provider costs" })).toBeNull();
    expect(screen.getByRole("option", { name: "Add category…" })).not.toBeNull();
  });

  it("saves a new category and selects it", async () => {
    const user = userEvent.setup();
    addManualCostCategory.mockResolvedValue({
      data: {
        category: { slug: "office-supplies", label: "Office Supplies" },
        categories: [
          ...DEFAULT_MANUAL_COST_CATEGORIES,
          { slug: "office-supplies", label: "Office Supplies" },
        ],
      },
    });
    render(
      <OwnerCostControls
        canRetryEmail={false}
        categories={[...DEFAULT_MANUAL_COST_CATEGORIES]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Category"), "__add__");
    await user.type(screen.getByLabelText("New category"), "Office Supplies");
    await user.click(screen.getByRole("button", { name: "Add category" }));

    expect(addManualCostCategory).toHaveBeenCalledWith({ label: "Office Supplies" });
    expect(screen.getByLabelText("Category")).toHaveProperty("value", "office-supplies");
  });

  it("records a cost without an external reference", async () => {
    const user = userEvent.setup();
    recordManualProjectCost.mockResolvedValue({ data: { recorded: true } });
    render(
      <OwnerCostControls
        canRetryEmail={false}
        categories={[...DEFAULT_MANUAL_COST_CATEGORIES]}
      />,
    );

    await user.type(screen.getByLabelText(/^Amount/), "-12.50");
    await user.type(screen.getByLabelText(/^Label/), "Exclude costs page");
    await user.type(screen.getByLabelText(/^Period start/), "2026-09-01T09:00");
    await user.type(screen.getByLabelText(/^Period end/), "2026-09-02T09:00");
    await user.click(screen.getByRole("button", { name: "Record cost" }));

    expect(recordManualProjectCost).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: "manual-adjustment",
        nativeAmount: "-12.50",
        nativeCurrency: "GBP",
        displayLabel: "Exclude costs page",
      }),
    );
    expect(recordManualProjectCost.mock.calls[0]?.[0]).not.toHaveProperty("externalRef");
  });

  it("puts provider refresh on the provider card", () => {
    refreshProviderCosts.mockReturnValue(new Promise(() => {}));
    const { rerender } = render(<CostProviderRefresh isOwner={false} sync={sync} />);
    expect(screen.queryByRole("button", { name: "Refresh provider costs" })).toBeNull();

    rerender(<CostProviderRefresh isOwner sync={sync} />);
    expect(screen.getByRole("button", { name: "Refresh provider costs" })).not.toBeNull();
  });
});
