// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockWorkerCompletion, stockJobOutcome } from "@/app/(admin)/admin/stock-reviews/worker-completion";
import { stockReviewListingCount } from "@/app/(admin)/admin/stock-reviews/worker-review-summary";
const job = (id: string, status: string) => ({ id, dealerName: id, status, kind: "SCRAPE", startedAt: null });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(1000); });

describe("report-backed review counts", () => {
  const row = (kind: string, sourceIdentityKey: string | null = null, listingId: string | null = null) => ({ kind, sourceIdentityKey, listingId });
  it("counts distinct visible review work across both groups, including drafts and unidentified rows", () => {
    expect(stockReviewListingCount({ actions: [
      row("create", "new"), row("update", "changed", "listing"),
      { ...row("blocked", "blocked"), reason: "missing-region", section: "new" },
      { ...row("conflict", "conflict"), reason: "dealer-edited" },
      row("missing_once", "missing"), row("unpublish", "gone"),
      { ...row("unchanged", "draft"), stockDraft: { state: "dealer", listingId: "draft-listing", sourceIdentityKey: "draft" } },
      row("create"), row("create"),
    ], pendingReviewActions: [
      row("update", "changed", "listing"), row("update", "alias", "listing"), row("create", "alias"),
      { ...row("blocked", "blocked"), reason: "missing-region", section: "new" },
    ] })).toBe(9);
  });
  it("merges listing/source aliases even when a later row connects earlier groups", () => {
    expect(stockReviewListingCount({ actions: [row("update", null, "listing"), row("create", "source")],
      pendingReviewActions: [row("update", "source", "listing")] })).toBe(1);
  });
  it("excludes unchanged and sold work using every existing sold marker", () => {
    expect(stockReviewListingCount({ actions: [
      row("unchanged", "same"),
      { ...row("update", "sold"), review: { availability: "sold", flags: [] } },
      { ...row("create", "flagged"), review: { availability: "available", flags: ["sold-exclude-from-live-import"] } },
      ...["sold", "source-sold", "sold-preserved", "sold-exclude-from-live-import"].map(reason => ({ ...row("blocked", reason), reason, section: "other" })),
    ] })).toBe(0);
    expect(stockReviewListingCount({ actions: [] })).toBe(0);
  });
  it.each([undefined, null, {}, { actions: null }, { actions: [], pendingReviewActions: {} },
    { actions: [null] }, { actions: [{ kind: "future" }] }, { actions: [{ kind: "unchanged", listingId: 123 }] },
    { actions: [{ kind: "update", review: { availability: "available" } }] },
    { actions: [{ kind: "unchanged", stockDraft: {} }] },
  ])("keeps malformed or absent evidence unknown: %j", plan => {
    expect(stockReviewListingCount(plan)).toBeNull();
  });
});

