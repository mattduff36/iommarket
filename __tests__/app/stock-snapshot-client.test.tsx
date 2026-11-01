// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StockReviewSnapshot } from "@/app/(admin)/admin/stock-reviews/snapshot-loader";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), dashboard: vi.fn(), command: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-actions", () => ({ getWorkerDashboard: mocks.dashboard, commandWorker: mocks.command }));
vi.mock("@/app/(admin)/admin/stock-reviews/worker-pairing", () => ({ StockWorkerPairing: () => null }));
vi.mock("@/actions/admin/stock-result-history", () => ({ changeStockResultHistory: vi.fn() }));
vi.mock("@/actions/admin/dealer-stock-sync", () => ({ enqueueDealerStockScrape: vi.fn(), approveDealerStockReport: vi.fn(), rejectDealerStockReport: vi.fn() }));
vi.mock("@/actions/admin/dealer-stock-review-edit", () => ({ loadStockReviewVehicle: vi.fn(), saveStockReviewVehicle: vi.fn() }));
import { StockReviewsClient } from "@/app/(admin)/admin/stock-reviews/stock-reviews-client";
import { isStockReviewSnapshot } from "@/app/(admin)/admin/stock-reviews/snapshot-validation";
function snapshot(): StockReviewSnapshot {
  const now = Date.now();
  return {
    outstanding: [{ id: "report", scrapeRunId: "scan", fingerprint: "fp", status: "PENDING_REVIEW", inventoryCount: 2, failureReason: null, createdAt: new Date(now).toISOString(), plan: { actions: [] }, binding: { dealer: { id: "dealer", name: "Island Motors" } } }],
    recentReports: [], jobs: [], profiles: [{ id: "dealer", name: "Island Motors", tier: "PRO", isAdminPreview: false, user: { disabledAt: null } }],
    dashboard: { ok: true, devices: [{ deviceId: "dev_test", deviceName: "Server", environment: "production", instanceId: "instance", state: "connected", online: true, lastSeenAt: new Date(now).toISOString(), activity: [], pendingCommand: null }] },
    historyEntries: [{ id: "report", kind: "report", state: "active", manageable: true }], desktopEnabled: false, now,
  };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); };
describe("stock page retained snapshot", () => {
  it("retains results and selection on connection failure, then updates without navigation", async () => {
    const initial = snapshot(); mocks.fetch.mockRejectedValueOnce(new TypeError("network error"));
    render(<StockReviewsClient initial={initial} query={{}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Island Motors" }));
    await tick();
    expect(screen.getByText(/Updates paused. Showing/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Island Motors" })).toBeChecked();
    expect(screen.getByText(/2 vehicles/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Start worker" })) expect(button).toBeDisabled();
    const recovered = snapshot(); recovered.outstanding[0].inventoryCount = 3;
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => recovered });
    await tick();
    expect(screen.queryByText(/Updates paused. Showing/)).not.toBeInTheDocument();
    expect(screen.getByText(/3 vehicles/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Island Motors" })).toBeChecked();
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.dashboard).not.toHaveBeenCalled(); expect(mocks.command).not.toHaveBeenCalled();
  });
  it("rejects malformed action and evidence data before replacing the saved results", async () => {
    const initial = snapshot(); const broken = snapshot(); broken.outstanding[0].plan = { actions: [null] };
    expect(isStockReviewSnapshot(initial)).toBe(true); expect(isStockReviewSnapshot(broken)).toBe(false);
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => broken });
    render(<StockReviewsClient initial={initial} query={{}} />); await tick();
    expect(screen.getByText(/2 vehicles/)).toBeInTheDocument(); expect(screen.getByText(/Updates paused. Showing/)).toBeInTheDocument();
    broken.outstanding[0].plan = { actions: [{ kind: "unchanged", sourceIdentityKey: "car", listingId: null, review: { flags: null } }] };
    expect(isStockReviewSnapshot(broken)).toBe(false);
    const review = { displayTitle: "Car", flags: [], safePhotoUrls: [], provenance: [], sourceUrl: null, capturedAt: "now", categorySlug: "car", pricePence: 100, mileage: 1, year: 2020, availability: "available", coverageWarning: null, capacityWarning: null };
    for (const field of ["fuel", "transmission"]) {
      broken.outstanding[0].plan = { actions: [{ kind: "unchanged", sourceIdentityKey: "car", listingId: null, review: { ...review, [field]: {} } }] };
      expect(isStockReviewSnapshot(broken)).toBe(false);
    }
  });
});
