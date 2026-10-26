import { describe, expect, it } from "vitest";
import { isDealerPlaceholderImage } from "../../../lib/images/dealer-placeholder";
import { uniqueImageUrls, encodeNetDirectorImageUrl } from "../../../scripts/dealer-stock-sync/image-urls";
import { extractDetailSpecs } from "../../../scripts/dealer-stock-sync/connectors/named-html-more";

describe("dealer placeholder policy", () => {
  it.each(["no-pic.jpg", "no_photo.png", "noimage.webp", "placeholder-car.png", "photos-coming-soon.jpg", "awaiting-image.jpg", "default-image.png"])("recognises %s for any dealer", name => {
    expect(isDealerPlaceholderImage("https://dealer.example/assets/" + name)).toBe(true);
  });
  it("does not classify ordinary photos by their host or query", () => {
    expect(isDealerPlaceholderImage("https://placeholder-motors.example/real-car.jpg?caption=no-image")).toBe(false);
    expect(isDealerPlaceholderImage("https://dealer.example/car-default-edition.jpg")).toBe(false);
  });
  it("recognises encoded NetDirector placeholder keys", () => {
    expect(isDealerPlaceholderImage(encodeNetDirectorImageUrl({ key: "stock/coming-soon.jpg" }))).toBe(true);
  });
  it("keeps one placeholder only when no real vehicle photos exist", () => {
    expect(uniqueImageUrls(["https://a.example/no-pic.jpg", "https://b.example/noimage.png"])).toEqual(["https://a.example/no-pic.jpg"]);
    expect(uniqueImageUrls(["https://a.example/no-pic.jpg", "https://a.example/real-car.jpg"])).toEqual(["https://a.example/real-car.jpg"]);
    expect(uniqueImageUrls(["https://a.example/logo.png"])).toEqual([]);
  });
  it("reads labelled Manx specification rows without reading search filters", () => {
    const html = '<span class="me-auto text-truncate title">Fuel Type</span><strong class="value text-truncate">Petrol</strong>' +
      '<span class="me-auto text-truncate title">Transmission</span><strong class="value text-truncate">Manual</strong>' +
      '<select name="FuelType"><option>Diesel</option></select>';
    expect(extractDetailSpecs(html)).toMatchObject({ fuel: "Petrol", transmission: "Manual" });
    expect(extractDetailSpecs('<select name="FuelType"><option>Diesel</option></select>')).toMatchObject({ fuel: null });
  });
});
