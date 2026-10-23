/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebsiteConnector } from "@/scripts/dealer-stock-sync/connectors/website-source";
import { emptyVehicle } from "@/scripts/dealer-stock-sync/connectors/contract";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";

afterEach(() => vi.useRealTimers());
describe("detail failure isolation", () => {
  it("retries a failing vehicle twice then still checks the next vehicle", async () => {
    const dealer = getDealer("ingear-car-sales");
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/bad")
      ? new Response("temporary", { status: 503 })
      : new Response('<meta name="description" content="Good vehicle detail">'));
    const context = { dealer, source: dealer.sources[0], fetchImpl, delayMs: 0 };
    const connector = createWebsiteConnector({ key: "html-structured", detect: () => false });
    const frozen = ["bad", "good"].map(id => emptyVehicle(context, { sourceVehicleId: id,
      make: "Ford", model: "Focus", detailUrl: `https://dealer.example/${id}` }));
    const resultPromise = connector.fetchDetails(context, frozen);
    const result = await resultPromise;
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/bad"))).toHaveLength(3);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/good"))).toHaveLength(1);
    expect(result.detailMissing).toBe(1);
    expect(result.vehicles).toHaveLength(2);
    expect(result.vehicles[1]?.description).toBe("Good vehicle detail");
  });
  it("retains earlier pages and visits later pages after exhausted pagination retries", async () => {
    const dealer = getDealer("ingear-car-sales");
    const card = (id: string) => `<script type="application/ld+json">${JSON.stringify({
      "@type": "Car", brand: "Ford", model: "Focus", url: `https://dealer.example/car-${id}`,
    })}</script>`;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get("page");
      if (page === "2") return new Response("temporary", { status: 503 });
      return new Response(page === "3" ? card("three") : card("one") + '<a href="?page=2">2</a><a href="?page=3">3</a>');
    });
    const connector = createWebsiteConnector({ key: "html-structured", detect: () => false, preferBrowser: false });
    const result = await connector.fetchList({ dealer, source: { ...dealer.sources[0], startUrl: "https://dealer.example/stock", maxPages: 3, headed: false, preferBrowser: false }, fetchImpl });
    expect(result.vehicles).toHaveLength(2);
    expect(result.paginationUncertain).toBe(true);
    expect(result.pagesFetched).toBe(2);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("page=2"))).toHaveLength(3);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("page=3"))).toHaveLength(1);
  });
});
