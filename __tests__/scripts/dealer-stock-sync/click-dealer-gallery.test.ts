import { describe, expect, it, vi } from "vitest";
import { extractWebsiteDetailImages } from "@/scripts/dealer-stock-sync/html-media";
import { clickDealerConnector } from "@/scripts/dealer-stock-sync/connectors/click-dealer";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";
import { vehicle } from "./fixtures";

const detailUrl = "https://www.mikesmotors.im/used-peugeot-horizon-castletown-isle-of-man-8324646";
const root = "https://images.clickdealer.co.uk/vehicles/8324/8324646/";
const options = { dealerKey: "mikes-motors", detailUrl };

describe("Click Dealer owner gallery", () => {
  it("accepts published large1 photos and excludes thumbnails and other vehicles", () => {
    const html = `<img src="${root}96x72/204251471.jpg"><img src="${root}large1/204251471.jpg">
      <img src="${root}large1/204251334.jpg"><img src="https://images.clickdealer.co.uk/vehicles/8286/8286323/large1/204248924.jpg">`;
    expect(extractWebsiteDetailImages(html, "https://www.mikesmotors.im", options)).toEqual([
      `${root}large1/204251471.jpg`, `${root}large1/204251334.jpg`,
    ]);
  });

  it("deduplicates observed size variants and never invents a full-size URL", () => {
    const html = `<img src="${root}large1/204251471.jpg"><img src="${root}full/204251471.jpg">`;
    expect(extractWebsiteDetailImages(html, null, options)).toEqual([`${root}full/204251471.jpg`]);
    expect(extractWebsiteDetailImages(`<img src="${root}344x258/204251471.jpg">`, null, options)).toEqual([]);
  });

  it("replaces the list thumbnail with the owner gallery rather than importing both", async () => {
    const dealer = getDealer("mikes-motors");
    const result = await clickDealerConnector.fetchDetails({
      dealer, source: dealer.sources[0]!,
      fetchImpl: vi.fn(async () => new Response(`<img src="${root}large1/204251471.jpg">`)),
    }, [vehicle({ detailUrl, imageUrls: [`${root}344x258/204251471.jpg`] })]);
    expect(result.detailMissing).toBe(0);
    expect(result.vehicles[0].imageUrls).toEqual([`${root}large1/204251471.jpg`]);
  });
});
