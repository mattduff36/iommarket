// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const { enqueue, refresh, dashboard, command } = vi.hoisted(() => ({ enqueue: vi.fn(), refresh: vi.fn(), dashboard: vi.fn(), command: vi.fn() }));
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: enqueue }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ getWorkerDashboard: dashboard, commandWorker: command }));
import { StockDealerPicker } from "@/app/(admin)/admin/stock-reviews/dealer-picker";
vi.mock("@/app/(admin)/admin/stock-reviews/launch-actions", () => ({ launchStockApp: vi.fn() }));
import { StockWorkerDashboard } from "@/app/(admin)/admin/stock-reviews/worker-dashboard";

import { useStockWorkerCommands } from "@/app/(admin)/admin/stock-reviews/worker-context";

const dealers = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];
const device = (overrides: Record<string, unknown> = {}) => ({
  deviceId: "dev_test", deviceName: "Test computer", environment: "preview" as const, instanceId: "instance",
  state: "connected" as const, online: true, lastSeenAt: new Date().toISOString(), activity: [], pendingCommand: null, ...overrides,
});
const connected = (devices = [device()]) => ({ ok: true as const, devices });

function renderPicker(initial = connected()) {
  dashboard.mockResolvedValue(initial);
  return render(<StockWorkerDashboard dealers={dealers} initial={initial} jobs={[]} readyCount={0}><StockDealerPicker dealers={dealers} /></StockWorkerDashboard>);
}
function picker() {
  const section = screen.getByRole("heading", { name: "Choose dealers to scrape" }).closest("section");
  if (!section) throw new Error("picker missing");
  return within(section);
}

beforeEach(() => { vi.clearAllMocks(); enqueue.mockResolvedValue({ data: { status: "queued", jobId: "queued-job" } }); command.mockResolvedValue({ ok: true }); });

it("queues only selected dealers and starts once after those queues succeed", async () => {
  const order: string[] = [];
  enqueue.mockImplementation(async ({ dealerId }: { dealerId: string }) => { order.push(`queue:${dealerId}`); return { data: { status: "queued", jobId: "queued-job" } }; });
  command.mockImplementation(async (input: { action: string }) => { order.push(input.action); return { ok: true }; });
  renderPicker();
  expect(picker().getByRole("button", { name: "Start worker" })).toBeDisabled();
  fireEvent.click(picker().getByLabelText("Beta"));
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(order).toEqual(["queue:b", "start"]));
  expect(command).toHaveBeenCalledExactlyOnceWith({ deviceId: "dev_test", instanceId: "instance", action: "start" });
  await waitFor(() => expect(picker().getByLabelText("Beta")).not.toBeChecked());
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

  enqueue.mockImplementation(async ({ dealerId }: { dealerId: string }) => dealerId === "a" ? { error: "Website source needs setup" } : { data: { status: "queued", jobId: "queued-job" } });
  fireEvent.click(picker().getByLabelText("Beta"));
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(picker().getByRole("status")).toHaveTextContent("Alpha: Website source needs setup");
  expect(picker().getByLabelText("Alpha")).toBeChecked();
  expect(picker().getByLabelText("Beta")).not.toBeChecked();
});

it("shares one start across the picker and sticky control", async () => {
  enqueue.mockImplementation(() => {
    const button = document.querySelector("[data-stock-worker-dock] button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing dock button");
    fireEvent.click(button);
    return Promise.resolve({ data: { status: "queued", jobId: "queued-job" } });
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

it("hides controls offline and disables start while awaiting acknowledgement or stopping", () => {
  const offline = renderPicker(connected([]));
  expect(screen.getByRole("heading", { name: "Choose dealers to scrape" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start worker" })).toBeDisabled();
  expect(screen.queryByRole("img", { name: "iTrader" })).not.toBeInTheDocument();
  expect(document.querySelector("[data-stock-worker-dock]")).toHaveAttribute("hidden");
  offline.unmount();

  const waiting = renderPicker(connected([device({ pendingCommand: { id: "cmd", instanceId: "instance", action: "start" } })]));
  expect(picker().getByRole("button", { name: "Waiting for app…" })).toBeDisabled();
  waiting.unmount();

  renderPicker(connected([device({ state: "stopping" })]));
  expect(picker().getByRole("button", { name: "Stopping…" })).toBeDisabled();
});


it("keeps both start controls in sync and starts selected dealers from the dock", async () => {
  renderPicker();
  const starts = screen.getAllByRole("button", { name: "Start worker" });
  starts.forEach(button => expect(button).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  starts.forEach(button => expect(button).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  starts.forEach(button => expect(button).toBeDisabled());
  fireEvent.click(screen.getByLabelText("Beta"));
  fireEvent.click(starts[1]);
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(enqueue).toHaveBeenCalledExactlyOnceWith({ dealerId: "b" });
  await waitFor(() => starts.forEach(button => expect(button).toBeDisabled()));
});


it("does not start a replacement app instance after queueing", async () => {
  const snapshot = vi.fn();
  const hook = renderHook(({instanceId}) => useStockWorkerCommands(device({instanceId}), true, snapshot), {initialProps:{instanceId:"first"}});
  const originalTarget = hook.result.current.target;
  hook.rerender({instanceId:"replacement"});
  let outcome;
  await act(async () => { outcome = await hook.result.current.dispatch("start", originalTarget); });
  expect(outcome).toBe("skipped");
  expect(command).not.toHaveBeenCalled();
  expect(hook.result.current.message).toMatch(/no longer connected/);
});

it("starts an already approved queued job without selecting or rescraping a dealer", async () => {
  const initial = connected([device({ state: "stopped" })]);
  dashboard.mockResolvedValue(initial);
  render(<StockWorkerDashboard dealers={dealers} initial={initial}
    jobs={[{ id: "approved", dealerName: "Beta", kind: "APPLY", status: "QUEUED", startedAt: null, reportStatus: "APPROVED" }]}
    readyCount={0}><StockDealerPicker dealers={dealers} /></StockWorkerDashboard>);
  expect(picker().getByRole("button", { name: "Start worker" })).toBeEnabled();
  fireEvent.click(picker().getByRole("button", { name: "Start worker" }));
  await waitFor(() => expect(command).toHaveBeenCalledExactlyOnceWith({ deviceId: "dev_test", instanceId: "instance", action: "start" }));
  expect(enqueue).not.toHaveBeenCalled();
});

it("does not enable queued work when the app is awaiting acknowledgement", () => {
  const initial = connected([device({ pendingCommand: { action: "start" } })]);
  dashboard.mockResolvedValue(initial);
  render(<StockWorkerDashboard dealers={dealers} initial={initial}
    jobs={[{ id: "approved", dealerName: "Beta", kind: "APPLY", status: "QUEUED", startedAt: null }]}
    readyCount={0}><StockDealerPicker dealers={dealers} /></StockWorkerDashboard>);
  screen.getAllByRole("button", { name: "Waiting for app…" }).forEach(button => expect(button).toBeDisabled());
  expect(command).not.toHaveBeenCalled();
});
