// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), recover: vi.fn(), launch: vi.fn(), navigate: vi.fn(), dispatch: vi.fn(), dashboard: vi.fn(), command: vi.fn(), scrape: vi.fn(), syncAll: vi.fn() }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ getWorkerDashboard: mocks.dashboard, commandWorker: mocks.command }));
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: mocks.scrape, enqueueEnabledDealerStockScrapes: mocks.syncAll, saveDealerStockBinding: vi.fn(), setDealerStockBindingEnabled: vi.fn() }));
vi.mock("@/actions/admin/dealer-stock-selection", () => ({ reviewDealerStockSelection: mocks.submit }));
vi.mock("@/actions/admin/dealer-stock-recovery", () => ({ recoverDealerStockReport: mocks.recover }));
vi.mock("@/app/(admin)/admin/stock-reviews/launch-actions", () => ({ launchStockApp: mocks.launch }));
vi.mock("@/app/(admin)/admin/stock-reviews/app-launch-navigation", () => ({ openStockUpdateProtocol: mocks.navigate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { StockReviewSelectionControls } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-selection-controls";
import { StockApplyRecoveryControls } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/recovery-controls";
import { useStockAppLifecycle } from "@/app/(admin)/admin/stock-reviews/app-lifecycle";
import { StockWorkerControlProvider, type StockWorkerControl } from "@/app/(admin)/admin/stock-reviews/worker-context";
function Harness({ recovery = false, online = false, removal = true }: { recovery?: boolean; online?: boolean; removal?: boolean }) {
  const [indexes, setIndexes] = useState([0]);
  const controls = { online, target: "device:instance", running: false, pending: false, stopping: false, dispatch: mocks.dispatch } as unknown as StockWorkerControl;
  const lifecycle = useStockAppLifecycle(controls);
  const actions = [removal ? { kind: "unpublish", listingId: "listing", sourceIdentityKey: "vehicle", absenceCount: 2, lifecycleRevision: 1 } : { kind: "update", listingId: "listing", sourceIdentityKey: "vehicle", changes: [] }] as PlanAction[];
  return <StockWorkerControlProvider value={{ ...controls, requestRun: lifecycle.requestRun }}>
    {lifecycle.dialog}
    {recovery ? <StockApplyRecoveryControls reportId="report" fingerprint={"a".repeat(64)} recovery={{ attempt: { id: "failed", status: "FAILED" }, activeJob: null, retryable: true, reason: null }} /> :
      <StockReviewSelectionControls reportId="report" fingerprint={"a".repeat(64)} actions={actions} selection={{ indexes, setIndexes }} />}
  </StockWorkerControlProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.submit.mockResolvedValue({ data: { jobId: "apply-job" } });
  mocks.recover.mockResolvedValue({ data: { jobId: "fresh-job" } });
  mocks.launch.mockResolvedValue({ ok: true, url: "protocol-link", launchId: "launch" });
  mocks.dispatch.mockResolvedValue("ok");
  mocks.dashboard.mockResolvedValue({ ok: true, devices: [] });
  mocks.scrape.mockResolvedValue({ data: { jobId: "scrape-job" } });
  mocks.syncAll.mockResolvedValue({ data: { queued: 1, jobIds: ["all-job"] } });
});
it("shows offline removal confirmation before queueing, supports cancellation and then queues once", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Approve selected removals" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Approve selected removals" })).toBeEnabled());
  expect(mocks.launch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Approve selected removals" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start app and continue" }));
  await waitFor(() => expect(mocks.launch).toHaveBeenCalledExactlyOnceWith({ mode: "task", jobIds: ["apply-job"] }));
  expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({ reportId: "report", fingerprint: "a".repeat(64), operation: "remove", actionIndexes: [0] });
});
it("shows offline recovery confirmation before requesting a fresh check", async () => {
  render(<Harness recovery />);
  fireEvent.click(screen.getByRole("button", { name: "Run a fresh check" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(mocks.recover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start app and continue" }));
  await waitFor(() => expect(mocks.launch).toHaveBeenCalledExactlyOnceWith({ mode: "task", jobIds: ["fresh-job"] }));
});
it("queues removal once using the connected worker without offline confirmation", async () => {
  render(<Harness online />);
  fireEvent.click(screen.getByRole("button", { name: "Approve selected removals" }));
  await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith("start", "device:instance"));
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["Approve selected", "Approve all eligible (1)"])("prompts before %s while offline", async name => {
  render(<Harness removal={false} />);
  fireEvent.click(screen.getByRole("button", { name }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start app and continue" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: "approve", actionIndexes: [0] })));
});
it("prompts before retrying approved changes while offline", async () => {
  render(<Harness recovery />);
  fireEvent.click(screen.getByRole("button", { name: "Retry approved changes" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(mocks.recover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start app and continue" }));
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: "retry", expectedJobId: "failed" })));
});

import { StockAppTaskBoundary } from "@/app/(admin)/admin/stock-reviews/app-task-boundary";
import { StockBindingForm } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/binding-form";
import { SyncAllDealerStockButton } from "@/app/(admin)/admin/dealers/sync-all-button";
it.each(["Queue scrape", "Sync all enabled dealers"])("offers the same app confirmation for standalone %s", async name => {
  render(name === "Queue scrape" ? <StockAppTaskBoundary><StockBindingForm dealerId="dealer" registryKey="dw-cars" verified enabled /></StockAppTaskBoundary> : <SyncAllDealerStockButton />);
  await waitFor(() => expect(screen.getByRole("button", { name })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(mocks.scrape).not.toHaveBeenCalled();
  expect(mocks.syncAll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByRole("button", { name })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name }));
  fireEvent.click(await screen.findByRole("button", { name: "Start app and continue" }));
  await waitFor(() => expect(mocks.launch).toHaveBeenCalledExactlyOnceWith({ mode: "task", jobIds: [name === "Queue scrape" ? "scrape-job" : "all-job"] }));
  expect(name === "Queue scrape" ? mocks.scrape : mocks.syncAll).toHaveBeenCalledTimes(1);
});
it("leaves app-dependent standalone actions disabled when connection discovery fails", async () => {
  mocks.dashboard.mockResolvedValue({ ok: false, error: "unavailable" });
  render(<SyncAllDealerStockButton />);
  expect(await screen.findByText(/Stock Update connection unavailable/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sync all enabled dealers" })).toBeDisabled();
  expect(mocks.syncAll).not.toHaveBeenCalled();
});

it("uses an already connected app for a standalone scrape instead of opening another one", async () => {
  mocks.dashboard.mockResolvedValue({ ok: true, devices: [{ deviceId: "device", instanceId: "instance", online: true, lastSeenAt: new Date().toISOString(), state: "connected", pendingCommand: null }] });
  mocks.command.mockResolvedValue({ ok: true });
  render(<StockAppTaskBoundary><StockBindingForm dealerId="dealer" registryKey="dw-cars" verified enabled /></StockAppTaskBoundary>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Queue scrape" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Queue scrape" }));
  await waitFor(() => expect(mocks.command).toHaveBeenCalledExactlyOnceWith({ deviceId: "device", instanceId: "instance", action: "start" }));
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("does not open the app or retry after an uncertain standalone queue result", async () => {
  mocks.syncAll.mockRejectedValue(new Error("network lost"));
  render(<SyncAllDealerStockButton />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Sync all enabled dealers" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Sync all enabled dealers" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start app and continue" }));
  expect(await screen.findByText(/Check the saved task status before trying again/)).toBeInTheDocument();
  expect(mocks.syncAll).toHaveBeenCalledTimes(1);
  expect(mocks.launch).not.toHaveBeenCalled();
});
