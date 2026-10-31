// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
const { submit, refresh } = vi.hoisted(() => ({ submit: vi.fn(), refresh: vi.fn() }));
vi.mock("@/actions/admin/dealer-stock-selection", () => ({ reviewDealerStockSelection: submit }));
vi.mock("@/actions/stock-drafts", () => ({ discardReceivedStockDraft: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-edit-button", () => ({ StockReviewEditButton: () => null }));
vi.mock("@/components/navigation/link", () => ({ default: ({children, href}: {children: React.ReactNode; href: string}) => <a href={href}>{children}</a> }));
import { StockSyncReviewPanel } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-panel";
import { StockDraftReviewNotice } from "@/app/(public)/sell/stock-draft-review-notice";
const actions = [
  { kind: "update", sourceIdentityKey: "one", listingId: "live", displayTitle: "Eligible car", changes: [] },
  { kind: "blocked", sourceIdentityKey: "two", listingId: null, displayTitle: "Blocked car", reason: "detail-uncertain", section: "new" },
  { kind: "blocked", sourceIdentityKey: "sold", displayTitle: "Sold car", reason: "source-sold", section: "new" },
  { kind: "unpublish", sourceIdentityKey: "three", displayTitle: "Missing car", listingId: "missing", absenceCount: 2, lifecycleRevision: 1 },
] as PlanAction[];
const props = { reportId: "report", fingerprint: "a".repeat(64), status: "PENDING_REVIEW", failureReason: null, actions };
describe("stock review selection controls", () => {
  beforeEach(() => { vi.clearAllMocks(); submit.mockResolvedValue({data: {count: 1}}); });
  it("disables mixed approval but lets the exact selected items be sent as drafts", async () => {
    render(<StockSyncReviewPanel {...props} />);
    expect(screen.getByRole("button", {name: "Approve selected"})).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", {name: "Select Eligible car"}));
    expect(screen.getByRole("button", {name: "Approve selected"})).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", {name: "Select Blocked car"}));
    expect(screen.getByRole("button", {name: "Approve selected"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button", {name: "Send selected to dealer drafts"}));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({reportId: "report", fingerprint: props.fingerprint, operation: "draft", actionIndexes: [0,1]}));
    await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
  });
  it("whole-review approval excludes blocked, sold and removal rows", async () => {
    render(<StockSyncReviewPanel {...props} />);
    fireEvent.click(screen.getByRole("button", {name: "Approve all eligible (1)"}));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({operation: "approve", actionIndexes: [0]})));
  });
  it("clear blocked excludes sold identities and preserves selection on an error", async () => {
    submit.mockResolvedValue({error: "This review changed."});
    render(<StockSyncReviewPanel {...props} />);
    fireEvent.click(screen.getByRole("checkbox", {name: "Select Blocked car"}));
    fireEvent.click(screen.getByRole("button", {name: "Reject and clear all blocked (1)"}));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({operation: "reject", actionIndexes: [1]})));
    expect(await screen.findByText("This review changed.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", {name: "Select Blocked car"})).toBeChecked();
  });
  it("shows the unapproved remainder read-only during processing", () => {
    render(<StockSyncReviewPanel {...props} status="APPROVED" actions={[actions[0]]} pendingActions={[actions[1]]} />);
    expect(screen.getByText("Still awaiting your review")).toBeInTheDocument();
    expect(screen.getByText(/Blocked car/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/run a fresh stock check/)).toBeInTheDocument();
  });
  it("requires explicit dealer acknowledgement and exposes only safe source links", () => {
    const onConfirm = vi.fn();
    const {rerender} = render(<StockDraftReviewNotice review={{receiptId:"receipt",blockers:["supply-owned-photos"],source:{action:{sourceUrl:"https://dealer.test/car"}}}} confirmed={false} onConfirm={onConfirm} showConfirmation />);
    expect(screen.getByText(/Upload at least two valid/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onConfirm).toHaveBeenCalledWith(true);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://dealer.test/car");
    rerender(<StockDraftReviewNotice review={{receiptId:"receipt",blockers:[],source:{action:{sourceUrl:"javascript:alert(1)"}}}} confirmed={false} onConfirm={onConfirm} showConfirmation={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
