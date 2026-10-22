import { describe, expect, it, vi } from "vitest";
import { scrapeFailureReason } from "@/lib/dealer-stock-sync/completeness";
import { htmlStructuredConnector } from "@/scripts/dealer-stock-sync/connectors/html-structured";
import { extractDwCarViews } from "@/scripts/dealer-stock-sync/connectors/named-html";
import { extractDwDetailImages } from "@/scripts/dealer-stock-sync/connectors/named-html-more";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";

const listHtml = `
  <div class="car-view1-wrapper">
    <img src="images/carpix/listings/horizontal_06722.jpg">
    <div class="txt1">Kia SPORTAGE 1.6T</div>
    <div class="txt4">Electric Windows, Parking Sensors</div>
    <div class="txt6">In Stock - &pound;18750.00</div>
    <div class="txt5">25000 Miles</div>
    <div class="txt6">2023&nbsp; /&nbsp; 6-Manual&nbsp; /&nbsp; Petrol</div>
    <a href="details_00652.html">VIEW DETAILS</a>
  </div>
  <div class="car-view1-wrapper">
    <img src="images/carpix/listings/horizontal_06335.jpg">
    <div class="txt1">Nissan JUKE 1.6 HYBRID &pound;79 tax</div>
    <div class="txt6">In Stock - &pound;15750.00</div>
    <div class="txt5">23000 Miles</div>
    <div class="txt6">2023&nbsp; /&nbsp; Auto&nbsp; /&nbsp; Pet Hyb</div>
    <a href="details_00604.html">VIEW DETAILS</a>
  </div>
  <div class="car-view1-wrapper">
    <div class="txt1">Ford PUMA Titanium</div>
    <div class="txt6">Sold - &pound;9995.00</div>
    <div class="txt5">8000 Miles</div>
    <div class="txt6">2021 / Manual / Diesel</div>
    <a href="details_00001.html">VIEW DETAILS</a>
  </div>`;

function dwFetch(detailStatus: "split" | "unavailable") {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/cars_new.html")) return new Response(listHtml, { status: 200 });
    if (url.endsWith("/details_00652.html")) {
      if (init?.redirect !== "manual") return new Response("forbidden", { status: 403 });
      return new Response("", {
        status: 302,
        headers: { location: "https://freeola.com/errors/e.php?ec=404" },
      });
    }
    if (url.endsWith("/details_00604.html") && detailStatus === "split") {
      return new Response('<img src="images/carpix/details/slider_06335.jpg"><img src="images/carpix/details/thumb_06335.jpg">', {
        status: 200,
      });
    }
    return new Response("", { status: 503 });
  });
}

