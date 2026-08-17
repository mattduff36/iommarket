import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  COST_ALLOCATION_HELP,
  COST_CALCULATION_HELP,
  COST_DISABLED_HELP,
  COST_EMPTY_HELP,
  COST_NON_OWNER_HELP,
  COST_PAGE_INTRO,
} from "@/lib/costs/copy";
import type { CostDashboardDto } from "@/lib/costs/dto";
import { hasSensitiveCostField } from "@/lib/costs/privacy";

vi.mock("@/actions/admin/costs", () => ({
  requestProjectInvoice: vi.fn(),
  recordManualProjectCost: vi.fn(),
  retryProjectCostEmail: vi.fn(),
  runManualCostSync: vi.fn(),
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
    ...overrides,
  };
}

describe("admin costs dashboard T5", () => {
  it("explains timing, formula, and empty state without leaking sensitive fields", () => {
    const data = dashboard();
    expect(hasSensitiveCostField(data)).toBe(false);
    render(<CostDashboardView dashboard={data} />);
    expect(screen.queryByText(COST_PAGE_INTRO)).toBeNull();
    expect(screen.queryByText(COST_CALCULATION_HELP)).toBeNull();
    expect(screen.queryByText(COST_ALLOCATION_HELP)).toBeNull();
    expect(screen.getByText(COST_EMPTY_HELP)).not.toBeNull();
    expect(screen.getByText(COST_NON_OWNER_HELP)).not.toBeNull();
    expect(screen.getByText(/No refresh yet/i)).not.toBeNull();
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
    expect(screen.getByText(/Last refresh failed/i)).not.toBeNull();
    expect(screen.getByText(/2 provider rows could not be classified/i)).not.toBeNull();
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
    expect(screen.getByText("Up to date")).not.toBeNull();
    expect(screen.getByText(/Last completed/i)).not.toBeNull();
    expect(screen.getByText("Vercel Hosting")).not.toBeNull();
    expect(screen.getByText("Shared Hosting")).not.toBeNull();
    expect(screen.getByText("Provisional")).not.toBeNull();
    expect(screen.getByText("Invoiceable")).not.toBeNull();
    expect(screen.queryByText(COST_EMPTY_HELP)).toBeNull();
    expect(screen.queryByText(/nativeAmount|fxRate|billedCost/i)).toBeNull();
  });

  it("explains the disabled gate without promising a billing-period boundary", () => {
    render(<CostDashboardView dashboard={dashboard({ enabled: false, startedAt: null })} />);
    expect(screen.queryByText(COST_DISABLED_HELP)).toBeNull();
    expect(screen.queryByText(/billing-period boundary/i)).toBeNull();
  });
});
