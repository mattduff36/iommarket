import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDealer } from "../../scripts/dealer-stock-sync/registry";
import { normalizeVanMossel, vanMosselConnector, vanMosselStockPage } from "../../scripts/dealer-stock-sync/connectors/van-mossel";
import { handhCards, handhDetail } from "../../scripts/dealer-stock-sync/connectors/handh";
import { cleanDragonVehicle } from "../../scripts/dealer-stock-sync/connectors/dragon2000";
import { assertDesktopSourceUrl, desktopImageUrlRules } from "../../lib/dealer-stock-sync/desktop-source-policy";
import { desktopScrapeSubmission } from "../../scripts/dealer-stock-sync/desktop-job-runner";
import { parseDesktopScrapeSubmission } from "../../lib/dealer-stock-sync/desktop-inventory";
import { pipelineResultFromSources } from "../../scripts/dealer-stock-sync/pipeline";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/part1-dealers/${name}`, import.meta.url), "utf8");
const listed = JSON.parse(fixture("van-mossel-list.json"));
const detail = JSON.parse(fixture("van-mossel-detail.json"));
function context(key = "isle-of-man-motorcycles") {
  const dealer = getDealer(key);
  return { dealer, source: dealer.sources[0]! };
}
function nuxtHtml(collection: unknown) {
  const table: unknown[] = [];
  function encode(value: unknown): number {
    const index = table.length;
    table.push(null);
    table[index] = Array.isArray(value) ? value.map(encode) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) : value;
    return index;
  }
  encode(collection);
  return `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(table)}</script>`;
}

describe("confirmed dealer public stock sources", () => {
  it("decodes the public Nuxt stock table and rejects missing stock", () => {
    expect(vanMosselStockPage(nuxtHtml({ vehicles: [listed], amount: 1 }))).toEqual({ records: [listed], count: 1 });
    expect(() => vanMosselStockPage("<html>blocked</html>")).toThrow("missing");
  });
  it("preserves source condition, miles, reduced price and dealer ownership", () => {
    const vehicle = normalizeVanMossel(listed, context())!;
    expect(vehicle).toMatchObject({ condition: "USED", mileage: 1500, pricePence: 499500 });
    expect(vehicle.detailUrl).toContain("/motorcycles/stock/285009710-1-");
    expect(vehicle.imageUrls[0]).toContain("941b478a");
    expect(normalizeVanMossel(listed, context("van-mossel-jacksons"))).toBeNull();
    expect(normalizeVanMossel({ ...listed, condition: { formatted: { key: "unknown" } } }, context())).toBeNull();
  });
  it("uses detail schema miles instead of the site's inconsistent kilometre tracking value", () => {
    expect(normalizeVanMossel(detail, context())).toMatchObject({ mileage: 1500, registration: "RMN358V", vin: "ZAPMD350000004719" });
  });
  it("retains named new stock with unknown model/year without inventing age or mileage", () => {
    expect(normalizeVanMossel({ ...listed, model: "", type: "R 1300 GS", year: null,
      condition: { formatted: { key: "new" } } }, context())).toMatchObject({ model: "R 1300 GS", condition: "NEW", year: null, mileage: null });
  });
  it("follows all pages and marks a truncated source incomplete", async () => {
    const ctx = context();
    const fetchImpl = (async (url: string | URL | Request) => new Response(nuxtHtml({
      vehicles: [String(url).includes("page=2") ? { ...listed, id: "second" } : listed], amount: 2,
    }))) as typeof fetch;
    const result = await vanMosselConnector.fetchList({ ...ctx, fetchImpl });
    expect(result).toMatchObject({ pagesFetched: 2, advertisedCount: 2, paginationUncertain: false });
    expect((await vanMosselConnector.fetchList({ ...ctx, source: { ...ctx.source, maxPages: 1 }, fetchImpl })).paginationUncertain).toBe(true);
  });
  it("parses used H&H stock and isolates its own gallery from recommendations", () => {
    const models = [{ title: "GB350", "brand:label": "Honda" }, { title: "CRF250 RALLY", "brand:label": "Honda" },
      { title: "890 DUKE R", "brand:label": "KTM" }, { title: "Neo's", "brand:label": "Yamaha" }];
    const vehicles = handhCards(fixture("handh-cards.html"), models, context("handh-motorcycles"));
    expect(vehicles).toHaveLength(4);
    expect(vehicles.filter((vehicle) => vehicle.availability === "sold")).toHaveLength(1);
    const vehicle = handhDetail(fixture("handh-detail.html"), vehicles[0]!);
    expect(vehicle).toMatchObject({ make: "Honda", model: "GB350", mileage: 1800, pricePence: 375000, condition: "USED" });
    expect(vehicle.imageUrls).toHaveLength(4);
    expect(getDealer("handh-motorcycles").sources.every((source) => !source.startUrl?.includes("/new-"))).toBe(true);
  });
  it("removes Dragon manufacturer icons and derives condition only from explicit detail routes", () => {
    const vehicle = normalizeVanMossel(listed, context())!;
    const clean = cleanDragonVehicle({ ...vehicle, detailUrl: "https://bvsvehicles.com/vehicle-details/used-audi-a3-u123/",
      imageUrls: ["https://img.cdn.dragon2000.net/C3656/U123/photo.jpg", "https://img.cdn.dragon2000.net/WebAssets/manufacturer-icons/audi.png"] });
    expect(clean.condition).toBe("USED");
    expect(clean.imageUrls).toHaveLength(1);
  });
  it("allows only the observed Van Mossel photo CDN", () => {
    const rules = desktopImageUrlRules("isle-of-man-motorcycles", "van-mossel", context().source.startUrl);
    expect(assertDesktopSourceUrl("https://vanmossel.images.ilsa.cloud/photo.webp", rules)).toContain("photo.webp");
    expect(() => assertDesktopSourceUrl("https://other.ilsa.cloud/photo.webp", rules)).toThrow();
  });
  it("preserves NEW across the desktop submission boundary and bounds verbose paint descriptions", () => {
    const ctx = context();
    const vehicle = normalizeVanMossel({ ...detail, category: "new", structuredData: {
      ...detail.structuredData, schema: { ...detail.structuredData.schema, color: "A".repeat(80) },
    } }, ctx)!;
    const now = new Date().toISOString();
    const result = pipelineResultFromSources({ dealer: ctx.dealer, scrapeStartedAt: now, scrapeFinishedAt: now,
      sourceResults: [{ dealerKey: ctx.dealer.key, sourceKey: ctx.source.key, platform: "van-mossel", status: "ok",
        error: null, startUrl: ctx.source.startUrl, pagesFetched: 1, advertisedCount: 1, rawCount: 1,
        vehicles: [vehicle], detailMissing: 0, paginationUncertain: false }] });
    const parsed = parseDesktopScrapeSubmission(ctx.dealer.key, desktopScrapeSubmission(result));
    expect(parsed.sourceResults[0]!.vehicles[0]!.condition).toBe("NEW");
    expect(parsed.sourceResults[0]!.vehicles[0]!.colour).toHaveLength(40);
  });
});
