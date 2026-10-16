import { describe, expect, it, vi } from "vitest";
import { fetchWebsiteList } from "@/scripts/dealer-stock-sync/connectors/website-source";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";
import { paginateVehicleSearch } from "@/scripts/dealer-stock-sync/connectors/netdirector/pagination";
import { scrapeFailureReason } from "@/lib/dealer-stock-sync/completeness";
import { clickDealerConnector } from "@/scripts/dealer-stock-sync/connectors/click-dealer";
import * as browse from "@/scripts/dealer-stock-sync/browse";
import * as rateLimit from "@/scripts/dealer-stock-sync/rate-limit";
import { vehicle } from "./fixtures";

describe("stock source completeness evidence", () => {
  it("paces Click Dealer detail navigation and preserves a failed detail as incomplete", async () => {
    const dealer = getDealer("mikes-motors");
    const source = dealer.sources[0]!;
    const events: string[] = [];
    const pause = vi.spyOn(rateLimit, "sleep").mockImplementation(async () => { events.push("pause"); });
    const page = {
      goto: vi.fn(async () => { events.push("navigate"); return { ok: () => false }; }),
      content: vi.fn(async () => "<main>Vehicle</main>"),
    };
    const browser = vi.spyOn(browse, "withPublicPage").mockImplementation(async (_url, run) => run(page as never, [], [], []));
    try {
      const frozen = vehicle({ dealerKey: "mikes-motors", sourceKey: "used-cars" });
      const result = await clickDealerConnector.fetchDetails({ dealer, source, delayMs: 800 }, [frozen]);
      expect(events).toEqual(["pause", "navigate"]);
      expect(pause).toHaveBeenCalledWith(800);
      expect(result).toEqual({ vehicles: [frozen], detailMissing: 1 });
    } finally {
      browser.mockRestore();
      pause.mockRestore();
    }
  });

  it("rejects a truncated Click Dealer result against its advertised vehicle total", async () => {
    const dealer = getDealer("mikes-motors");
    const source = { ...dealer.sources[0]!, headed: false, preferBrowser: false };
    const stock = '<script type="application/ld+json">' + JSON.stringify({
      "@type": "Car", name: "Ford Focus", manufacturer: "Ford", model: "Focus", vehicleModelDate: "2020",
      mileageFromOdometer: { value: 12000 }, offers: { price: 9995 }, url: "/used-ford-focus-1234567",
    }) + '</script>';
    const read = (total: number) => fetchWebsiteList({ dealer, source, fetchImpl: vi.fn(async () => new Response(
      stock + `<p>Showing <strong>1 - 1</strong> vehicles of <strong>${total}</strong></p>`,
    )) });
    const partial = await read(22);
    expect(partial).toMatchObject({ advertisedCount: 22, paginationUncertain: true });
    expect(partial.vehicles).toHaveLength(1);
    expect(scrapeFailureReason([{ status: partial.status, vehicleCount: partial.vehicles.length,
      advertisedCount: partial.advertisedCount, pagesFetched: partial.pagesFetched, detailMissing: 0,
      paginationUncertain: partial.paginationUncertain ?? true }])).toBe("pagination-uncertain");
    expect(await read(1)).toMatchObject({ advertisedCount: 1, paginationUncertain: false });
  });

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
