// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockSyncReviewPanel } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-panel";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { ApproveStockReportButton } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/approve-button";
import { StockReviewEditButton } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-edit-button";
import { approveDealerStockReport, rejectDealerStockReport } from "@/actions/admin/dealer-stock-sync";
import { loadStockReviewVehicle, saveStockReviewVehicle } from "@/actions/admin/dealer-stock-review-edit";
import { loadAdminListingForEdit } from "@/actions/admin/listing-edit";
import { StockSnapshotRefreshProvider } from "@/app/(admin)/admin/stock-reviews/use-stock-snapshot";

vi.mock("@/actions/admin/dealer-stock-sync", () => ({
  approveDealerStockReport: vi.fn(),
  rejectDealerStockReport: vi.fn(),
}));
vi.mock("@/actions/admin/listing-edit", () => ({
  loadAdminListingForEdit: vi.fn(), saveAdminListingEdit: vi.fn(),
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
  it("explains protected listings on focus, click and Escape", () => {
    render(<StockSyncReviewPanel reportId="r" status="PENDING_REVIEW" fingerprint="f" failureReason={null} actions={[
      { kind: "blocked", sourceIdentityKey: "sourceVehicleId:7", listingId: "l", reason: "paid-feature", section: "missing", displayTitle: "Ford Transit" },
    ]} />);
    const help = screen.getByRole("button", { name: /Explain: This featured listing/ });
    fireEvent.focus(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/missing from the latest complete website check/i);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/Open the listing editor/i);
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(help);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(help);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.mouseEnter(help.closest("div")!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(help.closest("div")!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("explains non-live status without suggesting bulk approval will publish it", () => {
    render(<StockSyncReviewPanel reportId="r" status="PENDING_REVIEW" fingerprint="f" failureReason={null} actions={[
      { kind: "blocked", sourceIdentityKey: "detailUrl:https://dealer.example/car/123", listingId: "l", reason: "status-preserved", section: "change", displayTitle: "Hyundai i10" },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: /Explain: The listing is not currently live/ }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/preserves its current status/);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/approval requirements/);
    expect(screen.getByRole("link", { name: "Source listing" })).toHaveAttribute("href", "https://dealer.example/car/123");
    expect(screen.getByRole("button", { name: "Edit / override" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Open listing editor" })).not.toBeInTheDocument();
  });

  it("identifies old unmatched records and explains missing evidence without inventing vehicle details", () => {
    render(<StockSyncReviewPanel reportId="r" status="PENDING_REVIEW" fingerprint="f" failureReason={null} actions={[
      { kind: "blocked", sourceIdentityKey: "sourceVehicleId:old-123", listingId: null, reason: "unmapped", section: "missing", displayTitle: "Vehicle requiring review" },
      { kind: "blocked", sourceIdentityKey: "detailUrl:javascript:alert(1)", listingId: null, reason: "unmapped", section: "missing" },
    ]} />);
    expect(screen.getAllByText(/Previously tracked website record/).length).toBeGreaterThan(0);
    expect(screen.getByText("sourceVehicleId:old-123")).toBeInTheDocument();
    expect(screen.getAllByText(/No vehicle details were saved with this review/)).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Source listing" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Explain: The website record/ })[0]);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/no linked listing to remove/i);
  });

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
    expect(await screen.findByRole("alert", {}, { timeout: 10_000 })).toHaveTextContent(/couldn't load|connection/i);
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
    fireEvent.change(await screen.findByLabelText(/^Title/, {}, { timeout: 10_000 }), { target: { value: "Corrected vehicle" } });
    fireEvent.change(screen.getByLabelText("Correction reason"), { target: { value: "Verified corrected title with dealer" } });
    fireEvent.click(screen.getByLabelText("This vehicle is available"));
    fireEvent.click(screen.getByRole("button", { name: "Review and save" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm save" })));
    expect(screen.getByRole("alert")).toHaveTextContent("save outcome is uncertain");
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Corrected vehicle");
    expect(screen.getByLabelText("Correction reason")).toHaveValue("Verified corrected title with dealer");
    expect(screen.getByLabelText("This vehicle is available")).toBeChecked();
    expect(saveStockReviewVehicle).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});

it("uses the same trigger and dialog for linked Kia and unlinked Skoda reviews", async () => {
  vi.mocked(loadAdminListingForEdit).mockResolvedValueOnce({ data: {
    listing: { id: "kia", title: "2023 Kia PICANTO", description: "Linked vehicle description", price: 1350000,
      status: "PENDING", categoryId: "car", regionId: "douglas", lifecycleRevision: 1, updatedAt: "2026-11-07T00:00:00Z", attributes: [], photoCount: 2 },
    categories: [{ id: "car", name: "Cars", slug: "car", attributes: [] }], regions: [{ id: "douglas", name: "Douglas", active: true }], hasOpenRevision: false, openRevisionStatus: null,
  } });
  vi.mocked(loadStockReviewVehicle).mockResolvedValueOnce({ data: {
    draft: { title: "2019 Skoda FABIA", description: "Unlinked vehicle description", pricePence: null, categorySlug: "car", attributes: {}, photoUrls: [], sourceUrl: null, warning: "Missing price", flags: [] },
    categories: [{ id: "car", name: "Cars", slug: "car", attributes: [] }],
  } });
  render(<>
    <StockReviewEditButton reportId="r" fingerprint="f" sourceIdentityKey="kia-source" listingId="kia" label="Kia" override />
    <StockReviewEditButton reportId="r" fingerprint="f" sourceIdentityKey="skoda-source" label="Skoda" override />
  </>);
  const buttons = screen.getAllByRole("button", { name: "Edit / override" });
  expect(buttons[0].className).toBe(buttons[1].className);
  fireEvent.click(buttons[0]);
  expect(await screen.findByDisplayValue("2023 Kia PICANTO", {}, { timeout: 10_000 })).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Edit listing details" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review and save" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(buttons[1]);
  expect(await screen.findByDisplayValue("2019 Skoda FABIA", {}, { timeout: 10_000 })).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Edit listing details" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review and save" })).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: /Price/ })).toHaveValue(null);
  expect(loadAdminListingForEdit).toHaveBeenCalledWith("kia");
  expect(loadStockReviewVehicle).toHaveBeenCalledWith({ reportId: "r", fingerprint: "f", sourceIdentityKey: "skoda-source" });
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
