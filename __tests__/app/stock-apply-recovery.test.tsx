// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StockApplyRecovery } from "@/lib/dealer-stock-sync/apply-recovery";
const mocks = vi.hoisted(() => ({ recover: vi.fn(), refresh: vi.fn(), reload: vi.fn(), requestRun: vi.fn(), hasWorker: true, hasReload: true }));
vi.mock("@/actions/admin/dealer-stock-recovery", () => ({ recoverDealerStockReport: mocks.recover }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/(admin)/admin/stock-reviews/use-stock-snapshot", () => ({ useStockSnapshotRefresh: () => mocks.hasReload ? mocks.reload : undefined }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-context", () => ({
  useOptionalStockWorkerControl: () => mocks.hasWorker ? ({ requestRun: mocks.requestRun, pending: false, stopping: false }) : null,
}));
vi.mock("@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-selection-controls", () => ({ StockReviewSelectionControls: () => <div>Pending review controls</div> }));
vi.mock("@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-edit-button", () => ({ StockReviewEditButton: () => null }));
vi.mock("@/app/(admin)/admin/dealers/[dealerId]/stock-sync/draft-ownership", () => ({ StockDraftOwnership: () => null }));
vi.mock("@/components/admin/listing-edit-button", () => ({ AdminListingEditButton: () => null }));
import { StockSyncReviewPanel } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-panel";

const recovery: StockApplyRecovery = {
  attempt: { id: "failed-job", status: "FAILED" }, activeJob: null, retryable: true, reason: null,
};
const props = { reportId: "report", fingerprint: "a".repeat(64), status: "APPROVED",
  failureReason: null, actions: [], applyRecovery: recovery };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasWorker = true;
  mocks.hasReload = true;
  mocks.recover.mockResolvedValue({ data: { jobId: "retry-job", status: "queued" } });
  mocks.requestRun.mockImplementation(async (perform: () => Promise<string[]>) => perform());
});
afterEach(cleanup);

describe("approved stock report recovery", () => {
  it("routes a standalone review to Stock Reviews without queueing work", () => {
    mocks.hasWorker = false;
    mocks.hasReload = false;
    render(<StockSyncReviewPanel {...props} reportId="report/id with space" />);
    expect(screen.getByRole("link", { name: "Open stock recovery" })).toHaveAttribute(
      "href", "/admin/stock-reviews?report=report%2Fid%20with%20space",
    );
    expect(screen.getByText("Apply failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry approved changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a fresh check" })).not.toBeInTheDocument();
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.requestRun).not.toHaveBeenCalled();
  });

  it("offers recovery on the approved review without needing its failed notification", () => {
    render(<StockSyncReviewPanel {...props} />);
    expect(screen.getByRole("button", { name: "Retry approved changes" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run a fresh check" })).toBeEnabled();
    expect(screen.getByText("Apply failed")).toBeInTheDocument();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("retries the exact failed attempt through the normal worker launch flow", async () => {
    render(<StockSyncReviewPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry approved changes" }));
    await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith({
      reportId: props.reportId, fingerprint: props.fingerprint, operation: "retry", expectedJobId: "failed-job",
    }));
    await waitFor(() => expect(mocks.requestRun).toHaveReturned());
    expect(await mocks.requestRun.mock.results[0].value).toEqual(["retry-job"]);
    expect(mocks.reload).toHaveBeenCalled();
  });

  it("queues an explicit fresh check without approving its future results", async () => {
    render(<StockSyncReviewPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Run a fresh check" }));
    await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith({
      reportId: props.reportId, fingerprint: props.fingerprint, operation: "fresh",
    }));
    expect(await screen.findByText(/Review and approve its new results/)).toBeInTheDocument();
  });

  it("blocks repeated clicks and permits recovery again when a new attempt fails", async () => {
    let finish!: (value: { data: { jobId: string; status: string } }) => void;
    mocks.recover.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<StockSyncReviewPanel {...props} />);
    const retry = screen.getByRole("button", { name: "Retry approved changes" });
    fireEvent.click(retry); fireEvent.click(retry);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(retry).toBeDisabled();
    await act(async () => { finish({ data: { jobId: "retry-job", status: "queued" } }); });
    rerender(<StockSyncReviewPanel {...props} applyRecovery={{
      ...recovery, attempt: { id: "retry-job", status: "FAILED" },
    }} />);
    expect(screen.getByRole("button", { name: "Retry approved changes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry approved changes" }));
    await waitFor(() => expect(mocks.recover).toHaveBeenLastCalledWith(expect.objectContaining({ expectedJobId: "retry-job" })));
  });

  it.each(["QUEUED", "LEASED"])("blocks recovery while a binding has a %s task", status => {
    render(<StockSyncReviewPanel {...props} applyRecovery={{
      ...recovery, retryable: false,
      activeJob: { id: "active", kind: "APPLY", status },
      reason: "Wait for the current task.",
    }} />);
    expect(screen.getByRole("button", { name: "Retry approved changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run a fresh check" })).toBeDisabled();
  });

  it("keeps a fresh check available for missing or incompatible attempts", () => {
    render(<StockSyncReviewPanel {...props} applyRecovery={{
      attempt: null, activeJob: null, retryable: false, reason: "Run a fresh check.",
    }} />);
    expect(screen.getByRole("button", { name: "Retry approved changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run a fresh check" })).toBeEnabled();
  });

  it("shows a stale-plan refusal without losing the fresh-check action", async () => {
    mocks.recover.mockResolvedValueOnce({ error: "Stock has changed. Run a fresh check." });
    render(<StockSyncReviewPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry approved changes" }));
    expect(await screen.findByText("Stock has changed. Run a fresh check.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Run a fresh check" })).toBeEnabled());
  });

  it("reports an uncertain response and leaves a manual recovery path available", async () => {
    mocks.recover.mockRejectedValueOnce(new Error("connection lost"));
    render(<StockSyncReviewPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry approved changes" }));
    expect(await screen.findByText(/request outcome is uncertain/)).toBeInTheDocument();
    expect(mocks.reload).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry approved changes" })).toBeEnabled());
  });

  it("does not show approved-job recovery after the report is applied or awaiting review", () => {
    const { rerender } = render(<StockSyncReviewPanel {...props} status="APPLIED" />);
    expect(screen.queryByRole("button", { name: "Retry approved changes" })).not.toBeInTheDocument();
    rerender(<StockSyncReviewPanel {...props} status="PENDING_REVIEW" />);
    expect(screen.queryByRole("button", { name: "Retry approved changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Pending review controls")).toBeInTheDocument();
  });
});
