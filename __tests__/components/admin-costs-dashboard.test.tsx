import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  COST_EMPTY_HELP,
  COST_NON_OWNER_HELP,
} from "@/lib/costs/copy";
import type { CostDashboardDto } from "@/lib/costs/dto";
import { hasSensitiveCostField } from "@/lib/costs/privacy";

vi.mock("@/actions/admin/costs", () => ({
  requestProjectInvoice: vi.fn(),
  recordManualProjectCost: vi.fn(),
  retryProjectCostEmail: vi.fn(),
  runManualCostSync: vi.fn(),
  refreshProviderCosts: vi.fn(() => new Promise(() => {})),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/dist/client/components/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/(admin)/admin/costs/cost-actions", () => ({
  RequestInvoiceButton: ({
    label,
    disabled,
  }: {
    label: string;
    disabled: boolean;
  }) => (
    <button type="button" disabled={disabled}>
      {label}
    </button>
  ),
  OwnerCostControls: () => <div>Owner controls</div>,
}));

import { CostDashboardView } from "@/app/(admin)/admin/costs/cost-dashboard";

function dashboard(overrides: Partial<CostDashboardDto> = {}): CostDashboardDto {
  return {
    enabled: true,
    startedAt: "2026-08-13T23:00:00.000Z",
    isOwner: false,
    projectedTotalLabel: "£0.00",
    projectedTotalMinor: 0,
    invoiceableTotalLabel: "£0.00",
    invoiceableTotalMinor: 0,
    requestButtonLabel: "Request an invoice for £0.00",
    canRequestInvoice: false,
    pendingRequest: null,
    sections: [],
    requests: [],
    sync: {
      status: "NONE",
      stale: true,
      quarantinedCount: 0,
      completedAt: null,
      errorCode: null,
    },
    unavailableReason: null,
    affectsLiveLedger: false,
    ledgerRevision: null,
    ledgerAsOf: null,
    ...overrides,
  };
}

