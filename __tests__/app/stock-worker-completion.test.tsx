// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockWorkerCompletion } from "@/app/(admin)/admin/stock-reviews/worker-completion";
const job = (id: string, status: string) => ({ id, dealerName: id, status, kind: "SCRAPE", startedAt: null });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(1000); });

describe("whole-run completion", () => {
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
