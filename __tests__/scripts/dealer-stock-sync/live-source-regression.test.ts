import { describe, expect, it, vi } from "vitest";
import { scrapeFailureReason } from "@/lib/dealer-stock-sync/completeness";
import { extractDwCarViews, extractSnccCarItems } from "@/scripts/dealer-stock-sync/connectors/named-html";
import { extractDetailSpecs } from "@/scripts/dealer-stock-sync/connectors/named-html-more";
import { discoverStockPageUrls } from "@/scripts/dealer-stock-sync/connectors/html-extract";
import { fetchWebsiteList } from "@/scripts/dealer-stock-sync/connectors/website-source";
import { extractWebsiteDetailImages } from "@/scripts/dealer-stock-sync/html-media";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";

const browse = vi.hoisted(() => ({ withPublicPage: vi.fn() }));
vi.mock("@/scripts/dealer-stock-sync/browse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/scripts/dealer-stock-sync/browse")>();
  return { ...actual, withPublicPage: browse.withPublicPage };
});

const manxListHtml = `<script type="application/ld+json">${JSON.stringify({
  "@type": "Car", brand: { name: "Ford" }, model: "Focus", url: "https://www.manxcarwarehouse.im/stock/ford-focus",
})}</script>`;

function snccCard(id: string, status = "") {
  return `<div class="car-item gray-bg text-center">
    ${status ? `<span class="label car-status ${status}">${status.toUpperCase()}</span>` : ""}
    <div class="car-overlay-banner"><a href="https://sncc.im/cars/2021-ford-${id}/" title="View">View</a></div>
    <li><i class="fas fa-calendar-alt"></i> 2021</li>
    <li><i class="glyph-icon flaticon-gas-station"></i> 12345</li>
    <div class="car-content"><a href="https://sncc.im/cars/2021-ford-${id}/">2021 Ford ${id}</a>
      <div class="price car-price"><bdi class="new-price"><span class="currency">&pound;</span>12,345.00</bdi></div>
    </div></div>`;
}

