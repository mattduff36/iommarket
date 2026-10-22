// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const { enqueue, refresh, dashboard, command } = vi.hoisted(() => ({ enqueue: vi.fn(), refresh: vi.fn(), dashboard: vi.fn(), command: vi.fn() }));
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: enqueue }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ getWorkerDashboard: dashboard, commandWorker: command }));
import { StockDealerPicker } from "@/app/(admin)/admin/stock-reviews/dealer-picker";
import { StockWorkerDashboard } from "@/app/(admin)/admin/stock-reviews/worker-dashboard";

const dealers = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];
const device = (overrides: Record<string, unknown> = {}) => ({
  deviceId: "dev_test", deviceName: "Test computer", environment: "preview" as const, instanceId: "instance",
  state: "connected" as const, online: true, lastSeenAt: new Date().toISOString(), activity: [], pendingCommand: null, ...overrides,
});
const connected = (devices = [device()]) => ({ ok: true as const, devices });

function renderPicker(initial = connected()) {
  dashboard.mockResolvedValue(initial);
  return render(<StockWorkerDashboard initial={initial} jobs={[]} readyCount={0}><StockDealerPicker dealers={dealers} /></StockWorkerDashboard>);
}
function picker() {
  const section = screen.getByRole("heading", { name: "Choose dealers to scrape" }).closest("section");
  if (!section) throw new Error("picker missing");
  return within(section);
}

beforeEach(() => { vi.clearAllMocks(); enqueue.mockResolvedValue({ success: true }); command.mockResolvedValue({ ok: true }); });

it("queues only selected dealers and starts once after those queues succeed", async () => {
  const order: string[] = [];
  enqueue.mockImplementation(async ({ dealerId }: { dealerId: string }) => { order.push(`queue:${dealerId}`); return { success: true }; });
  command.mockImplementation(async (input: { action: string }) => { order.push(input.action); return { ok: true }; });
  renderPicker();
  expect(picker().getByRole("button", { name: "Start worker" })).toBeDisabled();
  expect(screen.getByText(/worker starts after those queues succeed/)).toBeInTheDocument();
  fireEvent.click(picker().getByLabelText("Beta"));
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(order).toEqual(["queue:b", "start"]));
  expect(command).toHaveBeenCalledExactlyOnceWith({ deviceId: "dev_test", instanceId: "instance", action: "start" });
  await waitFor(() => expect(picker().getByRole("status")).toHaveTextContent("1 dealer scan queued"));
  expect(picker().getByLabelText("Beta")).not.toBeChecked();
  expect(picker().getByLabelText("Alpha")).not.toBeChecked();
});

it("does not retry an uncertain queue request or start the worker", async () => {
  enqueue.mockRejectedValueOnce(new Error("lost response"));
  renderPicker();
  fireEvent.click(picker().getByLabelText("Alpha"));
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(picker().getByRole("status")).toHaveTextContent("outcome is uncertain"));
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(command).not.toHaveBeenCalled();
  expect(picker().getByLabelText("Alpha")).toBeChecked();
});

it("does not start when every queue fails and keeps partial failures when one succeeds", async () => {
  renderPicker();
  fireEvent.click(picker().getByLabelText("Alpha"));
  enqueue.mockResolvedValue({ error: "Website source needs setup" });
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(picker().getByRole("status")).toHaveTextContent("No dealer scans were queued. Alpha: Website source needs setup"));
  expect(command).not.toHaveBeenCalled();

  enqueue.mockImplementation(async ({ dealerId }: { dealerId: string }) => dealerId === "a" ? { error: "Website source needs setup" } : { success: true });
  fireEvent.click(picker().getByLabelText("Beta"));
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(picker().getByRole("status")).toHaveTextContent("1 dealer scan queued. Alpha: Website source needs setup");
  expect(picker().getByLabelText("Alpha")).toBeChecked();
  expect(picker().getByLabelText("Beta")).not.toBeChecked();
});

it("shares one start across the picker and sticky control", async () => {
  enqueue.mockImplementation(() => {
    const button = document.querySelector("[data-stock-worker-dock] button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing dock button");
    fireEvent.click(button);
    return Promise.resolve({ success: true });
  });
  renderPicker();
  fireEvent.click(picker().getByLabelText("Alpha"));
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(command).toHaveBeenCalledWith({ deviceId: "dev_test", instanceId: "instance", action: "start" });
});

it("starts the dashboard-selected computer", async () => {
  renderPicker(connected([device(), device({ deviceId: "dev_other", deviceName: "Other computer", instanceId: "other-instance" })]));
  fireEvent.change(screen.getByLabelText("Computer"), { target: { value: "dev_other" } });
  fireEvent.click(picker().getByLabelText("Alpha"));
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ deviceId: "dev_other", instanceId: "other-instance", action: "start" }));
});

it("stops without a selection and does not enqueue", async () => {
  renderPicker(connected([device({ state: "running" })]));
  expect(picker().getByRole("button", { name: "Stop safely" })).toBeEnabled();
  fireEvent.click(picker().getByRole("button", { name: "Stop safely" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ deviceId: "dev_test", instanceId: "instance", action: "stop" }));
  expect(enqueue).not.toHaveBeenCalled();
  await waitFor(() => expect(picker().getByRole("button", { name: "Stop safely" })).toBeEnabled());
  fireEvent.click(picker().getByLabelText("Alpha"));
  fireEvent.click(picker().getByRole("button", { name: "Stop safely" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ deviceId: "dev_test", instanceId: "instance", action: "stop" }));
  expect(enqueue).not.toHaveBeenCalled();
  expect(picker().getByLabelText("Alpha")).toBeChecked();
});

it("disables start while offline, awaiting acknowledgement, or stopping", () => {
  const offline = renderPicker(connected([]));
  expect(picker().getByRole("button", { name: "Start worker" })).toBeDisabled();
  expect(screen.queryByRole("img", { name: "iTrader" })).not.toBeInTheDocument();
  expect(document.querySelector("[data-stock-worker-dock]")).toHaveAttribute("hidden");
  offline.unmount();

  const waiting = renderPicker(connected([device({ pendingCommand: { id: "cmd", instanceId: "instance", action: "start" } })]));
  expect(picker().getByRole("button", { name: "Waiting for app…" })).toBeDisabled();
  expect(picker().getByText("Start is awaiting acknowledgement from the app.")).toBeInTheDocument();
  waiting.unmount();

  renderPicker(connected([device({ state: "stopping" })]));
  expect(picker().getByRole("button", { name: "Stopping…" })).toBeDisabled();
});
