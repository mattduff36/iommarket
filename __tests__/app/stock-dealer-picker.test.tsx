// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const { enqueue, refresh } = vi.hoisted(() => ({ enqueue: vi.fn(), refresh: vi.fn() }));
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: enqueue }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { StockDealerPicker } from "@/app/(admin)/admin/stock-reviews/dealer-picker";
beforeEach(() => { vi.clearAllMocks(); enqueue.mockResolvedValue({ success: true }); });
it("queues only selected dealers and clears successful selections", async () => {
  render(<StockDealerPicker dealers={[{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]} />);
  expect(screen.getByRole("button", { name: "Queue selected dealers" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Beta"));
  fireEvent.click(screen.getByRole("button", { name: "Queue selected dealers" }));
  await waitFor(() => expect(enqueue).toHaveBeenCalledExactlyOnceWith({ dealerId: "b" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 dealer scan queued"));
  expect(screen.getByLabelText("Beta")).not.toBeChecked();
});
it("does not retry an uncertain queue request", async () => {
  enqueue.mockRejectedValueOnce(new Error("lost response"));
  render(<StockDealerPicker dealers={[{ id: "a", name: "Alpha" }]} />);
  fireEvent.click(screen.getByLabelText("Alpha"));
  fireEvent.click(screen.getByRole("button", { name: "Queue selected dealers" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("outcome is uncertain"));
  expect(enqueue).toHaveBeenCalledTimes(1);
});
