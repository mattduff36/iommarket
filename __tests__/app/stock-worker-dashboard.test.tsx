// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { refresh, dashboard, command } = vi.hoisted(() => ({ refresh: vi.fn(), dashboard: vi.fn(), command: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ getWorkerDashboard: dashboard, commandWorker: command }));
import { StockWorkerDashboard } from "@/app/(admin)/admin/stock-reviews/worker-dashboard";
import { StockDealerPicker } from "@/app/(admin)/admin/stock-reviews/dealer-picker";
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: vi.fn() }));
const connected = () => ({ ok: true as const, devices: [{ deviceId: "dev_test", deviceName: "Test computer", environment: "preview" as const, instanceId: "instance", state: "connected" as const, online: true, lastSeenAt: new Date().toISOString(), activity: [], pendingCommand: null }] });
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); dashboard.mockResolvedValue(connected()); command.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); }
describe("Stock Reviews live worker", () => {
 it("refreshes server results while preserving dealer selection and shows completion", async () => {
  const ui = (readyCount: number) => <StockWorkerDashboard initial={connected()} jobs={[]} readyCount={readyCount}><StockDealerPicker dealers={[{ id: "dealer", name: "Island Motors" }]} /></StockWorkerDashboard>;
  const view = render(ui(0));
  fireEvent.click(screen.getByRole("checkbox", { name: "Island Motors" }));
  await tick();
  expect(refresh).toHaveBeenCalled();
  view.rerender(ui(1));
  expect(screen.getByRole("checkbox", { name: "Island Motors" })).toBeChecked();
  expect(screen.getAllByText("Ready for review").length).toBeGreaterThan(0);
 });
 it("defers refresh during edits and dialogs, then resumes", async () => {
  render(<StockWorkerDashboard initial={connected()} jobs={[]} readyCount={0} />);
  const editor = document.createElement("div"); editor.dataset.stockReviewEditing = "true"; document.body.append(editor);
  await tick(); expect(refresh).not.toHaveBeenCalled(); editor.remove();
  const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.append(dialog);
  await tick(); expect(refresh).not.toHaveBeenCalled(); dialog.remove();
  await tick(); expect(refresh).toHaveBeenCalled();
 });
 it("disables commands offline and sends only the selected instance when online", async () => {
  const view = render(<StockWorkerDashboard initial={{ok:true,devices:[]}} jobs={[]} readyCount={0} />);
  expect(screen.getByRole("button", {name:"Start worker"})).toBeDisabled();
  expect(screen.getAllByText("Start the Stock Update worker app").length).toBeGreaterThan(0);
  await tick();
  await act(async () => { fireEvent.click(screen.getByRole("button", {name:"Start worker"})); });
  expect(command).toHaveBeenCalledWith({deviceId:"dev_test",instanceId:"instance",action:"start"});
  view.unmount();
 });
 it("treats failed status retrieval as unavailable and disables start", async () => {
  dashboard.mockRejectedValue(new Error("offline"));
  render(<StockWorkerDashboard initial={connected()} jobs={[]} readyCount={0} />);
  await tick();
  expect(screen.getByRole("button",{name:"Start worker"})).toBeDisabled();
  expect(screen.getAllByText("Connection status unavailable").length).toBeGreaterThan(0);
 });
});
