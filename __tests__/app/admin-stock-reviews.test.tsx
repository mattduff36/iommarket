// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
const reportFindMany = vi.fn();
const jobFindMany = vi.fn();
const { dashboardProps } = vi.hoisted(() => ({ dashboardProps: vi.fn() }));

vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ getWorkerDashboard: vi.fn().mockResolvedValue({ok:true,devices:[]}) }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-dashboard", () => ({ StockWorkerDashboard: (props: {children: import("react").ReactNode}) => { dashboardProps(props); return props.children; } }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-pairing", () => ({ StockWorkerPairing: () => null }));
vi.mock("@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-panel", () => ({ StockSyncReviewPanel: () => null }));
vi.mock("@/app/(admin)/admin/stock-reviews/dealer-picker", () => ({ StockDealerPicker: () => null }));

vi.mock("@/lib/auth", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: { findMany: vi.fn().mockResolvedValue([]) },
    dealerStockSourceBinding: { findMany: vi.fn().mockResolvedValue([]) },
    dealerStockSyncReport: { findMany: (...args: unknown[]) => reportFindMany(...args) },
    dealerStockSyncJob: { findMany: (...args: unknown[]) => jobFindMany(...args) },
  },
}));

vi.mock("@/components/navigation/link", () => ({
  default: ({ href, children }: { href: string; children: string }) => {
    const React = require("react") as typeof import("react");
    return React.createElement("a", { href }, children);
  },
}));

import AdminStockReviewsPage from "@/app/(admin)/admin/stock-reviews/page";

const when = new Date("2026-10-21T09:00:00.000Z");

function dealer(id: string, name: string) {
  return { binding: { dealer: { id, name } } };
}

function report(overrides: Record<string, unknown>) {
  return {
    id: "report",
    status: "PENDING_REVIEW",
    inventoryCount: 4,
    failureReason: null,
    createdAt: when,
    plan: { actions: [] },
    ...dealer("dealer-1", "Island Motors"),
    ...overrides,
  };
}

function job(overrides: Record<string, unknown>) {
  return {
    id: "job",
    kind: "SCRAPE",
    status: "QUEUED",
    error: null,
    createdAt: when,
    reportId: null,
    binding: { dealer: { id: "dealer-1", name: "Island Motors" } },
    report: null,
    ...overrides,
  };
}

function warnings(actions: unknown[]) {
  return {
    actions,
    reviewSource: {
      coverageWarning: "The website did not confirm every stock page.",
      capacityWarning: "More vehicles were advertised than this check can hold.",
    },
  };
}

async function renderPage(outstanding: unknown[], recent: unknown[] = [], jobs: unknown[] = []) {
  reportFindMany.mockImplementation(async (args: { where: { status: { in: string[] } } }) => {
    return args.where.status.in.includes("PENDING_REVIEW") ? outstanding : recent;
  });
  jobFindMany.mockResolvedValue(jobs);
  render(await AdminStockReviewsPage());
}

