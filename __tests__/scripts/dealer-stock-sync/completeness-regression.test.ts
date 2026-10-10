import { describe, expect, it, vi } from "vitest";
import { fetchWebsiteList } from "@/scripts/dealer-stock-sync/connectors/website-source";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";
import { paginateVehicleSearch } from "@/scripts/dealer-stock-sync/connectors/netdirector/pagination";

describe("stock source completeness evidence", () => {
  it("recognises an explicitly empty Click Dealer section but not a blank response", async () => {
    const dealer = getDealer("mikes-motors");
    const source = { ...dealer.sources[2]!, headed: false, preferBrowser: false };
    const read = (html: string) => fetchWebsiteList({ dealer, source, fetchImpl: vi.fn(async () => new Response(html)) });
    expect(await read("<main>We do not have any matching vehicles in stock at present.</main>"))
      .toMatchObject({ status: "ok", advertisedCount: 0, vehicles: [], paginationUncertain: false });
    expect(await read("<main></main>")).toMatchObject({ status: "failed" });
    expect(await read('<script>"We do not have any matching vehicles in stock at present."</script>'))
      .toMatchObject({ status: "failed" });
  });

  it("does not infer exhausted API pagination when metadata is missing", async () => {
    const result = await paginateVehicleSearch({ context: { apiUrl: "https://dealer.example", uuid: "test" },
      fetchImpl: vi.fn(async () => Response.json([{ id: "1", make: "Ford", model: "Focus" }])) });
    expect(result.paginationUncertain).toBe(true);
  });
});