describe("DW Cars live source", () => {
  it("does not treat an incomplete card or an unrelated redirect as verified fallback evidence", async () => {
    const dealer = getDealer("dw-cars");
    const source = dealer.sources[0]!;
    const fetchImpl = dwFetch("split");
    const context = { dealer, source, fetchImpl: fetchImpl as typeof fetch };
    const listed = await htmlStructuredConnector.fetchList(context);
    const vehicle = listed.vehicles[0]!;
    const incomplete = await htmlStructuredConnector.fetchDetails(context, [{ ...vehicle, imageUrls: [] }]);
    expect(incomplete.detailMissing).toBe(1);
    const unrelated = await htmlStructuredConnector.fetchDetails({ ...context, fetchImpl: vi.fn(async () => new Response("", { status: 302, headers: { location: "https://other.example/?ec=404" } })) as typeof fetch }, [vehicle]);
    expect(unrelated.detailMissing).toBe(1);
  });
  it("reads price, fuel and photos from the stock card instead of nearby marketing text", () => {
    const cards = extractDwCarViews(listHtml, "https://www.dwcars.info");
    expect(cards.map((card) => ({
      id: card.sourceVehicleId,
      price: card.price,
      fuel: card.fuel,
      transmission: card.transmission,
      availability: card.availability,
      image: card.image,
    }))).toEqual([
      {
        id: "details_00652",
        price: 18750,
        fuel: "Petrol",
        transmission: "Manual",
        availability: undefined,
        image: "https://www.dwcars.info/images/carpix/listings/horizontal_06722.jpg",
      },
      {
        id: "details_00604",
        price: 15750,
        fuel: "Petrol Hybrid",
        transmission: "Automatic",
        availability: undefined,
        image: "https://www.dwcars.info/images/carpix/listings/horizontal_06335.jpg",
      },
      {
        id: "details_00001",
        price: 9995,
        fuel: "Diesel",
        transmission: "Manual",
        availability: "sold",
        image: null,
      },
    ]);
    expect(extractDwDetailImages(
      '<img src="images/carpix/details/slider_1.jpg"><img src="images/logo.png"><img src="images/carpix/details/thumb_1.jpg">',
      "https://www.dwcars.info",
    )).toEqual(["https://www.dwcars.info/images/carpix/details/slider_1.jpg"]);
  });

  it("keeps a confirmed unpublished detail from failing the whole DW scan", async () => {
    const dealer = getDealer("dw-cars");
    const source = { ...dealer.sources[0]!, preferBrowser: false, headed: false };
    const fetchImpl = dwFetch("split");
    const listed = await htmlStructuredConnector.fetchList({ dealer, source, fetchImpl: fetchImpl as typeof fetch });
    const needsDetails = listed.vehicles.filter((vehicle) => !(vehicle.availability === "sold" && vehicle.sourceVehicleId?.trim()));
    const details = await htmlStructuredConnector.fetchDetails({ dealer, source, fetchImpl: fetchImpl as typeof fetch }, needsDetails);
    const available = details.vehicles.filter((vehicle) => vehicle.availability === "available");
    expect(listed).toMatchObject({ status: "ok", paginationUncertain: false });
    expect(listed.vehicles).toHaveLength(3);
    expect(listed.vehicles.filter((vehicle) => vehicle.availability === "sold")).toHaveLength(1);
    expect(needsDetails).toHaveLength(2);
    expect(details.detailMissing).toBe(0);
    expect(available).toHaveLength(2);
    expect(available.find((vehicle) => vehicle.sourceVehicleId === "details_00652")?.imageUrls).toEqual([
      "https://www.dwcars.info/images/carpix/listings/horizontal_06722.jpg",
    ]);
    expect(available.find((vehicle) => vehicle.sourceVehicleId === "details_00604")?.imageUrls[0]).toBe(
      "https://www.dwcars.info/images/carpix/details/slider_06335.jpg",
    );
    expect(scrapeFailureReason([{
      status: listed.status,
      vehicleCount: listed.vehicles.length,
      advertisedCount: listed.advertisedCount,
      pagesFetched: listed.pagesFetched,
      detailMissing: details.detailMissing ?? 1,
      paginationUncertain: listed.paginationUncertain !== false,
    }])).toBeNull();
  });

  it("still fails closed when a DW detail request is unavailable", async () => {
    const dealer = getDealer("dw-cars");
    const source = { ...dealer.sources[0]!, preferBrowser: false, headed: false };
    const fetchImpl = dwFetch("unavailable");
    const listed = await htmlStructuredConnector.fetchList({ dealer, source, fetchImpl: fetchImpl as typeof fetch });
    const sportage = listed.vehicles.filter((vehicle) => vehicle.sourceVehicleId === "details_00652");
    const details = await htmlStructuredConnector.fetchDetails({ dealer, source, fetchImpl: fetchImpl as typeof fetch }, sportage);
    expect(details.detailMissing).toBe(0);
    expect(details.vehicles).toHaveLength(1);
    const juke = listed.vehicles.filter((vehicle) => vehicle.sourceVehicleId === "details_00604");
    const failed = await htmlStructuredConnector.fetchDetails({ dealer, source, fetchImpl: fetchImpl as typeof fetch }, juke);
    expect(failed.detailMissing).toBe(1);
    expect(scrapeFailureReason([{
      status: "ok",
      vehicleCount: failed.vehicles.length,
      advertisedCount: null,
      pagesFetched: 1,
      detailMissing: failed.detailMissing,
      paginationUncertain: false,
    }])).toBe("detail-uncertain");
  });
});
