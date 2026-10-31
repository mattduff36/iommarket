// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockSyncReviewPanel } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-panel";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { ApproveStockReportButton } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/approve-button";
import { StockReviewEditButton } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-edit-button";
import { approveDealerStockReport, rejectDealerStockReport } from "@/actions/admin/dealer-stock-sync";
import { loadStockReviewVehicle, saveStockReviewVehicle } from "@/actions/admin/dealer-stock-review-edit";
import { StockSnapshotRefreshProvider } from "@/app/(admin)/admin/stock-reviews/use-stock-snapshot";

vi.mock("@/actions/admin/dealer-stock-sync", () => ({
  approveDealerStockReport: vi.fn(),
  rejectDealerStockReport: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/actions/admin/dealer-stock-review-edit", () => ({
  loadStockReviewVehicle: vi.fn(), saveStockReviewVehicle: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const actions: PlanAction[] = [
  {
    kind: "update",
    sourceIdentityKey: "sourceVehicleId:1",
    listingId: "listing-1",
    lifecycleRevision: 1,
    photoRevision: 1,
    featured: false,
    changes: [{ field: "price", before: 100, after: 90 }],
  },
  {
    kind: "missing_once",
    sourceIdentityKey: "sourceVehicleId:2",
    listingId: "listing-2",
    absenceCount: 1,
  },
  {
    kind: "unpublish",
    sourceIdentityKey: "sourceVehicleId:3",
    listingId: "listing-3",
    absenceCount: 2,
    lifecycleRevision: 4,
  },
  {
    kind: "blocked",
    sourceIdentityKey: "sourceVehicleId:4",
    listingId: null,
    reason: "images-not-owned",
    section: "new",
  },
  {
    kind: "conflict",
    sourceIdentityKey: "sourceVehicleId:5",
    listingId: "listing-5",
    reason: "dealer-edited",
    changes: [],
  },
];

describe("stock sync review", () => {
  it("shows field changes, one absence, a second-absence unpublish, and blocks", () => {
    render(
      <StockSyncReviewPanel
        reportId="report-1"
        status="PENDING_REVIEW"
        fingerprint={"a".repeat(64)}
        failureReason={null}
        actions={actions}
      />,
    );
    expect(screen.getByText(/Price:.*1.00 to.*0.90/)).toBeInTheDocument();
    expect(screen.getByText("Missing from 1 complete checks")).toBeInTheDocument();
    expect(screen.getByText("Missing from 2 complete checks")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Removal suggestions — review separately" })).toBeInTheDocument();
    expect(screen.getAllByText("No usable source photos were found.").length).toBeGreaterThan(0);
    expect(screen.getByText("The listing was edited after its last import. Review it manually.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve all eligible (1)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve exact plan" })).not.toBeInTheDocument();
  });
});

describe("stock review network recovery", () => {
  it.each(["Approve exact plan", "Reject and clear"])("keeps %s failures local without replaying the write", async label => {
    const action = label === "Approve exact plan" ? approveDealerStockReport : rejectDealerStockReport;
    vi.mocked(action).mockRejectedValueOnce(new TypeError("network error"));
    const reload = vi.fn();
    render(<StockSnapshotRefreshProvider value={reload}><ApproveStockReportButton reportId="r" fingerprint="f" /></StockSnapshotRefreshProvider>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: label })));
    expect(screen.getByRole("alert")).toHaveTextContent("outcome is uncertain");
    expect(screen.getByRole("alert")).toHaveTextContent("Check the saved result before trying again");
    expect(action).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps a failed vehicle read local and does not send a write", async () => {
    vi.mocked(loadStockReviewVehicle).mockRejectedValueOnce(new TypeError("network error"));
    render(<StockReviewEditButton reportId="r" fingerprint="f" sourceIdentityKey="v" label="Vehicle" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this vehicle");
    expect(loadStockReviewVehicle).toHaveBeenCalledTimes(1);
    expect(saveStockReviewVehicle).not.toHaveBeenCalled();
  });

  it("retains the complete draft after an uncertain save and does not replay it", async () => {
    vi.mocked(loadStockReviewVehicle).mockResolvedValueOnce({ data: {
      draft: { title: "Vehicle", description: "Original description", pricePence: 1250000, categorySlug: "car", attributes: {}, photoUrls: ["https://dealer.example/car.jpg"], sourceUrl: null, warning: null, flags: [] },
      categories: [{ id: "car", name: "Cars", slug: "car", attributes: [] }],
    } });
    vi.mocked(saveStockReviewVehicle).mockRejectedValueOnce(new TypeError("network error"));
    const reload = vi.fn();
    render(<StockSnapshotRefreshProvider value={reload}><StockReviewEditButton reportId="r" fingerprint="f" sourceIdentityKey="v" label="Vehicle" /></StockSnapshotRefreshProvider>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit" })));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Corrected vehicle" } });
    fireEvent.change(screen.getByLabelText("Correction reason"), { target: { value: "Verified corrected title with dealer" } });
    fireEvent.click(screen.getByLabelText("This vehicle is available"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save corrections" })));
    expect(screen.getByRole("alert")).toHaveTextContent("save outcome is uncertain");
    expect(screen.getByLabelText("Title")).toHaveValue("Corrected vehicle");
    expect(screen.getByLabelText("Correction reason")).toHaveValue("Verified corrected title with dealer");
    expect(screen.getByLabelText("This vehicle is available")).toBeChecked();
    expect(saveStockReviewVehicle).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});

it("shows live photo/spec evidence and hides every sold row", () => {
  const review = { displayTitle: "Available Focus", fuel: "Petrol", transmission: "Manual", flags: [], pricePence: 100000, mileage: 12000, year: 2020, categorySlug: "car" as const, sourceUrl: "https://dealer.example/focus", safePhotoUrls: ["https://dealer.example/focus.jpg"], availability: "available" as const, provenance: [], sourceHash: "hash", capturedAt: "2026-10-22T19:00:00Z", coverageWarning: null, capacityWarning: null };
  const visible = { ...actions[0]!, displayTitle: "Available Focus", review };
  const sold: PlanAction[] = ["sold", "source-sold", "sold-preserved", "sold-exclude-from-live-import"].map(reason => ({ kind: "blocked", sourceIdentityKey: reason, listingId: null, reason, section: "new", displayTitle: "Hidden sold vehicle" }));
  render(<StockSyncReviewPanel reportId="r" status="PENDING_REVIEW" fingerprint="f" failureReason={null} actions={[visible, ...sold]} />);
  expect(screen.getByRole("img", { name: "Available Focus" })).toHaveAttribute("src", "https://dealer.example/focus.jpg");
  expect(screen.getByText(/Petrol.*Manual/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Source listing" })).toHaveAttribute("href", review.sourceUrl);
  expect(screen.queryByText(/Hidden sold vehicle/)).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Sold excluded" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
});
