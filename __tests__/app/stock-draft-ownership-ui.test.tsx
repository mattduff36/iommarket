// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
const mocks = vi.hoisted(() => ({ ownership: vi.fn(), refresh: vi.fn(), edit: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/actions/admin/dealer-stock-draft-ownership", () => ({ reviewDealerStockDraftOwnership: mocks.ownership }));
vi.mock("@/actions/admin/dealer-stock-selection", () => ({ reviewDealerStockSelection: vi.fn() }));
vi.mock("@/components/admin/listing-edit-button", () => ({ AdminListingEditButton: (props: { listingId: string; stockReview?: unknown }) => {
  mocks.edit(props); return <button>Correct saved listing</button>;
} }));
vi.mock("@/components/admin/stock-draft-photos-button", () => ({ StockDraftPhotosButton: () => <button>Edit draft photos</button> }));
vi.mock("@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-edit-button", () => ({ StockReviewEditButton: () => null }));
vi.mock("@/components/navigation/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
import { StockSyncReviewPanel } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-panel";
const handoff: NonNullable<PlanAction["stockDraft"]> = { receiptId: "receipt", dealerId: "dealer", reportId: "origin", listingId: "listing",
  sourceIdentityKey: "source", revisionId: null, state: "dealer", sentAt: "2026-11-07T12:00:00Z", recalledAt: null,
  blockers: ["supply-owned-photos"], title: "Dealer's saved car", lifecycleRevision: 4, photoRevision: 2, updatedAt: "2026-11-07T12:00:00Z", revisionVersion: null };
const row: PlanAction = { kind: "blocked", section: "change", reason: "awaiting-dealer-review", sourceIdentityKey: "source", listingId: "listing", displayTitle: "Dealer's saved car", stockDraft: handoff };
const props = { reportId: "report", fingerprint: "a".repeat(64), status: "PENDING_REVIEW", failureReason: null, actions: [row] };
beforeEach(() => { vi.clearAllMocks(); mocks.ownership.mockResolvedValue({ data: { alreadyDone: false } }); });
describe("stock draft ownership UI", () => {
  it("keeps handoff history visible while other selected work is being processed", () => {
    render(<StockSyncReviewPanel {...props} status="APPROVED" actions={[]} pendingActions={[row]} />);
    expect(screen.getByText(/Already sent to dealer drafts/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull back to review" })).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("separates pending dealer drafts from blocked items and prevents duplicate draft/approval selection", () => {
    render(<StockSyncReviewPanel {...props} />);
    expect(screen.getByRole("heading", { name: "Awaiting dealer review" })).toBeInTheDocument();
    expect(screen.getByText(/0 actionable, 0 blocked/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send selected to dealer drafts" })).toBeDisabled();
    expect(screen.queryByText(/listing is not currently live/)).not.toBeInTheDocument();
    expect(screen.getByText(/not a current validation/)).toBeInTheDocument();
  });
  it("requires an explicit preservation confirmation before recall and refreshes only on success", async () => {
    render(<StockSyncReviewPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Pull back to review" }));
    expect(mocks.ownership).not.toHaveBeenCalled();
    expect(screen.getByText(/All saved dealer edits, photos and the original listing identity will be preserved/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Pull back to review" }).at(-1)!);
    await waitFor(() => expect(mocks.ownership).toHaveBeenCalledWith(expect.objectContaining({ reportId: "report", receiptId: "receipt", operation: "recall", confirmed: true, expectedPhotoRevision: 2 })));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
  it("shows shared details and photo correction after recall, without resolving/removing the review row", async () => {
    render(<StockSyncReviewPanel {...props} actions={[{ ...row, stockDraft: { ...handoff, state: "admin", recalledAt: handoff.sentAt } }]} />);
    expect(screen.getByRole("heading", { name: "Returned to admin stock review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Correct saved listing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit draft photos" })).toBeInTheDocument();
    expect(mocks.edit).toHaveBeenCalledWith(expect.not.objectContaining({ stockReview: expect.anything() }));
    fireEvent.click(screen.getByRole("button", { name: "Send to listing moderation" }));
    expect(screen.getByText(/sent to listing moderation, not published/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Send to listing moderation" }).at(-1)!);
    await waitFor(() => expect(mocks.ownership).toHaveBeenCalledWith(expect.objectContaining({ operation: "moderation", confirmed: true })));
  });
  it("reports stale-version failures without pretending that recall completed", async () => {
    mocks.ownership.mockResolvedValue({ error: "This draft changed. Refresh." });
    render(<StockSyncReviewPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Pull back to review" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Pull back to review" }).at(-1)!);
    expect(await screen.findByText("This draft changed. Refresh.")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(["moderation", "revision"])("does not offer recall for submitted or live-revision handoffs: %s", state => {
    render(<StockSyncReviewPanel {...props} actions={[{ ...row, stockDraft: { ...handoff, ...(state === "revision" ? { revisionId: "revision" } : { state: "moderation" as const }) } }]} />);
    expect(screen.queryByRole("button", { name: "Pull back to review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
