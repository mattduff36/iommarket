/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";
const mocks = vi.hoisted(() => ({ list: vi.fn(), details: vi.fn(), wait: vi.fn(async () => {}) }));
vi.mock("@/scripts/dealer-stock-sync/connectors/detect", () => ({ getConnector: () => ({ fetchList: mocks.list, fetchDetails: mocks.details }) }));
vi.mock("@/scripts/dealer-stock-sync/rate-limit", () => ({ sleep: mocks.wait }));
import { runDealerPipeline } from "@/scripts/dealer-stock-sync/pipeline";
describe("rendered list retries", () => {
  it("retries empty rendered pages twice then continues to the next source", async () => {
    const dealer = getDealer("mikes-motors");
    mocks.list.mockImplementation(async ({ source }) => ({ dealerKey: dealer.key, sourceKey: source.key,
      platform: source.connectorKey, status: source.key === "used-cars" ? "failed" : "ok",
      error: source.key === "used-cars" ? "No structured public stock records found" : null,
      startUrl: source.startUrl, pagesFetched: 1, advertisedCount: null, rawCount: 0, vehicles: [],
      detailMissing: 0, paginationUncertain: false }));
    const result = await runDealerPipeline(dealer, { delayMs: 0 });
    expect(mocks.list.mock.calls.filter(([context]) => context.source.key === "used-cars")).toHaveLength(3);
    expect(result.sourceResults.map(s => s.status)).toEqual(["failed", "ok", "ok"]);
    expect(mocks.list).toHaveBeenCalledTimes(5);
  });
});