describe("completion summaries", () => {
  it.each([0, 1, 4])("renders the exact success text and colours for %i review listings", async reviewListingCount => {
    const base = { ...job("Island Motors", "LEASED"), reportStatus: "PENDING_REVIEW", reviewListingCount };
    const view = render(<StockWorkerCompletion jobs={[base]} canShow={() => true} />);
    view.rerender(<StockWorkerCompletion jobs={[{ ...base, status: "SUCCEEDED" }]} canShow={() => true} />);
    await tick();
    const success = screen.getByText("Success", { exact: true });
    const suffix = reviewListingCount === 0 ? "- no new changes" : `- ${reviewListingCount} ${reviewListingCount === 1 ? "listing" : "listings"} for review`;
    expect(success).toHaveClass("text-emerald-400");
    expect(screen.getByText(suffix, { exact: true })).toHaveClass(reviewListingCount === 0 ? "text-text-primary" : "text-emerald-400");
    expect(screen.getByText(suffix, { exact: true })).not.toHaveClass(reviewListingCount === 0 ? "text-emerald-400" : "text-text-primary");
    expect(success.closest("li")).toHaveClass("text-text-primary");
    expect(success.closest("li")).not.toHaveClass("text-emerald-400");
    expect(success.closest("li")).toHaveTextContent(`Island Motors: Success ${suffix}`);
    expect(stockJobOutcome({ ...base, status: "SUCCEEDED" })).toBe(`Island Motors: Success ${suffix}`);
    expect(screen.queryByText(/successful scans still require/)).not.toBeInTheDocument();
  });
  it.each([
    { status: "FAILED", reportStatus: "PENDING_REVIEW", expected: "task failed — check the saved result" },
    { status: "CANCELLED", reportStatus: "PENDING_REVIEW", expected: "task cancelled" },
    { status: "SUCCEEDED", reportStatus: "FAILED", expected: "task failed — check the saved result" },
    { status: "SUCCEEDED", reportStatus: "APPLIED", expected: "finished — stock update applied" },
    { status: "SUCCEEDED", reportStatus: "APPROVED", expected: "finished — report approved, awaiting application" },
  ])("retains truthful $status/$reportStatus precedence", async ({ status, reportStatus, expected }) => {
    const base = { ...job("Dealer", "LEASED"), reportStatus, reviewListingCount: 0 };
    const view = render(<StockWorkerCompletion jobs={[base]} canShow={() => true} />);
    view.rerender(<StockWorkerCompletion jobs={[{ ...base, status }]} canShow={() => true} />);
    await tick();
    expect(screen.getByRole("listitem")).toHaveTextContent(`Dealer: ${expected}`);
    expect(screen.queryByText("Success", { exact: true })).not.toBeInTheDocument();
    if (expected.startsWith("task failed")) expect(screen.getByText("task failed")).toHaveClass("text-red-400");
    expect(stockJobOutcome({ ...base, status })).toBe(`Dealer: ${expected}`);
  });
  it("does not apply scan summaries to apply jobs or missing reports", () => {
    expect(stockJobOutcome({ ...job("Dealer", "SUCCEEDED"), kind: "APPLY", reportStatus: "PENDING_REVIEW", reviewListingCount: 1 })).toBe("Dealer: Success - check the saved result");
    expect(stockJobOutcome({ ...job("Dealer", "SUCCEEDED"), reviewListingCount: 0 })).toBe("Dealer: finished — check the saved result");
  });
  it.each([-1, 1.5, NaN])("keeps invalid count %s unknown", reviewListingCount => {
    expect(stockJobOutcome({ ...job("Dealer", "SUCCEEDED"), reportStatus: "PENDING_REVIEW", reviewListingCount })).toBe("Dealer: Success - check the saved result");
  });
  it.each([null, undefined])("does not infer no changes from pending status without count evidence (%s)", reviewListingCount => {
    expect(stockJobOutcome({ ...job("Dealer", "SUCCEEDED"), reportStatus: "PENDING_REVIEW", reviewListingCount })).toBe("Dealer: Success - check the saved result");
    expect(stockJobOutcome({ ...job("Dealer", "SUCCEEDED"), reviewListingCount })).toBe("Dealer: finished — check the saved result");
  });
});

describe("whole-run completion", () => {
  it("defers completion until the page unlocks and retains a notice across a new lock", async () => {
    const canShow = () => true;
    const ui = (status: string, blocked: boolean) => <StockWorkerCompletion jobs={[job("A", status)]} canShow={canShow} blocked={blocked} />;
    const view = render(ui("LEASED", true));
    view.rerender(ui("SUCCEEDED", true));
    await tick(); expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(ui("SUCCEEDED", false));
    expect(screen.getByRole("dialog", { name: "Stock Update run finished" })).toBeInTheDocument();
    view.rerender(ui("SUCCEEDED", true));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(ui("SUCCEEDED", false));
    expect(screen.getByRole("button", { name: "Got it" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await tick(); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows one summary after all dealers finish, retaining earlier results", async () => {
    const canShow = () => true;
    const view = render(<StockWorkerCompletion jobs={[job("A", "LEASED"), job("B", "QUEUED")]} canShow={canShow} />);
    view.rerender(<StockWorkerCompletion jobs={[job("A", "FAILED"), job("B", "LEASED")]} canShow={canShow} />);
    await tick(); expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<StockWorkerCompletion jobs={[job("B", "SUCCEEDED")]} canShow={canShow} />);
    await tick(); expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("task failed").closest("li")).toHaveTextContent(/A: task failed/);
    expect(screen.getByText(/finished.*check/).closest("li")).toHaveTextContent(/B: finished/);
    fireEvent.click(screen.getByText("Got it"));
    view.rerender(<StockWorkerCompletion jobs={[job("A", "FAILED"), job("B", "SUCCEEDED")]} canShow={canShow} />);
    await tick(); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("does not infer completion when an active job disappears", async () => {
    const view = render(<StockWorkerCompletion jobs={[job("A", "LEASED")]} canShow={() => true} />);
    view.rerender(<StockWorkerCompletion jobs={[]} canShow={() => true} />);
    await tick(); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("ignores initial history and defers a completed run while editing", async () => {
    let visible = false;
    const canShow = () => visible;
    const view = render(<StockWorkerCompletion jobs={[job("old", "SUCCEEDED")]} canShow={canShow} />);
    await tick(); expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<StockWorkerCompletion jobs={[job("new", "FAILED")]} canShow={canShow} />);
    await tick(); expect(screen.queryByRole("dialog")).toBeNull();
    visible = true; await tick();
    expect(screen.getByText("task failed").closest("li")).toBeTruthy();
    expect(screen.queryByText(/old: finished/)).toBeNull();
  });
});
