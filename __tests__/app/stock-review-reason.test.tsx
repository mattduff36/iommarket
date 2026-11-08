// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StockReviewReason } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-reason";
const action = { kind: "blocked" as const, section: "new" as const, reason: "missing-price", sourceIdentityKey: "stock:1", listingId: null };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("waits 400ms on the help link and cancels passing hovers", () => {
  render(<StockReviewReason action={action} />);
  const button = screen.getByRole("button");
  fireEvent.mouseEnter(button);
  act(() => vi.advanceTimersByTime(399));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseLeave(button);
  act(() => vi.advanceTimersByTime(401));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseEnter(button);
  act(() => vi.advanceTimersByTime(400));
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
});
it("opens immediately for keyboard focus or a deliberate click and cancels on Escape", () => {
  render(<StockReviewReason action={action} />);
  const button = screen.getByRole("button");
  fireEvent.focus(button);
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
  fireEvent.keyDown(button, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseEnter(button);
  fireEvent.keyDown(button, { key: "Escape" });
  act(() => vi.advanceTimersByTime(400));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
});
it("does not open from hovering the reason text and cleans up a pending hover", () => {
  const { unmount } = render(<StockReviewReason action={action} />);
  fireEvent.mouseEnter(screen.getByText(/missing price/i));
  act(() => vi.advanceTimersByTime(400));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseEnter(screen.getByRole("button"));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