describe("admin costs dashboard T5", () => {
  it("shows concise usage help without leaking sensitive fields", () => {
    const data = dashboard();
    expect(hasSensitiveCostField(data)).toBe(false);
    render(<CostDashboardView dashboard={data} />);
    expect(screen.getByText(COST_EMPTY_HELP)).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Usage" })).toBeNull();
    expect(screen.queryByText(/20% markup/i)).toBeNull();
    expect(screen.queryByText(/60% of included nominal value/i)).toBeNull();
    expect(screen.queryByText(/Crossing \$400/i)).toBeNull();
    expect(screen.queryByText(/updates the live ledger/i)).toBeNull();
    expect(screen.getByText(COST_NON_OWNER_HELP)).not.toBeNull();
    expect(screen.getByText(/No provider refresh recorded yet/i)).not.toBeNull();
    expect(screen.queryByText(/Refresh is overdue/i)).toBeNull();
    expect(screen.queryByText(/Ledger start:/i)).toBeNull();
    expect(screen.queryByText(/business-day|split equally|provisional shared hosting/i)).toBeNull();
    expect(screen.queryByText(/nativeAmount|fxRate|billedCost/i)).toBeNull();
  });

  it("explains a failed refresh and pending invoice without exposing error internals", () => {
    render(
      <CostDashboardView
        dashboard={dashboard({
          isOwner: true,
          pendingRequest: {
            id: "req_1",
            status: "PENDING",
            amountLabel: "£12.00",
            amountMinor: 1200,
            entryCount: 1,
            createdAt: "2026-08-16T00:00:00.000Z",
            confirmedAt: null,
            emailStatus: "FAILED",
            outboxId: "outbox_1",
          },
          sync: {
            status: "FAILED",
            stale: true,
            quarantinedCount: 2,
            completedAt: "2026-08-16T04:00:00.000Z",
            errorCode: "CostFxError",
          },
        })}
      />,
    );
    expect(screen.getByText(/Refreshing provider costs/i)).not.toBeNull();
    expect(screen.queryByText(/Refresh is overdue/i)).toBeNull();
    expect(screen.queryByText(/2 provider rows could not be classified/i)).toBeNull();
    expect(screen.getByText(/notification email failed/i)).not.toBeNull();
    expect(screen.queryByText("CostFxError")).toBeNull();
  });

  it("renders a populated success state with last completion and no forbidden fields", () => {
    const data = dashboard({
      isOwner: true,
      projectedTotalLabel: "£12.00",
      projectedTotalMinor: 1200,
      invoiceableTotalLabel: "£8.00",
      invoiceableTotalMinor: 800,
      requestButtonLabel: "Request an invoice for £8.00",
      canRequestInvoice: true,
      sections: [
        {
          key: "VERCEL_HOSTING",
          label: "Vercel Hosting",
          amountLabel: "£8.00",
          provisional: false,
          lines: [
            {
              id: "entry_1",
              section: "Vercel Hosting",
              category: "VERCEL_HOSTING",
              label: "Hosting",
              amountLabel: "£8.00",
              amountMinor: 800,
              invoiceability: "INVOICEABLE",
              periodStart: "2026-08-14T00:00:00.000Z",
              periodEnd: "2026-08-15T00:00:00.000Z",
              provisional: false,
            },
          ],
        },
        {
          key: "SHARED_VERCEL",
          label: "Shared Hosting",
          amountLabel: "£4.00",
          provisional: true,
          lines: [
            {
              id: "entry_2",
              section: "Shared Hosting",
              category: "SHARED_VERCEL",
              label: "Shared team charge",
              amountLabel: "£4.00",
              amountMinor: 400,
              invoiceability: "PROVISIONAL",
              periodStart: "2026-08-01T00:00:00.000Z",
              periodEnd: "2026-09-01T00:00:00.000Z",
              provisional: true,
            },
          ],
        },
      ],
      sync: {
        status: "SUCCEEDED",
        stale: false,
        quarantinedCount: 0,
        completedAt: "2026-08-16T04:00:00.000Z",
        errorCode: null,
      },
    });
    expect(hasSensitiveCostField(data)).toBe(false);
    render(<CostDashboardView dashboard={data} />);
    expect(screen.getByText(/Refreshing provider costs/i)).not.toBeNull();
    expect(screen.queryByText(/Refresh is overdue/i)).toBeNull();
    expect(screen.getByRole("heading", { name: "Usage" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: /cumulative project costs/i })).not.toBeNull();
    expect(screen.getAllByRole("heading", { name: "Vercel Hosting" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { name: "Shared Hosting" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Hosting charges for this project.")).not.toBeNull();
    expect(screen.getByText("Shared team hosting allocated to this project.")).not.toBeNull();
    expect(screen.queryByText("Included")).toBeNull();
    expect(screen.queryByText("On-demand")).toBeNull();
    expect(screen.getByText("Provisional")).not.toBeNull();
    expect(screen.getByText("Invoiceable")).not.toBeNull();
    expect(screen.queryByText(COST_EMPTY_HELP)).toBeNull();
    expect(screen.queryByText(/nativeAmount|fxRate|billedCost/i)).toBeNull();
  });

  it("paginates long cost lists instead of rendering every line at once", async () => {
    const user = userEvent.setup();
    const lines = Array.from({ length: 12 }, (_, index) => ({
      id: `entry_${index + 1}`,
      section: "Development",
      category: "CURSOR" as const,
      label: `Cursor 2026-09-${String(26 - index).padStart(2, "0")} included`,
      amountLabel: "£1.00",
      amountMinor: 100,
      invoiceability: "INVOICEABLE" as const,
      periodStart: `2026-09-${String(26 - index).padStart(2, "0")}T00:00:00.000Z`,
      periodEnd: `2026-09-${String(27 - index).padStart(2, "0")}T00:00:00.000Z`,
      provisional: false,
    }));
    render(
      <CostDashboardView
        dashboard={dashboard({
          sections: [
            {
              key: "CURSOR",
              label: "Development",
              amountLabel: "£12.00",
              provisional: false,
              lines,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Cursor charges attributed to iTrader.")).not.toBeNull();
    expect(screen.getByText("Showing 1–10 of 12")).not.toBeNull();
    expect(screen.getByText("Cursor 2026-09-26 included")).not.toBeNull();
    expect(screen.queryByText("Cursor 2026-09-16 included")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    expect(screen.getByText("Showing 11–12 of 12")).not.toBeNull();
    expect(screen.getByText("Cursor 2026-09-16 included")).not.toBeNull();
    expect(screen.queryByText("Cursor 2026-09-26 included")).toBeNull();
    await user.click(screen.getByRole("button", { name: "7d" }));
    expect(screen.queryByText("Showing 11–12 of 12")).toBeNull();
    expect(screen.getByText("Cursor 2026-09-26 included")).not.toBeNull();
  });

  it("does not show implementation details when costs are disabled", () => {
    render(<CostDashboardView dashboard={dashboard({ enabled: false, startedAt: null })} />);
    expect(screen.queryByText(/tracking is turned off|Ledger start:/i)).toBeNull();
    expect(screen.queryByText(/billing-period boundary/i)).toBeNull();
  });
});
