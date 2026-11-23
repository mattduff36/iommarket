// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { refresh, dashboard, command } = vi.hoisted(() => ({ refresh: vi.fn(), dashboard: vi.fn(), command: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ getWorkerDashboard: dashboard, commandWorker: command }));
vi.mock("@/app/(admin)/admin/stock-reviews/launch-actions", () => ({ launchStockApp: vi.fn() }));
import { StockWorkerDashboard } from "@/app/(admin)/admin/stock-reviews/worker-dashboard";
import { StockDealerPicker } from "@/app/(admin)/admin/stock-reviews/dealer-picker";
import progressStyles from "@/app/(admin)/admin/stock-reviews/worker-progress.module.css";
import type { WorkerDashboardDevice, WorkerDashboardResult } from "@/lib/dealer-stock-sync/worker-control";
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: vi.fn() }));
const connected = () => ({ ok: true as const, devices: [{ deviceId: "dev_test", deviceName: "Test computer", environment: "preview" as const, instanceId: "instance", state: "connected" as const, online: true, lastSeenAt: new Date().toISOString(), activity: [], pendingCommand: null }] });
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); dashboard.mockResolvedValue(connected()); command.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); }
describe("Stock Reviews live worker", () => {
 it("shows newest activity first without mutating source order or the latest-event status", () => {
  const activity: WorkerDashboardDevice["activity"] = [
   { sequence: 1, code: "waiting", at: "2026-11-08T20:00:00Z", text: "First event" },
   { sequence: 2, code: "waiting", at: "2026-11-08T20:01:00Z", text: "Second event" },
  ];
  const initial = { ...connected(), devices: connected().devices.map(device => ({ ...device, state: "waiting" as const, activity })) };
  const ui = (events: typeof activity) => <StockWorkerDashboard initial={{ ...initial, devices: initial.devices.map(device => ({ ...device, activity: events })) }} initialNow={Date.now()} managedSnapshot jobs={[]} readyCount={0} />;
  const view = render(ui(activity));
  fireEvent.click(screen.getByRole("button", { name: "Show activity" }));
  const activityList = () => screen.getByText("Recent worker activity").parentElement!.querySelector("ol")!;
  expect(within(activityList()).getAllByRole("listitem").map(row => row.textContent)).toEqual([expect.stringContaining("Second event"), expect.stringContaining("First event")]);
  expect(activity.map(event => event.sequence)).toEqual([1, 2]);
  const next: typeof activity = [...activity, { sequence: 3, code: "waiting", at: "2026-11-08T20:02:00Z", text: "Newest arrival" }];
  view.rerender(ui(next));
  expect(within(activityList()).getAllByRole("listitem")[0]).toHaveTextContent("Newest arrival");
  expect(next.map(event => event.sequence)).toEqual([1, 2, 3]);
  expect(screen.getByRole("contentinfo", { name: "Stock Updater" }).querySelector('p[title="Newest arrival"]')).toHaveTextContent("Newest arrival");
 });
 it.each(["running", "waiting", "stopping"] as const)("locks the whole page for %s while retaining the footer and live updates", async state => {
  const initial = { ...connected(), devices: connected().devices.map(device => ({ ...device, state })) };
  const navigation = document.createElement("nav");
  navigation.innerHTML = '<button>Global navigation</button>';
  const navigate = vi.fn();
  navigation.addEventListener("click", navigate);
  document.body.append(navigation);
  const ui = (text: string) => <StockWorkerDashboard initial={initial} initialNow={Date.now()} jobs={[]} readyCount={0}><p>{text}</p></StockWorkerDashboard>;
  const view = render(ui("Live result one"));
  expect(navigation).toHaveAttribute("inert");
  expect(document.querySelector("[data-stock-worker-content]")).toHaveAttribute("inert");
  fireEvent.click(screen.getByText("Global navigation"));
  expect(navigate).not.toHaveBeenCalled();
  const dock = screen.getByRole("contentinfo", { name: "Stock Updater" });
  expect(dock.closest("[inert]")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show activity" }));
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
  expect(screen.getByRole("contentinfo", { name: "Stock Updater" })).toBeVisible();
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeInTheDocument();
  view.rerender(<StockWorkerDashboard initial={{ ok: true, devices: [] }} managedSnapshot jobs={[{ ...job, status: "SUCCEEDED" }]} readyCount={0} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(document.querySelector("[data-stock-worker-backdrop]")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Stock Updater run finished" })).toBeInTheDocument();
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
  const footer = screen.getByRole("contentinfo", { name: "Stock Updater" });
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
 it("keeps the queue mounted through worker shutdown, then focuses Done and links each saved outcome", () => {
  const initial = connected();
  const jobs = [
    { id: "a", dealerName: "Dealer A", kind: "SCRAPE", status: "LEASED", startedAt: null },
    { id: "b", dealerName: "Dealer B", kind: "SCRAPE", status: "QUEUED", startedAt: null },
  ];
  const outcomes = jobs.map((job, index) => ({ ...job, status: index ? "FAILED" : "SUCCEEDED", resultHref: index ? "?history=active&job=b" : "?history=archived&report=a" }));
  const running = { ...initial, devices: initial.devices.map(device => ({ ...device, state: "running" as const })) };
  const ui = (snapshot: WorkerDashboardResult, rows: typeof jobs) => <StockWorkerDashboard initial={snapshot} initialNow={Date.now()} managedSnapshot jobs={rows} readyCount={0} />;
  const view = render(ui(running, jobs));
  const surface = screen.getByRole("region", { name: "Live dealer queue" });
  view.rerender(ui(running, outcomes));
  view.rerender(ui(initial, outcomes));
  expect(screen.getByRole("dialog")).toBe(surface);
  expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "Open Dealer A result" })).toHaveAttribute("href", outcomes[0].resultHref);
  expect(screen.getByRole("link", { name: "Open Dealer B result" })).toHaveAttribute("href", outcomes[1].resultHref);
  fireEvent.keyDown(screen.getByRole("button", { name: "Done" }), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
 });
 it("announces a completed scan once and keeps its finished state visible", async () => {
  const job = { id: "scan", dealerName: "Island Motors", kind: "SCRAPE", status: "LEASED", startedAt: new Date().toISOString() };
  const ui = (status: string) => <StockWorkerDashboard dealers={[{ id: "dealer", name: "Island Motors" }]} initial={connected()} jobs={[{...job, status, reportStatus: status === "SUCCEEDED" ? "PENDING_REVIEW" : null}]} readyCount={1} />;
  const view = render(ui("LEASED"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.rerender(ui("SUCCEEDED"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(screen.getByRole("dialog", { name: "Stock Updater run finished" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  view.rerender(ui("SUCCEEDED"));
  await tick();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("contentinfo", { name: "Stock Updater" })).toHaveTextContent("Success");
 });
 it.each([0, 1, 3])("keeps the footer and modal summary consistent for %i review listings", async reviewListingCount => {
  const base = { id: "scan", dealerName: "Island Motors", kind: "SCRAPE", status: "LEASED", startedAt: null, reportStatus: "PENDING_REVIEW", reviewListingCount };
  const initial = connected();
  const ui = (status: string) => <StockWorkerDashboard initial={initial} initialNow={Date.now()} managedSnapshot jobs={[{ ...base, status }]} readyCount={0} />;
  const view = render(ui("LEASED"));
  const footer = screen.getByRole("contentinfo", { name: "Stock Updater" });
  view.rerender(ui("SUCCEEDED"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  const suffix = reviewListingCount === 0 ? "no new changes" : `${reviewListingCount} ${reviewListingCount === 1 ? "listing" : "listings"} for review`;
  expect(within(footer).getByText(`Island Motors: Success - ${suffix}`)).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByRole("listitem")).toHaveTextContent(`Success - ${suffix}`);
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
  expect(screen.getByRole("dialog", { name: "Stock Updater run finished" })).toBeInTheDocument();
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
  expect(screen.queryByRole("button", { name: "Start worker" })).toBeNull();
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
  expect(document.querySelector("[data-stock-worker-dock]")).not.toHaveAttribute("hidden");
  expect(screen.getAllByText("Start the Stock Update worker app").length).toBeGreaterThan(0);
  await tick();
  expect(screen.getByRole("contentinfo")).toHaveTextContent("Windows Connected");
  expect(command).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", {name:"Start worker"})).toBeNull();
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

 it("keeps the idle footer compact with an accessible activity disclosure", () => {
  render(<StockWorkerDashboard initial={connected()} jobs={[]} readyCount={0} />);
  const dock = document.querySelector("[data-stock-worker-dock]");
  expect(dock).toHaveAttribute("data-compact", "true");
  expect(screen.queryByRole("button", { name: "Start worker" })).toBeNull();
  expect(dock).toHaveTextContent("Windows Connected");
  fireEvent.click(screen.getByRole("button", { name: "Show activity" }));
  expect(dock).toHaveAttribute("data-compact", "false");
  expect(screen.getByText("Recent worker activity")).toBeVisible();
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Hide activity" }));
  expect(dock).toHaveAttribute("data-compact", "true");
 });
 it.each(["running", "waiting", "stopping"])("keeps %s worker state expanded", state => {
  const initial = connected();
  render(<StockWorkerDashboard initial={{...initial, devices: initial.devices.map(device => ({...device, state: state as typeof device.state}))}} jobs={[]} readyCount={0} />);
  expect(document.querySelector("[data-stock-worker-dock]")).toHaveAttribute("data-compact", "false");
 });
 it.each(["connected", "stopped", "disconnected", "error", null] as const)(
  "collapses a finished run with runtime state %s and reserves no space below the dock", state => {
   const initial = connected();
   const ui = (runtime: WorkerDashboardDevice["state"], jobStatus: string) => <StockWorkerDashboard
    initial={{ ...initial, devices: initial.devices.map(device => ({ ...device, state: runtime, online: runtime !== "disconnected" && runtime !== null })) }}
    managedSnapshot jobs={[{ id: "job", dealerName: "Van Mossel Jacksons", kind: "APPLY", status: jobStatus, startedAt: null }]} readyCount={0} />;
   const view = render(ui("running", "LEASED"));
   const dock = view.container.querySelector<HTMLElement>("footer")!;
   expect(within(dock).getByRole("progressbar")).toBeInTheDocument();
   view.rerender(ui(state, "SUCCEEDED"));
   expect(dock).toHaveAttribute("data-compact", "true");
   expect(within(dock).queryByRole("progressbar")).toBeNull();
   expect(dock.parentElement?.style.height).toBe(`${window.innerHeight}px`);
  });
