// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StockWorkerDashboard } from "@/app/(admin)/admin/stock-reviews/worker-dashboard";
import { StockDealerPicker } from "@/app/(admin)/admin/stock-reviews/dealer-picker";
import type { WorkerDashboardDevice } from "@/lib/dealer-stock-sync/worker-control";

const mocks = vi.hoisted(() => ({
  state: vi.fn(), invitation: vi.fn(), command: vi.fn(), launch: vi.fn(), enqueue: vi.fn(), push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/stock-reviews/oracle-pairing-actions", () => ({ getOraclePairingState: mocks.state, requestOraclePairing: mocks.invitation }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ commandWorker: mocks.command, getWorkerDashboard: vi.fn(async () => ({ ok: true, devices: [] })) }));
vi.mock("@/app/(admin)/admin/stock-reviews/launch-actions", () => ({ launchStockApp: mocks.launch }));
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: mocks.enqueue }));
const dealers = [{ id: "dealer", name: "Mike’s Motors" }];
function device(id: string, scopedVm = false): WorkerDashboardDevice {
  return { deviceId: id, instanceId: id, deviceName: id, environment: "preview", state: "connected", online: true,
    activity: [], pendingCommand: null, scopedVm, lastSeenAt: new Date().toISOString() };
}
function show(devices: WorkerDashboardDevice[]) {
  return render(<StockWorkerDashboard oraclePilot oracleEnvironment="preview" managedSnapshot initial={{ ok: true, devices }} initialNow={Date.now()}
    jobs={[]} readyCount={0} dealers={dealers} header={badge => <header>{badge}</header>}>
    <StockDealerPicker dealers={dealers} retainOnDisconnect />
  </StockWorkerDashboard>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.mockResolvedValue({ status: "available" });
  mocks.invitation.mockResolvedValue({ code: "ABCDEFGH" });
  mocks.enqueue.mockResolvedValue({ data: { jobId: "queuedjob" } });
  mocks.command.mockResolvedValue({ ok: true });
});
afterEach(cleanup);
it("requires an explicit Oracle pairing and blocks scan and Windows launch for an unpaired admin", async () => {
  show([device("windows")]);
  const link = await screen.findByRole("button", { name: "Link Oracle VM now" });
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.queryByRole("button", { name: /Windows/ })).toBeNull();
  expect(mocks.invitation).not.toHaveBeenCalled();
  fireEvent.click(link);
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/admin/stock-reviews?pair=oracle&code=ABCDEFGH"));
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
});
it("shows the connected badge once in the footer and scopes the start to Oracle when Windows is also connected", async () => {
  show([device("windows"), device("oracle", true)]);
  expect(screen.getByText("Oracle Connected").closest("footer")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Worker connection" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Windows/ })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getAllByRole("button", { name: "Scan 1 dealer" })[0]);
  await waitFor(() => expect(mocks.command).toHaveBeenCalledWith({ deviceId: "oracle", instanceId: "oracle", action: "start", jobIds: ["queuedjob"] }));
});
it("offers Open Windows Stock Update only when Oracle is unavailable", async () => {
  mocks.state.mockResolvedValue({ status: "offline" });
  mocks.launch.mockResolvedValue({ ok: false, error: "unavailable" });
  show([]);
  const open = await screen.findByRole("button", { name: "Open Windows Stock Update" });
  expect(screen.queryByRole("button", { name: "Link Oracle VM now" })).toBeNull();
  fireEvent.click(open);
  await waitFor(() => expect(mocks.launch).toHaveBeenCalledWith({ mode: "open", jobIds: [] }));
});