describe("admin stock reviews", () => {
  it("associates scrape report outcomes by run id when the job has no report relation", async () => {
    await renderPage([], [report({ status: "FAILED", scrapeRunId: "scan", inventoryCount: 0 })], [job({ id: "scan", status: "SUCCEEDED" })]);
    expect(dashboardProps).toHaveBeenCalledWith(expect.objectContaining({ jobs: [expect.objectContaining({ id: "scan", reportStatus: "FAILED" })] }));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({ id: "admin-1" });
  });

  it("requires an admin and lists every pending and approved review with warnings", async () => {
    await renderPage([
      report({
        id: "pending-1",
        status: "PENDING_REVIEW",
        plan: warnings([{ kind: "update", sourceIdentityKey: "a", listingId: "l1" }, { kind: "unpublish", sourceIdentityKey: "b", listingId: "l2" }]),
      }),
      report({
        id: "approved-1",
        status: "APPROVED",
        ...dealer("dealer-2", "Harbour Cars"),
        plan: warnings([{ kind: "unchanged", sourceIdentityKey: "c" }]),
      }),
    ]);

    expect(requireRole).toHaveBeenCalledWith("ADMIN");
    const outstandingQuery = reportFindMany.mock.calls.map((call) => call[0]).find((query) => query.where.status.in.includes("PENDING_REVIEW"));
    expect(outstandingQuery.where).toEqual({ status: { in: ["PENDING_REVIEW", "APPROVED"] } });
    expect(outstandingQuery.take).toBeUndefined();
    expect(screen.getByRole("heading", { name: "Island Motors" })).toBeInTheDocument();
    expect(screen.getByText("Awaiting review · 4 vehicles")).toBeInTheDocument();
    expect(screen.getByText(/1 proposed removal/)).toBeInTheDocument();
    expect(screen.getAllByText("The website did not confirm every stock page.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("More vehicles were advertised than this check can hold.").length).toBeGreaterThan(0);
    expect(screen.getByText("Approved, not applied yet · 4 vehicles")).toBeInTheDocument();
    expect(screen.getByText("Approval queues processing and does not apply listings by itself.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open dealer stock review" }).every((link) =>
      link.getAttribute("href")?.startsWith("/admin/stock-reviews?report="),
    )).toBe(true);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  it("shows a failed job with no report and does not treat a finished job as applied", async () => {
    await renderPage([], [], [
      job({ id: "failed-job", status: "FAILED", error: "Stock sync job failed.", reportId: null, report: null }),
      job({
        id: "done-job",
        status: "SUCCEEDED",
        kind: "SCRAPE",
        reportId: null,
        report: null,
        binding: { dealer: { id: "dealer-3", name: "No Report Motors" } },
      }),
    ]);

    expect(screen.getByText("Check failed. No report was saved.")).toBeInTheDocument();
    expect(screen.getByText("Stock sync job failed.")).toBeInTheDocument();
    expect(screen.getByText("Finished processing. Open the dealer stock review to check the saved result.")).toBeInTheDocument();
    expect(screen.queryByText(/succeeded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Applied/)).not.toBeInTheDocument();
  });

  it("shows an applied report from the saved report, including removals", async () => {
    await renderPage([], [
      report({
        id: "applied-1",
        status: "APPLIED",
        inventoryCount: 6,
        plan: { actions: [{ kind: "unpublish", sourceIdentityKey: "gone", listingId: "l9" }, { kind: "unpublish", sourceIdentityKey: "gone-2", listingId: "l8" }] },
      }),
    ], [
      job({ id: "apply-job", kind: "APPLY", status: "SUCCEEDED", reportId: "applied-1", report: { id: "applied-1", status: "APPLIED" } }),
    ]);

    expect(screen.getByText("Applied · 6 vehicles")).toBeInTheDocument();
    expect(screen.getByText(/2 removals/)).toBeInTheDocument();
    expect(screen.getByText("Listings from this approved plan were applied.")).toBeInTheDocument();
    expect(screen.queryByText(/succeeded/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open dealer stock review" })).toHaveAttribute("href", "/admin/stock-reviews?report=applied-1#stock-review-detail");
  });

  it("shows queued and processing jobs and a no-change review", async () => {
    await renderPage([
      report({ id: "quiet-1", status: "PENDING_REVIEW", plan: { actions: [{ kind: "unchanged", sourceIdentityKey: "same" }] } }),
    ], [], [
      job({ id: "queued-job", status: "QUEUED", kind: "SCRAPE" }),
      job({ id: "leased-job", status: "LEASED", kind: "APPLY", binding: { dealer: { id: "dealer-4", name: "Processing Cars" } } }),
    ]);

    expect(screen.getByText("No change · 4 vehicles")).toBeInTheDocument();
    expect(screen.getByText("Nothing to approve. Listings were not changed.")).toBeInTheDocument();
    expect(screen.getByText("Check queued")).toBeInTheDocument();
    expect(screen.getByText("Apply processing")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting review · 4 vehicles")).not.toBeInTheDocument();
  });

  it("shows a failed report and an empty history", async () => {
    await renderPage([], [
      report({ id: "failed-report", status: "FAILED", inventoryCount: 0, failureReason: "source-failed", plan: { actions: [] } }),
    ]);

    expect(screen.getByText("Failed · 0 vehicles")).toBeInTheDocument();
    expect(screen.getByText("One or more website sections could not be checked.")).toBeInTheDocument();
    const recentQuery = reportFindMany.mock.calls.map((call) => call[0]).find((query) => query.where.status.in.includes("FAILED"));
    expect(recentQuery.take).toBe(20);

    reportFindMany.mockResolvedValue([]);
    jobFindMany.mockResolvedValue([]);
    render(await AdminStockReviewsPage());
    expect(screen.getByText("No pending or approved stock reviews and no recent worker runs.")).toBeInTheDocument();
  });

  it("does not read reviews when the admin guard rejects", async () => {
    requireRole.mockRejectedValueOnce(new Error("unauthorized"));
    await expect(AdminStockReviewsPage()).rejects.toThrow("unauthorized");
    expect(reportFindMany).not.toHaveBeenCalled();
    expect(jobFindMany).not.toHaveBeenCalled();
  });

  it("keeps a failed apply visible alongside its still-approved report", async () => {
    await renderPage([report({ id: "approved", status: "APPROVED" })], [], [
      job({ kind: "APPLY", status: "FAILED", reportId: "approved", report: { id: "approved", status: "APPROVED" }, error: "Stock sync job failed." }),
    ]);
    expect(screen.getByText("Apply failed")).toBeInTheDocument();
    expect(screen.getByText("Stock sync job failed.")).toBeInTheDocument();
  });

  it("matches a scrape job to its report by scrapeRunId without claiming no report exists", async () => {
    await renderPage([report({ scrapeRunId: "scrape-job" })], [], [job({ id: "scrape-job", status: "SUCCEEDED" })]);
    expect(screen.getByText("No change · 4 vehicles")).toBeInTheDocument();
    expect(screen.queryByText(/Finished processing/)).not.toBeInTheDocument();
  });
});
