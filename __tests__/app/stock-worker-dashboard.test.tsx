// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { refresh, dashboard, command } = vi.hoisted(() => ({ refresh: vi.fn(), dashboard: vi.fn(), command: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ getWorkerDashboard: dashboard, commandWorker: command }));
vi.mock("@/app/(admin)/admin/stock-reviews/launch-actions", () => ({ launchStockApp: vi.fn() }));
import { StockWorkerDashboard } from "@/app/(admin)/admin/stock-reviews/worker-dashboard";
import { StockDealerPicker } from "@/app/(admin)/admin/stock-reviews/dealer-picker";
import progressStyles from "@/app/(admin)/admin/stock-reviews/worker-progress.module.css";
import type { WorkerDashboardResult } from "@/lib/dealer-stock-sync/worker-control";
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: vi.fn() }));
const connected = () => ({ ok: true as const, devices: [{ deviceId: "dev_test", deviceName: "Test computer", environment: "preview" as const, instanceId: "instance", state: "connected" as const, online: true, lastSeenAt: new Date().toISOString(), activity: [], pendingCommand: null }] });
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); dashboard.mockResolvedValue(connected()); command.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); }
describe("Stock Reviews live worker", () => {
 it.each(["running", "waiting", "stopping"] as const)("locks the whole page for %s while retaining the footer and live updates", async state => {
  const initial = { ...connected(), devices: connected().devices.map(device => ({ ...device, state })) };
  const navigation = document.createElement("nav");
  navigation.innerHTML = '<button>Global navigation</button>';
  document.body.append(navigation);
  const ui = (text: string) => <StockWorkerDashboard initial={initial} initialNow={Date.now()} jobs={[]} readyCount={0}><p>{text}</p></StockWorkerDashboard>;
  const view = render(ui("Live result one"));
  expect(navigation).toHaveAttribute("inert");
  expect(document.querySelector("[data-stock-worker-content]")).toHaveAttribute("inert");
  const dock = screen.getByRole("contentinfo", { name: "Stock Update" });
  expect(dock.closest("[inert]")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show worker activity" }));
  expect(screen.getByText("Recent worker activity")).toBeVisible();
  view.rerender(ui("Live result two"));
  expect(screen.getByText("Live result two")).toBeInTheDocument();
  await tick();
  expect(dashboard).toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  view.unmount();
  expect(navigation).not.toHaveAttribute("inert");
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeNull();
  navigation.remove();
 });
 it.each(["stopped", "error", "connected"] as const)("retains a managed lock across connection loss, then releases on explicit %s", async state => {
  const active = { ...connected(), devices: connected().devices.map(device => ({ ...device, state: "running" as const })) };
  const ui = (initial: WorkerDashboardResult, connectionLost: boolean) => <StockWorkerDashboard initial={initial} initialNow={Date.now()} managedSnapshot connectionLost={connectionLost} jobs={[]} readyCount={0} />;
  const view = render(ui(active, false));
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeInTheDocument();
  view.rerender(ui(active, true));
  await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show activity" })).toBeEnabled();
  view.rerender(ui({ ...active, devices: active.devices.map(device => ({ ...device, state, lastSeenAt: new Date().toISOString() })) }, true));
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeNull();
 });
 it("keeps a leased-job dock visible offline and defers completion until both worker and jobs end", async () => {
  const initial = { ...connected(), devices: connected().devices.map(device => ({ ...device, state: "waiting" as const })) };
  const job = { id: "scan", dealerName: "Island Motors", kind: "SCRAPE", status: "LEASED", startedAt: null };
  const view = render(<StockWorkerDashboard initial={initial} managedSnapshot jobs={[job]} readyCount={0} />);
  view.rerender(<StockWorkerDashboard initial={initial} managedSnapshot jobs={[{ ...job, status: "SUCCEEDED" }]} readyCount={0} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeInTheDocument();
  view.rerender(<StockWorkerDashboard initial={{ ok: true, devices: [] }} managedSnapshot jobs={[job]} readyCount={0} />);
  expect(screen.getByRole("contentinfo", { name: "Stock Update" })).toBeVisible();
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeInTheDocument();
  view.rerender(<StockWorkerDashboard initial={{ ok: true, devices: [] }} managedSnapshot jobs={[{ ...job, status: "SUCCEEDED" }]} readyCount={0} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeNull();
  expect(screen.getByRole("dialog", { name: "Stock Update run finished" })).toBeInTheDocument();
 });
 it("hides offline controls while keeping saved reviews and restores controls on connection", async () => {
  const offline = { ok: true as const, devices: connected().devices.map(device => ({ ...device, online: false })) };
  render(<StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={offline} jobs={[]} readyCount={6}>
    <StockDealerPicker dealers={[{ id: "dealer", name: "Island Motors" }]} />
    <p>Saved dealer review</p>
  </StockWorkerDashboard>);
  expect(screen.getByText("Saved dealer review")).toBeInTheDocument();
  expect(screen.getByText("Choose dealers to scrape")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeEnabled();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByText("6 ready for review")).not.toBeInTheDocument();
  await tick();
  expect(screen.getByRole("checkbox", { name: "Island Motors" })).toBeInTheDocument();
  expect(screen.getByText("Saved dealer review")).toBeInTheDocument();
  dashboard.mockResolvedValue(offline);
  await tick();
  expect(screen.getByRole("checkbox")).toBeEnabled();
 });
 it("shows indeterminate progress only while work is active", () => {
  const job = { id: "scan", dealerName: "Island Motors", kind: "SCRAPE", status: "LEASED", startedAt: new Date().toISOString() };
  const view = render(<StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={connected()} jobs={[job]} readyCount={0} />);
  expect(screen.getByRole("progressbar", { name: "Stock update in progress" })).not.toHaveAttribute("aria-valuenow");
  expect(document.querySelector(`.${progressStyles.moving}`)).toBeTruthy();
  const footer = screen.getByRole("contentinfo", { name: "Stock Update" });
  expect(footer).toHaveAttribute("data-stock-worker-dock");
  expect(footer.className).not.toMatch(/fixed|sticky/);
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeInTheDocument();
  expect(document.querySelector("[data-stock-worker-content]")).toHaveAttribute("inert");
  expect(footer.closest("[inert]")).toBeNull();
  view.rerender(<StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={connected()} jobs={[]} readyCount={0} />);
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeNull();
  expect(document.querySelector("[data-stock-worker-content]")).not.toHaveAttribute("inert");
 });
 it("announces a completed scan once and keeps its finished state visible", async () => {
  const job = { id: "scan", dealerName: "Island Motors", kind: "SCRAPE", status: "LEASED", startedAt: new Date().toISOString() };
  const ui = (status: string) => <StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={connected()} jobs={[{...job, status, reportStatus: status === "SUCCEEDED" ? "PENDING_REVIEW" : null}]} readyCount={1} />;
  const view = render(ui("LEASED"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.rerender(ui("SUCCEEDED"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(screen.getByRole("dialog", { name: "Stock Update run finished" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  view.rerender(ui("SUCCEEDED"));
  await tick();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Run complete. Review the results above.")).toBeInTheDocument();
 });
 it("does not announce old history, and defers new failure notices while editing", async () => {
  const old = { id: "old", dealerName: "Old dealer", kind: "APPLY", status: "SUCCEEDED", reportStatus: "APPLIED", startedAt: null };
  const ui = (extra: typeof old[]) => <StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={connected()} jobs={[old,...extra]} readyCount={0} />;
  const view = render(ui([]));
  await tick(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const editor = document.createElement("div"); editor.dataset.stockReviewEditing = "true"; document.body.append(editor);
  view.rerender(ui([{...old,id:"new",status:"FAILED",reportStatus:"APPROVED"}]));
  await tick(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  editor.remove();
  await tick();
  expect(screen.getByRole("dialog", { name: "Stock Update run finished" })).toBeInTheDocument();
 });
 it("shows a pending command until the request resolves and prevents repeat submissions", async () => {
  let finish!: (value: { ok: true }) => void;
  command.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={{...connected(), devices: connected().devices.map(d => ({...d,state:"running" as const}))}} jobs={[]} readyCount={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Stop safely" }));
  expect(screen.getByRole("button", { name: "Sending request…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sending request…" }));
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ ok: true }); });
  expect(screen.getByRole("button", { name: "Start worker" })).toBeDisabled();
 });
 it("accepts updated results while preserving dealer selection without route refresh", async () => {
  const ui = (readyCount: number) => <StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={connected()} jobs={[]} readyCount={readyCount}><StockDealerPicker dealers={[{ id: "dealer", name: "Island Motors" }]} /></StockWorkerDashboard>;
  const view = render(ui(0));
  fireEvent.click(screen.getByRole("checkbox", { name: "Island Motors" }));
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  view.rerender(ui(1));
  expect(screen.getByRole("checkbox", { name: "Island Motors" })).toBeChecked();
  expect(screen.getAllByText("Ready for review").length).toBeGreaterThan(0);
 });
 it("never refreshes the route during background status polling", async () => {
  render(<StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={connected()} jobs={[]} readyCount={0} />);
  const editor = document.createElement("div"); editor.dataset.stockReviewEditing = "true"; document.body.append(editor);
  await tick(); expect(refresh).not.toHaveBeenCalled(); editor.remove();
  const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.append(dialog);
  await tick(); expect(refresh).not.toHaveBeenCalled(); dialog.remove();
  await tick(); expect(refresh).not.toHaveBeenCalled();
 });
 it("keeps start disabled until dealers are selected after reconnect", async () => {
  const view = render(<StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={{ok:true,devices:[]}} jobs={[]} readyCount={0} />);
  expect(screen.queryByRole("button", {name:"Start worker"})).not.toBeInTheDocument();
  expect(screen.queryByRole("img", {name:"iTrader"})).not.toBeInTheDocument();
  expect(document.querySelector("[data-stock-worker-dock]")).toHaveAttribute("hidden");
  expect(screen.getAllByText("Start the Stock Update worker app").length).toBeGreaterThan(0);
  await tick();
  await act(async () => { fireEvent.click(screen.getByRole("button", {name:"Start worker"})); });
  expect(command).not.toHaveBeenCalled();
  expect(screen.getByRole("button", {name:"Start worker"})).toBeDisabled();
  view.unmount();
 });
 it("treats failed status retrieval as unavailable and disables start", async () => {
  dashboard.mockRejectedValue(new Error("offline"));
  render(<StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={connected()} jobs={[]} readyCount={0} />);
  await tick();
  expect(screen.queryByRole("button",{name:"Start worker"})).not.toBeInTheDocument();
  expect(screen.getAllByText("Connection status unavailable").length).toBeGreaterThan(0);
 });
});


it("shows installer and pairing status only while offline, including reconnects", async () => {
  const offline = {ok:true as const,devices:[]};
  render(<StockWorkerDashboard initial={offline} jobs={[]} readyCount={0} offlineContent={<><button>Download worker</button><p>Computer authorised</p></>} />);
  expect(screen.getByRole("button",{name:"Download worker"})).toBeVisible();
  await tick();
  expect(screen.queryByRole("button",{name:"Download worker"})).not.toBeInTheDocument();
  expect(screen.queryByText("Computer authorised")).not.toBeInTheDocument();
  dashboard.mockResolvedValue(offline);
  await tick();
  expect(screen.getByRole("button",{name:"Download worker"})).toBeVisible();
});

 it("collapses an idle dock and lets the logo reopen activity without starting work", () => {
  render(<StockWorkerDashboard initial={connected()} jobs={[]} readyCount={0} />);
  const dock = document.querySelector("[data-stock-worker-dock]");
  expect(dock).toHaveAttribute("data-compact", "true");
  const start = screen.getByRole("button", { name: "Start worker" });
  expect(start).toHaveAttribute("data-icon-only", "true");
  expect(start.querySelector("svg.lucide-play")).toBeTruthy();
  expect(start.textContent).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Show worker activity" }));
  expect(dock).toHaveAttribute("data-compact", "false");
  expect(screen.getByText("Recent worker activity")).toBeVisible();
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Hide activity" }));
  expect(dock).toHaveAttribute("data-compact", "true");
 });
 it.each(["running", "waiting", "stopping", "error"])("keeps %s worker state expanded", state => {
  const initial = connected();
  render(<StockWorkerDashboard initial={{...initial, devices: initial.devices.map(device => ({...device, state: state as typeof device.state}))}} jobs={[]} readyCount={0} />);
  expect(document.querySelector("[data-stock-worker-dock]")).toHaveAttribute("data-compact", "false");
 });