describe("live stock source regressions", () => {
  it("uses only observed SNCC owner-gallery photos, never sharing links or related cars", () => {
    const html = `<a href="https://pinterest.com/pin/create/button/?media=https%3A%2F%2Fsncc.im%2Fphoto.jpeg">Share</a>
      <div class="slider slider-for detail-big-car-gallery"><figure>
        <img src="https://sncc.im/wp-content/uploads/2026/07/car-876x535.jpeg" class="img-responsive ps-car-listing"
          data-src="https://sncc.im/wp-content/uploads/2026/07/car.jpeg"></figure>
        <figure><img class="ps-car-listing" data-src="https://elsewhere.example/unowned.jpg"></figure></div>
      <div class="owl-carousel related-vehicle"><img src="https://sncc.im/wp-content/uploads/2026/07/other.jpeg"></div>`;
    expect(extractWebsiteDetailImages(html, "https://sncc.im", { dealerKey: "skillannaylor-car-company" }))
      .toEqual(["https://sncc.im/wp-content/uploads/2026/07/car.jpeg"]);
    expect(extractWebsiteDetailImages('<img src="https://sncc.im/wp-content/uploads/2026/07/other.jpeg">',
      "https://sncc.im", { dealerKey: "skillannaylor-car-company" })).toEqual([]);
  });
  it("resolves each DW path-relative detail link within its own card", () => {
    const cards = extractDwCarViews(`
      <div class="car-view1-wrapper"><div class="txt1">Ford Puma</div><div class="txt6">2023 / Petrol</div>
        <div class="txt5">12,000 miles</div><a href="details_00652.html">View</a></div>
      <div class="car-view1-wrapper"><div class="txt1">Kia Rio</div><div class="txt6">2020 / Petrol</div>
        <div class="txt5">25,000 miles</div><a href="details_00645.html">View</a></div>`,
      "https://www.dwcars.info");
    expect(cards.map(card => card.url)).toEqual([
      "https://www.dwcars.info/details_00652.html", "https://www.dwcars.info/details_00645.html",
    ]);
    expect(extractDwCarViews('<div class="car-view1-wrapper"><div class="txt1">Ford Puma</div></div>',
      "https://www.dwcars.info")[0]?.url).toBeNull();
  });

  it("keeps SNCC sold and reserved labels attached to their owning cards", () => {
    const cards = extractSnccCarItems(snccCard("Focus", "sold") + snccCard("Fiesta") + snccCard("Puma", "reserved"), "https://sncc.im");
    expect(cards).toHaveLength(3);
    expect(cards.map(card => ({ id: card.sourceVehicleId, availability: card.availability, mileage: card.mileage }))).toEqual([
      { id: "2021-ford-Focus", availability: "sold", mileage: 12345 },
      { id: "2021-ford-Fiesta", availability: "available", mileage: 12345 },
      { id: "2021-ford-Puma", availability: "reserved", mileage: 12345 },
    ]);
  });

  it.each([
    ["3.0L V6 Turbo Petrol/Electric Plug-In Hybrid", "Petrol Plug-in Hybrid"],
    ["2.0L 4-Cylinder Turbo Petrol/Plug-in Hybrid Electric", "Petrol Plug-in Hybrid"],
    ["4.2L V8 Twin Turbo Diesel", "Diesel"],
    ["380kW Dual Electric Motors", "Electric"],
    ["1000cc Fuel Injected V-Twin", null],
    ["Petrol or Diesel", null],
  ])("extracts an unambiguous fuel from the engine field: %s", (engine, fuel) => {
    expect(extractDetailSpecs(`<li class="car_engine"><span>Engine</span><strong>${engine}</strong></li>`).fuel).toBe(fuel);
  });

  it("does not borrow a neighboring field when the SNCC engine value is absent", () => {
    expect(extractDetailSpecs('<li class="car_engine"><span>Engine</span></li><li class="car_transmission"><strong>Petrol</strong></li>').fuel).toBeNull();
  });

  it("discovers only same-origin SNCC inventory pagination and excludes page one", () => {
    expect(discoverStockPageUrls(`
      <a class="page-numbers" href="https://sncc.im/cars/page/2/">2</a>
      <a class="page-numbers" href="/cars/page/3/">3</a>
      <a class="next page-numbers" href="page/2/">Next</a>
      <a href="/cars/page/1/">1</a><a href="https://elsewhere.example/cars/page/4/">4</a>`,
      "https://sncc.im/cars/")).toEqual(["https://sncc.im/cars/page/2/", "https://sncc.im/cars/page/3/"]);
  });

  it("collects all discovered SNCC pages without declaring capped or failed navigation complete", async () => {
    const dealer = getDealer("skillannaylor-car-company");
    const pages: Record<string, string> = {
      "https://sncc.im/cars/": snccCard("Focus") + '<a href="/cars/page/2/">Next</a>',
      "https://sncc.im/cars/page/2/": snccCard("Fiesta") + '<a href="/cars/page/3/">Next</a>',
      "https://sncc.im/cars/page/3/": snccCard("Puma") + '<a href="/cars/page/1/">1</a>',
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => new Response(pages[String(input)] ?? "", { status: pages[String(input)] ? 200 : 404 }));
    const source = { ...dealer.sources[0]!, preferBrowser: false, headed: false };
    const all = await fetchWebsiteList({ dealer, source, fetchImpl: fetchImpl as typeof fetch });
    expect(all).toMatchObject({ status: "ok", pagesFetched: 3, paginationUncertain: false });
    expect(all.vehicles).toHaveLength(3);
    const capped = await fetchWebsiteList({ dealer, source: { ...source, maxPages: 2 }, fetchImpl: fetchImpl as typeof fetch });
    expect(capped).toMatchObject({ pagesFetched: 2, paginationUncertain: true });
    const failedFetch = vi.fn(async (input: string | URL | Request) => String(input).includes("/page/2/")
      ? new Response("", { status: 503 }) : new Response(pages[String(input)] ?? ""));
    const failed = await fetchWebsiteList({ dealer, source, fetchImpl: failedFetch as typeof fetch });
    expect(failed).toMatchObject({ pagesFetched: 1, paginationUncertain: true });
  });

  it("uses the browser for Manx Car Warehouse only after plain HTTP fails", async () => {
    const previousHeaded = process.env.DEALER_STOCK_HEADED;
    delete process.env.DEALER_STOCK_HEADED;
    const dealer = getDealer("manx-car-warehouse");
    const source = dealer.sources[0]!;
    expect(source).toMatchObject({
      key: "stock",
      preferBrowser: true,
      startUrl: "https://www.manxcarwarehouse.im/stock/used-cars-in-ballasalla-isle-of-man/1",
    });
    expect(source.headed).not.toBe(true);
    const order: string[] = [];
    const fetchImpl = vi.fn(async () => {
      order.push("http");
      return new Response("down", { status: 404 });
    });
    browse.withPublicPage.mockImplementation(async () => {
      order.push("browser");
      return { jsonRequest: null, html: manxListHtml, htmls: [manxListHtml], jsonPayloads: [], htmlPayloads: [], paginationUncertain: false };
    });
    try {
      const failedHttp = await fetchWebsiteList({ dealer, source, fetchImpl: fetchImpl as typeof fetch });
      expect(order).toEqual(["http", "browser"]);
      expect(failedHttp).toMatchObject({ status: "ok", dealerKey: "manx-car-warehouse", sourceKey: "stock" });
      expect(failedHttp.vehicles).toHaveLength(1);
      expect(browse.withPublicPage).toHaveBeenCalledWith(source.startUrl, expect.any(Function), expect.objectContaining({ headed: false }));
      browse.withPublicPage.mockClear();
      const httpOk = await fetchWebsiteList({
        dealer,
        source,
        fetchImpl: vi.fn(async () => new Response(manxListHtml, { status: 200 })) as typeof fetch,
      });
      expect(httpOk.status).toBe("ok");
      expect(httpOk.vehicles).toHaveLength(1);
      expect(browse.withPublicPage).not.toHaveBeenCalled();
      expect(scrapeFailureReason([{ status: "ok", vehicleCount: 14, advertisedCount: 20, pagesFetched: 1, detailMissing: 0, paginationUncertain: false }])).toBe("partial-inventory");
      expect(scrapeFailureReason([{ status: "ok", vehicleCount: 14, advertisedCount: null, pagesFetched: 1, detailMissing: 1, paginationUncertain: false }])).toBe("detail-uncertain");
      expect(scrapeFailureReason([{ status: "ok", vehicleCount: 14, advertisedCount: null, pagesFetched: 1, detailMissing: 0, paginationUncertain: true }])).toBe("pagination-uncertain");
    } finally {
      if (previousHeaded === undefined) delete process.env.DEALER_STOCK_HEADED;
      else process.env.DEALER_STOCK_HEADED = previousHeaded;
    }
  });
});
