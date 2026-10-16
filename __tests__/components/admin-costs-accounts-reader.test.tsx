// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountsCostDashboardResult } from "@/lib/costs/accounts-reader";
import { groupCostSections, type CostDashboardDto, type CostLineDto } from "@/lib/costs/dto";
import { formatMarkedGbp } from "@/lib/costs/format";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(async () => ({ authUserId: "admin_1" })),
  isCostsEnabled: vi.fn(() => true),
  isCostOwner: vi.fn(() => false),
  getCostDashboard: vi.fn(),
  fetchRemoteCostDashboard: vi.fn(),
  syncAccountsPreview: vi.fn(),
  fetchAccountsComparison: vi.fn(),
  localComparisonOrigin: vi.fn(() => "http://127.0.0.1:3310"),
  resolveLedgerAccess: vi.fn(() => ({ mode: "local" as const })),
  accountsReaderRequested: vi.fn(() => true),
  fetchAccountsCostDashboard: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/costs/config", () => ({
  isCostsEnabled: mocks.isCostsEnabled,
  isCostOwner: mocks.isCostOwner,
}));
vi.mock("@/lib/costs/queries", () => ({ getCostDashboard: mocks.getCostDashboard }));
vi.mock("@/lib/costs/db", () => ({ costDb: { kind: "unused" } }));
vi.mock("@/lib/costs/remote-ledger", () => ({ fetchRemoteCostDashboard: mocks.fetchRemoteCostDashboard }));
vi.mock("@/lib/costs/accounts-projection", () => ({ syncAccountsPreview: mocks.syncAccountsPreview }));
vi.mock("@/lib/costs/accounts-comparison", () => ({
  fetchAccountsComparison: mocks.fetchAccountsComparison,
  localComparisonOrigin: mocks.localComparisonOrigin,
}));
vi.mock("@/lib/costs/ledger-access", () => ({
  resolveLedgerAccess: mocks.resolveLedgerAccess,
  accountsReaderRequested: mocks.accountsReaderRequested,
}));
vi.mock("@/lib/costs/accounts-reader", () => ({
  fetchAccountsCostDashboard: mocks.fetchAccountsCostDashboard,
}));
vi.mock("@/actions/admin/costs", () => ({
  requestProjectInvoice: vi.fn(),
  recordManualProjectCost: vi.fn(),
  retryProjectCostEmail: vi.fn(),
  runManualCostSync: vi.fn(),
  refreshProviderCosts: vi.fn(),
  addManualCostCategory: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/dist/client/components/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AccountsProjectSummaryView } from "@/app/(admin)/admin/costs/accounts-summary";
import AdminCostsPage from "@/app/(admin)/admin/costs/page";

function disabledDashboard(): CostDashboardDto {
  return {
    enabled: false,
    startedAt: null,
    isOwner: false,
    projectedTotalLabel: "Costs disabled",
    projectedTotalMinor: 0,
    invoiceableTotalLabel: "Costs disabled",
    invoiceableTotalMinor: 0,
    requestButtonLabel: "Invoice request unavailable",
    canRequestInvoice: false,
    pendingRequest: null,
    sections: [],
    requests: [],
    sync: { status: "NONE", stale: true, quarantinedCount: 0, completedAt: null, errorCode: null },
    unavailableReason: null,
    affectsLiveLedger: false,
    ledgerRevision: null,
    ledgerAsOf: null,
    manualCategories: [],
  };
}

function textOf(name: string): string {
  const card = screen.getByRole("heading", { name, level: 3 }).parentElement?.parentElement;
  return card?.querySelector("p")?.textContent ?? "";
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return utcDay(date);
}

function displayLine(input: { id: string; day: string; amountMinor: number; label: string; category: CostLineDto["category"] }): CostLineDto {
  const section = input.category === "CURSOR" ? "Development (Cursor)" : input.category === "VERCEL_HOSTING" ? "Website hosting (Vercel)" : "Other";
  return {
    id: input.id,
    section,
    category: input.category,
    label: input.label,
    amountLabel: formatMarkedGbp(input.amountMinor),
    amountMinor: input.amountMinor,
    kind: "CHARGE",
    invoiceability: "PROVISIONAL",
    periodStart: `${input.day}T00:00:00.000Z`,
    periodEnd: `${shiftDay(input.day, 1)}T00:00:00.000Z`,
    provisional: true,
  };
}

function successDashboard(): AccountsCostDashboardResult {
  const today = "2026-10-10";
  const earlier = shiftDay(today, -40);
  return {
    available: true,
    chartAvailable: true,
    costTotalPence: 14_750,
    invoicedPence: 95_000,
    remainingToInvoicePence: -80_250,
    sourceUpdatedAt: "2026-10-10T11:00:00.000Z",
    asOf: "2026-10-10T12:00:00.000Z",
    history: [{ day: "2026-05-27", costPence: null, invoicedPence: 50_000, remainingToInvoicePence: null }],
    sections: groupCostSections([
      displayLine({ id: "recent-cursor", day: today, amountMinor: 10_000, label: "Recent development", category: "CURSOR" }),
      displayLine({ id: "recent-credit", day: today, amountMinor: -250, label: "Recent hosting credit", category: "VERCEL_HOSTING" }),
      displayLine({ id: "earlier-hosting", day: earlier, amountMinor: 5_000, label: "Earlier hosting", category: "VERCEL_HOSTING" }),
    ]),
  };
}

function expectNoAccountsChrome() {
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByText(/accounts/i)).toBeNull();
  expect(screen.queryByText(/estimate notes/i)).toBeNull();
  expect(screen.queryByText(/pricing/i)).toBeNull();
  expect(screen.queryByText(/Manage in Accounts/)).toBeNull();
  expect(screen.queryByText(/membership share|apportioned team-level charges/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /invoice|refresh|manual|ledger entries/i })).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isCostsEnabled.mockReturnValue(true);
  mocks.accountsReaderRequested.mockReturnValue(true);
  mocks.localComparisonOrigin.mockReturnValue("http://127.0.0.1:3310");
});

