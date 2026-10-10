// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StockSyncReviewPanel } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-panel";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";

vi.mock("@/actions/admin/dealer-stock-sync", () => ({
  approveDealerStockReport: vi.fn(),
  rejectDealerStockReport: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
    expect(screen.getByRole("heading", { name: "Proposed unpublish" })).toBeInTheDocument();
    expect(screen.getAllByText("No usable source photos were found.").length).toBeGreaterThan(0);
    expect(screen.getByText("The listing was edited after its last import. Review it manually.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve exact plan" })).toBeInTheDocument();
  });
});