describe("Accounts reader summary", () => {
  it("renders the original audit header, supplied totals and the existing charts", async () => {
    const user = userEvent.setup();
    const { container } = render(<AccountsProjectSummaryView dashboard={successDashboard()} />);
    expect(screen.getByRole("heading", { name: "iTrader cost audit", level: 1 })).not.toBeNull();
    expect(screen.getByText(/how project costs build up/i)).not.toBeNull();
    expect(container.querySelector(".mb-8.grid.gap-4.sm\\:grid-cols-2.lg\\:grid-cols-4")).not.toBeNull();
    expect(textOf("Project costs").replace(/\s/g, "")).toBe("£147.50");
    expect(textOf("Invoiced").replace(/\s/g, "")).toBe("£950.00");
    expect(textOf("Remaining to invoice").replace(/\s/g, "")).toBe("-£802.50");
    expect(textOf("Last updated")).toMatch(/10 Oct 2026.*12:00.*UK/);
    expect(screen.queryByText("2026-10-10T11:00:00.000Z")).toBeNull();
    expect(screen.queryByText("2026-05-27")).toBeNull();
    expect(screen.queryByText("Project cost estimate")).toBeNull();
    expect(screen.queryByText("Outstanding invoiceable")).toBeNull();
    expect(screen.getByRole("heading", { name: "How costs built up" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "What the costs are made of" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Largest cost days" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Costs by charged day" })).not.toBeNull();
    expect(screen.getByRole("img", { name: /Cumulative project costs by category/ })).not.toBeNull();
    expect(screen.getByRole("img", { name: "Positive net costs by category" })).not.toBeNull();
    expect(screen.getByRole("img", { name: "Daily client costs by category" })).not.toBeNull();
    expect(container.querySelector('[stroke="#0085FF"], [fill="#0085FF"]')).not.toBeNull();
    expect(screen.getAllByText("Provisional").length).toBeGreaterThan(0);
    expect(screen.getByText("Earlier hosting")).not.toBeNull();
    expect(screen.getByText("Recent hosting credit")).not.toBeNull();
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "7d" }));
    expect(screen.getByRole("button", { name: "7d" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Earlier hosting")).toBeNull();
    expect(screen.getByText("Recent hosting credit")).not.toBeNull();
    expect(screen.getByText("Development usage")).not.toBeNull();
    expectNoAccountsChrome();
    expect(screen.queryByText(/Show all ledger entries|Request an invoice|Refresh provider/i)).toBeNull();
  });

  it("keeps supplied negative, zero and null amounts distinct", () => {
    render(<AccountsProjectSummaryView dashboard={{
      available: true,
      chartAvailable: false,
      sections: [],
      costTotalPence: -100,
      invoicedPence: 0,
      remainingToInvoicePence: null,
      sourceUpdatedAt: null,
      asOf: "2026-10-10T12:00:00.000Z",
      history: [],
    }} />);
    expect(textOf("Project costs").replace(/\s/g, "")).toBe("-£1.00");
    expect(textOf("Invoiced").replace(/\s/g, "")).toBe("£0.00");
    expect(textOf("Remaining to invoice")).toBe("Unavailable");
    expect(textOf("Last updated")).toMatch(/10 Oct 2026.*13:00.*UK/);
    expect(screen.getByText("Usage detail is unavailable.")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expectNoAccountsChrome();
  });

  it("shows a supplied invoice when project costs are unknown", () => {
    render(<AccountsProjectSummaryView dashboard={{
      available: true,
      chartAvailable: false,
      sections: [],
      costTotalPence: null,
      invoicedPence: 95_000,
      remainingToInvoicePence: null,
      sourceUpdatedAt: null,
      asOf: "2026-10-10T12:00:00.000Z",
      history: [{ day: "2026-05-27", costPence: null, invoicedPence: 50_000, remainingToInvoicePence: null }],
    }} />);
    expect(textOf("Project costs")).toBe("Unavailable");
    expect(textOf("Invoiced").replace(/\s/g, "")).toBe("£950.00");
    expect(textOf("Remaining to invoice")).toBe("Unavailable");
    expect(screen.queryByText("2026-05-27")).toBeNull();
    expect(screen.getByText("Usage detail is unavailable.")).not.toBeNull();
    expect(screen.queryByText("Net client charges")).toBeNull();
    expect(screen.queryByText("Provisional portion")).toBeNull();
    expect(screen.queryByRole("heading", { name: "What the costs are made of" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Costs by charged day" })).toBeNull();
    expect(screen.queryByText("No cost lines to show.")).toBeNull();
    expect(screen.getByRole("img", { name: /Cumulative project costs by category/ })).not.toBeNull();
    expect(screen.getAllByText("Invoiced").length).toBeGreaterThan(1);
    expect(document.querySelector("[data-chart-line='invoiced']")).not.toBeNull();
    expect(document.querySelector("[data-chart-line='net-total']")).toBeNull();
    expect(document.querySelector("#cost-chart-description")?.textContent).toMatch(/27 May 2026/);
    expect(document.querySelector("#cost-chart-description")?.textContent).toMatch(/£500\.00/);
  });

  it("shows a neutral page error without a supplier reason when the summary is unavailable", () => {
    render(<AccountsProjectSummaryView dashboard={{ available: false }} />);
    expect(screen.getByText("Project costs are unavailable.")).not.toBeNull();
    expect(screen.queryByText("Project cost estimate")).toBeNull();
    expect(screen.queryByText(/£/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expectNoAccountsChrome();
  });

  it("requires an admin and does not call legacy cost loaders in the reader branch", async () => {
    mocks.fetchAccountsCostDashboard.mockResolvedValue(successDashboard());
    const view = await AdminCostsPage();
    render(view);
    expect(mocks.requireRole).toHaveBeenCalledWith("ADMIN");
    expect(mocks.fetchAccountsCostDashboard).toHaveBeenCalledOnce();
    expect(mocks.getCostDashboard).not.toHaveBeenCalled();
    expect(mocks.syncAccountsPreview).not.toHaveBeenCalled();
    expect(mocks.fetchRemoteCostDashboard).not.toHaveBeenCalled();
    expect(mocks.fetchAccountsComparison).not.toHaveBeenCalled();
    expect(mocks.localComparisonOrigin).not.toHaveBeenCalled();
    expect(mocks.resolveLedgerAccess).not.toHaveBeenCalled();
    expect(screen.getByText("Project costs")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "How costs built up" })).not.toBeNull();
    expectNoAccountsChrome();
  });

  it("keeps the disabled dashboard when costs are disabled", async () => {
    mocks.isCostsEnabled.mockReturnValue(false);
    mocks.getCostDashboard.mockResolvedValue(disabledDashboard());
    const view = await AdminCostsPage();
    render(view);
    expect(mocks.requireRole).toHaveBeenCalledWith("ADMIN");
    expect(mocks.fetchAccountsCostDashboard).not.toHaveBeenCalled();
    expect(mocks.getCostDashboard).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(screen.getAllByText("Costs disabled").length).toBeGreaterThan(0);
  });
});
